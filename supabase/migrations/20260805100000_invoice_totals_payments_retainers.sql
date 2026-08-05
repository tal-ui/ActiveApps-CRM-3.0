-- Phase 3 — retainers, payments, Israeli invoicing.
--
-- Four things happen here, in order, because each depends on the last:
--   1. Invoice totals stop being client-computed and become formula-driven,
--      exactly like quotes (20260707100000_quote_totals_rollup.sql).
--   2. invoice_payments arrives, so an invoice has amount_paid / balance and a
--      status that follows the money instead of a button.
--   3. Accounts carry the client legal details an Israeli tax invoice needs.
--   4. recurring_invoices + generate_recurring_invoice() give fixed-fee
--      retainers, callable from both the app and the hourly cron.
--   5. Green Invoice issuance columns, plus a guard that freezes an invoice
--      once a legal document number exists for it.
--
-- Rollback: drop the triggers and functions created here, drop
-- invoice_payments / recurring_invoices, then re-add invoices.tax_amount and
-- total_amount as plain numeric default 0.

-- ---------------------------------------------------------------------------
-- 0. New columns (functions below reference them, so they come first)
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists amount_paid         numeric not null default 0,
  add column if not exists balance             numeric not null default 0,
  add column if not exists external_doc_id     varchar,
  add column if not exists external_doc_number varchar,
  add column if not exists external_doc_url    varchar,
  add column if not exists allocation_number   varchar,
  add column if not exists issued_at           bigint,
  add column if not exists issue_error         text,
  add column if not exists provider_response   jsonb;

alter table public.accounts
  add column if not exists legal_name varchar,
  add column if not exists tax_id     varchar,
  add column if not exists vat_exempt boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. Invoice totals become formula-driven
-- ---------------------------------------------------------------------------

-- 1a. Line total = quantity x unit price (mirrors compute_quote_line_total_trg)
create or replace function public.compute_invoice_line_total_trg()
returns trigger
language plpgsql
as $$
begin
  new.total_price := round(coalesce(new.quantity, 0) * coalesce(new.unit_price, 0), 2);
  return new;
end; $$;

drop trigger if exists trg_invoice_line_total on public.invoice_line_items;
create trigger trg_invoice_line_total
  before insert or update on public.invoice_line_items
  for each row execute function public.compute_invoice_line_total_trg();

