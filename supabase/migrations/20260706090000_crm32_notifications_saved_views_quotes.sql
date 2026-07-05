-- ============================================================================
-- CRM 3.2 "Revenue & Flow": in-app notifications (+ DB triggers), saved list
-- views, and quotes hardening (RLS that the never-used tables were missing,
-- plus the quote -> invoice conversion link).
--
-- Additive only. House conventions: text-uuid ids, epoch-ms bigint dates,
-- permissive authenticated RLS + service_role ALL.
-- Recon findings baked in: quotes/quote_line_items had RLS enabled with ZERO
-- policies (all app access would be denied); storage policies for the private
-- 'attachments' bucket already exist (attachments_obj_*); attachments table
-- already has authenticated ALL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) notifications
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id           varchar primary key default (extensions.uuid_generate_v4())::text,
  recipient_id varchar,                -- null = broadcast to everyone
  type         varchar not null,       -- lead_created | deal_won | deal_lost | invoice_overdue | invoice_paid | task_assigned
  title        varchar not null,
  body         text,
  entity_type  varchar,
  entity_id    varchar,
  url_path     varchar,
  is_read      boolean not null default false,
  created_at   bigint not null default ((extract(epoch from now()) * 1000))::bigint
);
create index if not exists idx_notifications_recipient_unread
  on public.notifications(recipient_id, is_read);
create index if not exists idx_notifications_created
  on public.notifications(created_at desc);

alter table public.notifications enable row level security;
grant select, insert, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
drop policy if exists "Allow authenticated read on notifications" on public.notifications;
create policy "Allow authenticated read on notifications" on public.notifications for select to authenticated using (true);
drop policy if exists "Allow authenticated insert on notifications" on public.notifications;
create policy "Allow authenticated insert on notifications" on public.notifications for insert to authenticated with check (true);
drop policy if exists "Allow authenticated update on notifications" on public.notifications;
create policy "Allow authenticated update on notifications" on public.notifications for update to authenticated using (true) with check (true);
drop policy if exists "Allow authenticated delete on notifications" on public.notifications;
create policy "Allow authenticated delete on notifications" on public.notifications for delete to authenticated using (true);
drop policy if exists "Allow service_role full access on notifications" on public.notifications;
create policy "Allow service_role full access on notifications" on public.notifications for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 2) Notification triggers. Exception-swallowing on purpose: a notification
--    bug must never block a lead/deal/invoice/task write (hot path).
-- ----------------------------------------------------------------------------
create or replace function public.notify_lead_created() returns trigger
language plpgsql as $$
begin
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, url_path)
  values (null, 'lead_created',
          'New lead: ' || nullif(trim(coalesce(new.first_name,'') || ' ' || coalesce(new.last_name,'')), ''),
          coalesce(new.company, ''), 'lead', new.id, '/leads/' || new.id);
  return new;
exception when others then
  return new;
end; $$;
drop trigger if exists trg_notify_lead_created on public.leads;
create trigger trg_notify_lead_created
after insert on public.leads
for each row execute function public.notify_lead_created();

create or replace function public.notify_deal_closed() returns trigger
language plpgsql as $$
begin
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, url_path)
  values (null,
          case when new.stage = 'closed_won' then 'deal_won' else 'deal_lost' end,
          case when new.stage = 'closed_won' then 'Deal won: ' else 'Deal lost: ' end || coalesce(new.name, 'Opportunity'),
          case when new.amount is not null then 'Amount: ' || new.amount::text || ' ' || coalesce(new.currency, 'ILS') else '' end,
          'opportunity', new.id, '/opportunities/' || new.id);
  return new;
exception when others then
  return new;
end; $$;
drop trigger if exists trg_notify_deal_closed on public.opportunities;
create trigger trg_notify_deal_closed
after update of stage on public.opportunities
for each row
when (new.stage is distinct from old.stage and new.stage in ('closed_won','closed_lost'))
execute function public.notify_deal_closed();

create or replace function public.notify_invoice_status() returns trigger
language plpgsql as $$
begin
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, url_path)
  values (null,
          case when new.status = 'paid' then 'invoice_paid' else 'invoice_overdue' end,
          case when new.status = 'paid' then 'Invoice paid: ' else 'Invoice overdue: ' end || coalesce(new.invoice_number, ''),
          'Total: ' || coalesce(new.total_amount, 0)::text || ' ' || coalesce(new.currency, 'ILS'),
          'invoice', new.id, '/invoices/' || new.id);
  return new;
exception when others then
  return new;
end; $$;
drop trigger if exists trg_notify_invoice_status on public.invoices;
create trigger trg_notify_invoice_status
after update of status on public.invoices
for each row
when (new.status is distinct from old.status and new.status in ('overdue','paid'))
execute function public.notify_invoice_status();

