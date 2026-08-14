-- Phase 5 — emailing the month's paperwork to the client.
--
-- The CRM already produces both documents a monthly invoice email carries (the
-- hours breakdown and the Green Invoice tax document) and could send neither.
-- This migration adds the three pieces of state that sending needs:
--
--   1. email_log        — what was sent, to whom, and whether it worked
--   2. monthly_summaries.emailed_at — the quick "already sent" flag the record
--                         page reads so a second send is a deliberate act
--   3. invoices.doc_pdf_path — where the captured legal PDF lives in Storage,
--                         so the email does not depend on a live provider fetch
--
-- Adding doc_pdf_path to an issued invoice is safe: guard_issued_invoice()
-- freezes only subtotal, tax_rate, currency and account_id.

-- ---------------------------------------------------------------------------
-- 1. email_log
-- ---------------------------------------------------------------------------
-- Deliberately stores attachment *filenames*, never bytes. The PDFs live in
-- the attachments bucket (the tax document) or are rebuilt on demand from the
-- time entries (the hours breakdown); duplicating them here would turn an
-- audit trail into a blob store.
create table if not exists public.email_log (
  id            varchar primary key default (uuid_generate_v4())::text,
  entity_type   varchar not null,
  entity_id     varchar not null,
  to_addresses  text[]  not null,
  cc_addresses  text[],
  subject       text    not null,
  body          text    not null,
  attachments   text[],
  status        varchar not null default 'sent',
  error         text,
  sent_by_id    varchar,
  sent_at       bigint  not null default public.epoch_ms(),
  created_at    bigint  not null default public.epoch_ms(),
  constraint email_log_status_check check (status in ('sent', 'failed'))
);

-- A failed row is the point of this table as much as a successful one: it
-- carries the fetch-attempt log that makes the (still unverified) Green
-- Invoice retrieval debuggable in production without a second tax document.
alter table public.email_log
  add column if not exists invoice_id     varchar references public.invoices(id),
  add column if not exists account_id     varchar references public.accounts(id),
  add column if not exists bcc_addresses  text[],
  -- [{ name, bytes, source }] — source records provenance: green_invoice,
  -- cached, preview or manual_upload. A client asking "which PDF did I get?"
  -- has to be answerable a year later.
  add column if not exists attachment_meta jsonb not null default '[]'::jsonb,
  add column if not exists provider_message_id varchar,
  add column if not exists sent_by_email  varchar;

create index if not exists idx_email_log_entity
  on public.email_log (entity_type, entity_id, sent_at desc);

alter table public.email_log enable row level security;

-- Same policy set as invoice_line_items. No update/delete for authenticated
-- users: a record of what was sent to a client is not something the app should
-- be able to rewrite.
drop policy if exists "Allow authenticated read on email_log"   on public.email_log;
drop policy if exists "Allow authenticated insert on email_log" on public.email_log;
drop policy if exists "Allow service_role full access on email_log" on public.email_log;
create policy "Allow authenticated read on email_log"
  on public.email_log for select to authenticated using (true);
create policy "Allow authenticated insert on email_log"
  on public.email_log for insert to authenticated with check (true);
create policy "Allow service_role full access on email_log"
  on public.email_log for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. Summary and invoice columns
-- ---------------------------------------------------------------------------
alter table public.monthly_summaries
  add column if not exists emailed_at bigint;

alter table public.invoices
  add column if not exists doc_pdf_path       varchar,
  add column if not exists doc_pdf_fetched_at bigint;

-- The greeting is "Hi {{client_short_name}} team" — "Kodem Security Ltd" is
-- not what you call them. Falls back to the account name when unset.
alter table public.accounts
  add column if not exists short_name varchar;

comment on column public.monthly_summaries.emailed_at is
  'When this month''s invoice email last went out. Set by send-summary-email.';
comment on column public.invoices.doc_pdf_path is
  'Storage path (attachments bucket) of the legal PDF captured from Green Invoice at issue time.';
comment on column public.accounts.short_name is
  'Informal name used to address the client in emails, e.g. "Kodem" for "Kodem Security Ltd".';