-- 1b. PRESERVE EXISTING TOTALS BEFORE THE COLUMNS BECOME GENERATED.
--     Any invoice whose total_amount was typed in directly (no line items, or
--     lines that don't add up to it) would silently collapse to 0 the moment
--     total_amount is derived from subtotal. Synthesise one line item that
--     reproduces the current total so no historical invoice loses its value.
insert into public.invoice_line_items
  (invoice_id, description, quantity, unit_price, total_price, created_at)
select i.id,
       'Invoice total (migrated)',
       1,
       round(coalesce(i.total_amount, 0) / (1 + coalesce(i.tax_rate, 0) / 100.0), 2),
       round(coalesce(i.total_amount, 0) / (1 + coalesce(i.tax_rate, 0) / 100.0), 2),
       public.epoch_ms()
from public.invoices i
where coalesce(i.total_amount, 0) > 0
  and coalesce((
        select sum(li.total_price) from public.invoice_line_items li
        where li.invoice_id = i.id and coalesce(li.is_deleted, false) = false
      ), 0) = 0;

-- 1c. tax_amount / total_amount become generated columns
alter table public.invoices drop column if exists tax_amount;
alter table public.invoices drop column if exists total_amount;
alter table public.invoices add column tax_amount numeric
  generated always as
    (round(coalesce(subtotal, 0) * coalesce(tax_rate, 0) / 100.0, 2)) stored;
alter table public.invoices add column total_amount numeric
  generated always as
    (round(coalesce(subtotal, 0)
       + coalesce(subtotal, 0) * coalesce(tax_rate, 0) / 100.0, 2)) stored;

-- ---------------------------------------------------------------------------
-- 2. Payments
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_payments (
  id            varchar primary key default (uuid_generate_v4())::text,
  invoice_id    varchar not null references public.invoices(id) on delete cascade,
  amount        numeric not null default 0,
  paid_at       bigint  not null default public.epoch_ms(),
  method        varchar not null default 'bank_transfer',
  reference     varchar,
  notes         text,
  created_by_id varchar,
  created_at    bigint  not null default public.epoch_ms(),
  updated_at    bigint  not null default public.epoch_ms(),
  is_deleted    boolean not null default false
);

create index if not exists idx_invoice_payments_invoice
  on public.invoice_payments (invoice_id) where is_deleted = false;

alter table public.invoice_payments enable row level security;

-- Same policy set as invoice_line_items: any authenticated user may record a
-- payment, service_role has full access for the edge functions.
drop policy if exists "Allow authenticated read on invoice_payments"   on public.invoice_payments;
drop policy if exists "Allow authenticated insert on invoice_payments" on public.invoice_payments;
drop policy if exists "Allow authenticated update on invoice_payments" on public.invoice_payments;
drop policy if exists "Allow authenticated delete on invoice_payments" on public.invoice_payments;
drop policy if exists "Allow service_role full access on invoice_payments" on public.invoice_payments;
create policy "Allow authenticated read on invoice_payments"
  on public.invoice_payments for select to authenticated using (true);
create policy "Allow authenticated insert on invoice_payments"
  on public.invoice_payments for insert to authenticated with check (true);
create policy "Allow authenticated update on invoice_payments"
  on public.invoice_payments for update to authenticated using (true) with check (true);
create policy "Allow authenticated delete on invoice_payments"
  on public.invoice_payments for delete to authenticated using (true);
create policy "Allow service_role full access on invoice_payments"
  on public.invoice_payments for all to service_role using (true) with check (true);

-- 2a. One function refreshes everything derived on an invoice.
--
-- It deliberately runs TWO updates: total_amount is a generated column, and a
-- generated column may not reference another generated column, so `balance`
-- has to be a plain column set by a second statement that reads the freshly
-- computed total. Both the line-item rollup and the payment rollup call this,
-- so editing a line and recording a payment converge on the same state.
create or replace function public.refresh_invoice_derived(p_invoice_id character varying)
returns void
language plpgsql
as $$
declare
  v_total   numeric;
  v_paid    numeric;
  v_status  varchar;
  v_balance numeric;
  v_last    bigint;
begin
  if p_invoice_id is null then return; end if;

  update public.invoices i set
    subtotal = coalesce((
      select sum(li.total_price) from public.invoice_line_items li
      where li.invoice_id = p_invoice_id and coalesce(li.is_deleted, false) = false
    ), 0),
    amount_paid = coalesce((
      select sum(p.amount) from public.invoice_payments p
      where p.invoice_id = p_invoice_id and coalesce(p.is_deleted, false) = false
    ), 0),
    updated_at = public.epoch_ms()
  where i.id = p_invoice_id;

  select total_amount, amount_paid, status
    into v_total, v_paid, v_status
    from public.invoices where id = p_invoice_id;
  if not found then return; end if;

  v_balance := round(coalesce(v_total, 0) - coalesce(v_paid, 0), 2);

  select max(paid_at) into v_last from public.invoice_payments
   where invoice_id = p_invoice_id and coalesce(is_deleted, false) = false;

  -- Status follows the money, but only for invoices that are actually out with
  -- a client. Drafts and cancelled invoices are never touched.
  update public.invoices set
    balance = v_balance,
    status = case
      when v_status in ('sent', 'overdue', 'paid')
           and coalesce(v_paid, 0) > 0 and v_balance <= 0 then 'paid'
      when v_status = 'paid' and v_balance > 0 then 'sent'
      else v_status
    end,
    paid_date = case
      when v_status in ('sent', 'overdue', 'paid')
           and coalesce(v_paid, 0) > 0 and v_balance <= 0 then v_last
      when v_status = 'paid' and v_balance > 0 then null
      else paid_date
    end
  where id = p_invoice_id;
end; $$;

create or replace function public.invoice_line_rollup_trg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.invoice_id is distinct from old.invoice_id then
      perform public.refresh_invoice_derived(old.invoice_id);
    end if;
    perform public.refresh_invoice_derived(new.invoice_id); return new;
  elsif tg_op = 'INSERT' then
    perform public.refresh_invoice_derived(new.invoice_id); return new;
  else
    perform public.refresh_invoice_derived(old.invoice_id); return old;
  end if;
end; $$;

drop trigger if exists trg_invoice_line_rollup on public.invoice_line_items;
create trigger trg_invoice_line_rollup
  after insert or update or delete on public.invoice_line_items
  for each row execute function public.invoice_line_rollup_trg();

create or replace function public.invoice_payment_rollup_trg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.invoice_id is distinct from old.invoice_id then
      perform public.refresh_invoice_derived(old.invoice_id);
    end if;
    perform public.refresh_invoice_derived(new.invoice_id); return new;
  elsif tg_op = 'INSERT' then
    perform public.refresh_invoice_derived(new.invoice_id); return new;
  else
    perform public.refresh_invoice_derived(old.invoice_id); return old;
  end if;
end; $$;

drop trigger if exists trg_invoice_payment_rollup on public.invoice_payments;
create trigger trg_invoice_payment_rollup
  after insert or update or delete on public.invoice_payments
  for each row execute function public.invoice_payment_rollup_trg();

-- ---------------------------------------------------------------------------
-- 3. Retainers
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_invoices (
  id                     varchar primary key default (uuid_generate_v4())::text,
  name                   varchar not null,
  account_id             varchar not null references public.accounts(id),
  project_id             varchar references public.projects(id),
  status                 varchar not null default 'active',
  amount                 numeric not null default 0,
  currency               varchar not null default 'ILS',
  tax_rate               numeric not null default 0,
  frequency              varchar not null default 'monthly',
  day_of_month           integer not null default 1,
  line_description       varchar,
  include_unbilled_hours boolean not null default false,
  start_date             bigint,
  end_date               bigint,
  next_run_date          bigint,
  last_run_date          bigint,
  owner_id               varchar,
  created_by_id          varchar,
  created_at             bigint  not null default public.epoch_ms(),
  updated_at             bigint  not null default public.epoch_ms(),
  is_deleted             boolean not null default false
);

create index if not exists idx_recurring_invoices_due
  on public.recurring_invoices (next_run_date)
  where status = 'active' and is_deleted = false;

-- Generated invoices point back at the schedule that produced them, which is
-- what the retainer's "Generated Invoices" related list reads.
alter table public.invoices
  add column if not exists recurring_invoice_id varchar references public.recurring_invoices(id);
create index if not exists idx_invoices_recurring
  on public.invoices (recurring_invoice_id) where recurring_invoice_id is not null;

alter table public.recurring_invoices enable row level security;

drop policy if exists "Allow authenticated read on recurring_invoices"   on public.recurring_invoices;
drop policy if exists "Allow authenticated insert on recurring_invoices" on public.recurring_invoices;
drop policy if exists "Allow authenticated update on recurring_invoices" on public.recurring_invoices;
drop policy if exists "Allow authenticated delete on recurring_invoices" on public.recurring_invoices;
drop policy if exists "Allow service_role full access on recurring_invoices" on public.recurring_invoices;
create policy "Allow authenticated read on recurring_invoices"
  on public.recurring_invoices for select to authenticated using (true);
create policy "Allow authenticated insert on recurring_invoices"
  on public.recurring_invoices for insert to authenticated with check (true);
create policy "Allow authenticated update on recurring_invoices"
  on public.recurring_invoices for update to authenticated using (true) with check (true);
create policy "Allow authenticated delete on recurring_invoices"
  on public.recurring_invoices for delete to authenticated using (true);
create policy "Allow service_role full access on recurring_invoices"
  on public.recurring_invoices for all to service_role using (true) with check (true);

-- 3a. Generation lives in SQL so the "Generate Now" button in the app and the
--     hourly cron in slack-notify share one implementation rather than two
--     that drift. Returns the new invoice id.
create or replace function public.generate_recurring_invoice(p_schedule_id character varying)
returns character varying
language plpgsql
security definer
set search_path = public
as $$
declare
  s            public.recurring_invoices%rowtype;
  v_invoice_id varchar;
  v_prefix     text;
  v_seq        integer;
  v_now        bigint := public.epoch_ms();
  v_from       bigint;
  v_next       bigint;
begin
  select * into s from public.recurring_invoices
   where id = p_schedule_id and coalesce(is_deleted, false) = false;
  if not found then
    raise exception 'Recurring schedule % not found', p_schedule_id;
  end if;
  if s.status <> 'active' then
    raise exception 'Recurring schedule "%" is not active', s.name;
  end if;

  -- Invoice numbering is read-then-increment (same semantics as
  -- src/lib/docNumber.ts). Serialise it so two concurrent runs can't collide.
  perform pg_advisory_xact_lock(hashtext('crm.invoice_number'));
  v_prefix := 'INV-' || to_char(now(), 'YYYY') || '-';
  select coalesce(max(substring(invoice_number from char_length(v_prefix) + 1)::integer), 0) + 1
    into v_seq
    from public.invoices
   where invoice_number like v_prefix || '%'
     and invoice_number ~ ('^' || v_prefix || '[0-9]+$');

  insert into public.invoices (
    account_id, project_id, recurring_invoice_id,
    invoice_number, status, issue_date, due_date,
    subtotal, tax_rate, currency, notes, created_by_id, created_at, updated_at
  ) values (
    s.account_id, s.project_id, s.id,
    v_prefix || lpad(v_seq::text, 3, '0'),
    -- Net 30. The cast matters: 30 * 86400000 overflows int4 on its own.
    'draft', v_now, v_now + 30 * 86400000::bigint,
    0, coalesce(s.tax_rate, 0), coalesce(s.currency, 'ILS'),
    'Generated from retainer: ' || s.name,
    -- created_by_id is NOT NULL; the cron has no user, so fall back to
    -- 'system' exactly as InvoiceGenerator does.
    coalesce(s.owner_id, s.created_by_id, 'system'), v_now, v_now
  ) returning id into v_invoice_id;

  -- The fixed retainer fee
  if coalesce(s.amount, 0) <> 0 then
    insert into public.invoice_line_items
      (invoice_id, description, quantity, unit_price, created_at)
    values (v_invoice_id, coalesce(nullif(s.line_description, ''), s.name),
            1, s.amount, v_now);
  end if;

  -- Optionally roll the period's unbilled billable hours in as extra lines,
  -- grouped by task and rate exactly as InvoiceGenerator groups them.
  if coalesce(s.include_unbilled_hours, false) and s.project_id is not null then
    v_from := coalesce(s.last_run_date, s.start_date, v_now - 31 * 86400000::bigint);

    insert into public.invoice_line_items
      (invoice_id, description, quantity, unit_price, time_entry_ids, created_at)
    select v_invoice_id,
           coalesce(t.name, 'General project work'),
           round(sum(te.duration), 2),
           coalesce(te.hourly_rate, 0),
           jsonb_agg(te.id),
           v_now
      from public.time_entries te
      left join public.tasks t on t.id = te.task_id
     where te.project_id = s.project_id
       and te.is_billable and not te.is_running
       and te.invoice_id is null
       and coalesce(te.is_deleted, false) = false
       and te.date >= v_from and te.date <= v_now
     group by t.name, te.hourly_rate;

    update public.time_entries
       set invoice_id = v_invoice_id, updated_at = v_now
     where project_id = s.project_id
       and is_billable and not is_running
       and invoice_id is null
       and coalesce(is_deleted, false) = false
       and date >= v_from and date <= v_now;
  end if;

  v_next := (extract(epoch from (
      to_timestamp(coalesce(s.next_run_date, v_now) / 1000.0)
      + case s.frequency
          when 'quarterly' then interval '3 months'
          when 'annual'    then interval '1 year'
          else                  interval '1 month'
        end)) * 1000)::bigint;

  update public.recurring_invoices set
    last_run_date = v_now,
    next_run_date = v_next,
    -- A schedule that has run past its end date stops on its own.
    status = case when s.end_date is not null and v_next > s.end_date
                  then 'ended' else s.status end,
    updated_at = v_now
  where id = p_schedule_id;

  return v_invoice_id;
end; $$;

grant execute on function public.generate_recurring_invoice(character varying) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. An issued tax invoice is legally frozen
-- ---------------------------------------------------------------------------
-- Once Green Invoice has allocated a document number, the amounts on that
-- invoice are part of a filed tax document. The UI marks them read-only, but
-- this trigger is the guard that actually holds.
create or replace function public.guard_issued_invoice()
returns trigger
language plpgsql
as $$
begin
  if old.external_doc_number is not null
     and (new.subtotal   is distinct from old.subtotal
       or new.tax_rate   is distinct from old.tax_rate
       or new.currency   is distinct from old.currency
       or new.account_id is distinct from old.account_id) then
    raise exception
      'Invoice % was issued as tax document % — its amounts can no longer be changed',
      old.invoice_number, old.external_doc_number;
  end if;
  return new;
end; $$;

drop trigger if exists trg_guard_issued_invoice on public.invoices;
create trigger trg_guard_issued_invoice
  before update on public.invoices
  for each row execute function public.guard_issued_invoice();

create or replace function public.guard_issued_invoice_lines()
returns trigger
language plpgsql
as $$
declare
  v_invoice_id varchar;
  v_doc        varchar;
  v_number     varchar;
begin
  v_invoice_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  select external_doc_number, invoice_number into v_doc, v_number
    from public.invoices where id = v_invoice_id;
  if v_doc is not null then
    raise exception
      'Invoice % was issued as tax document % — its line items can no longer be changed',
      v_number, v_doc;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

drop trigger if exists trg_guard_issued_invoice_lines on public.invoice_line_items;
create trigger trg_guard_issued_invoice_lines
  before insert or update or delete on public.invoice_line_items
  for each row execute function public.guard_issued_invoice_lines();

-- ---------------------------------------------------------------------------
-- 5. Backfill
-- ---------------------------------------------------------------------------
-- 5a. Line totals, then subtotals, through the triggers above.
update public.invoice_line_items
   set total_price = round(coalesce(quantity, 0) * coalesce(unit_price, 0), 2)
 where total_price is distinct from round(coalesce(quantity, 0) * coalesce(unit_price, 0), 2);

update public.invoices i set subtotal = sub.amt
  from (
    select invoice_id, coalesce(sum(total_price), 0) as amt
      from public.invoice_line_items
     where coalesce(is_deleted, false) = false
     group by invoice_id
  ) sub
 where i.id = sub.invoice_id and i.subtotal is distinct from sub.amt;

-- 5b. Invoices already marked paid get a real payment row rather than a bare
--     amount_paid value — otherwise the next line-item touch would recompute
--     amount_paid as 0 and knock them back to "sent".
insert into public.invoice_payments
  (invoice_id, amount, paid_at, method, reference, notes, created_by_id, created_at)
select i.id,
       i.total_amount,
       coalesce(i.paid_date, i.issue_date, public.epoch_ms()),
       'other',
       null,
       'Backfilled from the invoice''s paid status when payment tracking was added.',
       i.created_by_id,
       public.epoch_ms()
from public.invoices i
where i.status = 'paid'
  and coalesce(i.total_amount, 0) > 0
  and not exists (
    select 1 from public.invoice_payments p
     where p.invoice_id = i.id and coalesce(p.is_deleted, false) = false
  );

-- 5c. Settle amount_paid / balance / status for every invoice.
do $$
declare r record;
begin
  for r in select id from public.invoices loop
    perform public.refresh_invoice_derived(r.id);
  end loop;
end $$;