create or replace function public.notify_task_assigned() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.assignee_id = old.assignee_id then
    return new;
  end if;
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, url_path)
  values (new.assignee_id, 'task_assigned',
          'Task assigned: ' || coalesce(new.name, 'Task'),
          coalesce(new.priority, ''), 'task', new.id, '/tasks/' || new.id);
  return new;
exception when others then
  return new;
end; $$;
drop trigger if exists trg_notify_task_assigned on public.tasks;
create trigger trg_notify_task_assigned
after insert or update of assignee_id on public.tasks
for each row
when (new.assignee_id is not null)
execute function public.notify_task_assigned();

-- ----------------------------------------------------------------------------
-- 3) saved_views (per-user list filters; user-preference data -> hard delete)
-- ----------------------------------------------------------------------------
create table if not exists public.saved_views (
  id          varchar primary key default (extensions.uuid_generate_v4())::text,
  object_name varchar not null,
  name        varchar not null,
  config      jsonb not null default '{}'::jsonb,  -- {filters:[], sortField, sortAsc}
  owner_id    varchar not null,
  is_default  boolean not null default false,
  created_at  bigint not null default ((extract(epoch from now()) * 1000))::bigint,
  updated_at  bigint not null default ((extract(epoch from now()) * 1000))::bigint
);
create index if not exists idx_saved_views_owner_object
  on public.saved_views(owner_id, object_name);

alter table public.saved_views enable row level security;
grant select, insert, update, delete on public.saved_views to authenticated;
grant all on public.saved_views to service_role;
drop policy if exists "Allow authenticated read on saved_views" on public.saved_views;
create policy "Allow authenticated read on saved_views" on public.saved_views for select to authenticated using (true);
drop policy if exists "Allow authenticated insert on saved_views" on public.saved_views;
create policy "Allow authenticated insert on saved_views" on public.saved_views for insert to authenticated with check (true);
drop policy if exists "Allow authenticated update on saved_views" on public.saved_views;
create policy "Allow authenticated update on saved_views" on public.saved_views for update to authenticated using (true) with check (true);
drop policy if exists "Allow authenticated delete on saved_views" on public.saved_views;
create policy "Allow authenticated delete on saved_views" on public.saved_views for delete to authenticated using (true);
drop policy if exists "Allow service_role full access on saved_views" on public.saved_views;
create policy "Allow service_role full access on saved_views" on public.saved_views for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 4) Quotes hardening: the tables exist with RLS ENABLED but no policies
--    (verified) — every app query would be denied. Add the house pattern,
--    plus the conversion link column.
-- ----------------------------------------------------------------------------
alter table public.quotes
  add column if not exists invoice_id varchar references public.invoices(id) on delete set null;

grant select, insert, update, delete on public.quotes to authenticated;
grant all on public.quotes to service_role;
drop policy if exists "Allow authenticated read on quotes" on public.quotes;
create policy "Allow authenticated read on quotes" on public.quotes for select to authenticated using (true);
drop policy if exists "Allow authenticated insert on quotes" on public.quotes;
create policy "Allow authenticated insert on quotes" on public.quotes for insert to authenticated with check (true);
drop policy if exists "Allow authenticated update on quotes" on public.quotes;
create policy "Allow authenticated update on quotes" on public.quotes for update to authenticated using (true) with check (true);
drop policy if exists "Allow authenticated delete on quotes" on public.quotes;
create policy "Allow authenticated delete on quotes" on public.quotes for delete to authenticated using (true);
drop policy if exists "Allow service_role full access on quotes" on public.quotes;
create policy "Allow service_role full access on quotes" on public.quotes for all to service_role using (true) with check (true);

grant select, insert, update, delete on public.quote_line_items to authenticated;
grant all on public.quote_line_items to service_role;
drop policy if exists "Allow authenticated read on quote_line_items" on public.quote_line_items;
create policy "Allow authenticated read on quote_line_items" on public.quote_line_items for select to authenticated using (true);
drop policy if exists "Allow authenticated insert on quote_line_items" on public.quote_line_items;
create policy "Allow authenticated insert on quote_line_items" on public.quote_line_items for insert to authenticated with check (true);
drop policy if exists "Allow authenticated update on quote_line_items" on public.quote_line_items;
create policy "Allow authenticated update on quote_line_items" on public.quote_line_items for update to authenticated using (true) with check (true);
drop policy if exists "Allow authenticated delete on quote_line_items" on public.quote_line_items;
create policy "Allow authenticated delete on quote_line_items" on public.quote_line_items for delete to authenticated using (true);
drop policy if exists "Allow service_role full access on quote_line_items" on public.quote_line_items;
create policy "Allow service_role full access on quote_line_items" on public.quote_line_items for all to service_role using (true) with check (true);
