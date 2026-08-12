-- Invoices become the outcome of a monthly hours summary, spanning projects.
--
-- invoices.project_id modelled one project per invoice, but every monthly
-- summary in this database spans 4-6 projects — a project-scoped generator
-- would emit 4-6 separate invoices per client per month. The billing unit is
-- the monthly summary (account + month), built from billable time entries
-- regardless of which project they sit on.
--
-- Order matters here: the junction is backfilled from project_id BEFORE the
-- column is dropped, or the existing invoice's project link is lost.
--
-- Rollback: drop the junction and its trigger, re-add invoices.project_id,
-- drop monthly_summary_id / discount_percent, and restore the previous
-- tax_amount / total_amount generated expressions (no discount term).

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists monthly_summary_id varchar
    references public.monthly_summaries(id),
  add column if not exists discount_percent numeric not null default 0;

create index if not exists idx_invoices_monthly_summary
  on public.invoices (monthly_summary_id) where monthly_summary_id is not null;

-- ---------------------------------------------------------------------------
-- 2. invoice_projects — the many-to-many an invoice actually has
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_projects (
  invoice_id varchar not null references public.invoices(id) on delete cascade,
  project_id varchar not null references public.projects(id) on delete cascade,
  created_at bigint not null default public.epoch_ms(),
  primary key (invoice_id, project_id)
);

create index if not exists idx_invoice_projects_project
  on public.invoice_projects (project_id);

alter table public.invoice_projects enable row level security;

drop policy if exists "Allow authenticated read on invoice_projects"   on public.invoice_projects;
drop policy if exists "Allow authenticated insert on invoice_projects" on public.invoice_projects;
drop policy if exists "Allow authenticated update on invoice_projects" on public.invoice_projects;
drop policy if exists "Allow authenticated delete on invoice_projects" on public.invoice_projects;
drop policy if exists "Allow service_role full access on invoice_projects" on public.invoice_projects;
create policy "Allow authenticated read on invoice_projects"
  on public.invoice_projects for select to authenticated using (true);
create policy "Allow authenticated insert on invoice_projects"
  on public.invoice_projects for insert to authenticated with check (true);
create policy "Allow authenticated update on invoice_projects"
  on public.invoice_projects for update to authenticated using (true) with check (true);
create policy "Allow authenticated delete on invoice_projects"
  on public.invoice_projects for delete to authenticated using (true);
create policy "Allow service_role full access on invoice_projects"
  on public.invoice_projects for all to service_role using (true) with check (true);

-- The junction is derived state: it is exactly the set of projects whose time
-- entries this invoice bills. Rebuilding it wholesale means it can never drift
-- from the billed work, however entries are moved around.
create or replace function public.refresh_invoice_projects(p_invoice_id character varying)
returns void
language plpgsql
as $$
begin
  if p_invoice_id is null then return; end if;

  delete from public.invoice_projects where invoice_id = p_invoice_id;

  insert into public.invoice_projects (invoice_id, project_id)
  select distinct te.invoice_id, te.project_id
    from public.time_entries te
   where te.invoice_id = p_invoice_id
     and te.project_id is not null
     and coalesce(te.is_deleted, false) = false
  on conflict do nothing;
end; $$;

create or replace function public.invoice_projects_trg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- An entry moving between invoices changes both sides.
    if new.invoice_id is distinct from old.invoice_id then
      perform public.refresh_invoice_projects(old.invoice_id);
    end if;
    perform public.refresh_invoice_projects(new.invoice_id);
    return new;
  elsif tg_op = 'INSERT' then
    perform public.refresh_invoice_projects(new.invoice_id);
    return new;
  else
    perform public.refresh_invoice_projects(old.invoice_id);
    return old;
  end if;
end; $$;

drop trigger if exists trg_invoice_projects on public.time_entries;
create trigger trg_invoice_projects
  after insert or update or delete on public.time_entries
  for each row execute function public.invoice_projects_trg();

-- ---------------------------------------------------------------------------
-- 3. Backfill the junction, THEN drop project_id
-- ---------------------------------------------------------------------------
-- From the column being removed (invoices that were pinned to one project)…
insert into public.invoice_projects (invoice_id, project_id)
select i.id, i.project_id
  from public.invoices i
 where i.project_id is not null
on conflict do nothing;

-- …and from the billed time entries, which is the real source going forward.
insert into public.invoice_projects (invoice_id, project_id)
select distinct te.invoice_id, te.project_id
  from public.time_entries te
 where te.invoice_id is not null
   and te.project_id is not null
   and coalesce(te.is_deleted, false) = false
on conflict do nothing;

alter table public.invoices drop column if exists project_id;

-- ---------------------------------------------------------------------------
-- 4. Generated columns learn about the discount
-- ---------------------------------------------------------------------------
-- Postgres won't let a generated column reference another generated column, so
-- the discount term is spelled out in each expression rather than reused.
alter table public.invoices drop column if exists tax_amount;
alter table public.invoices drop column if exists total_amount;
alter table public.invoices drop column if exists discount_amount;

alter table public.invoices add column discount_amount numeric
  generated always as
    (round(coalesce(subtotal, 0) * coalesce(discount_percent, 0) / 100.0, 2)) stored;

alter table public.invoices add column tax_amount numeric
  generated always as
    (round(
       (coalesce(subtotal, 0)
        - round(coalesce(subtotal, 0) * coalesce(discount_percent, 0) / 100.0, 2))
       * coalesce(tax_rate, 0) / 100.0, 2)) stored;

alter table public.invoices add column total_amount numeric
  generated always as
    (round(
       (coalesce(subtotal, 0)
        - round(coalesce(subtotal, 0) * coalesce(discount_percent, 0) / 100.0, 2))
       * (1 + coalesce(tax_rate, 0) / 100.0), 2)) stored;

-- ---------------------------------------------------------------------------
-- 5. Generating an invoice from a monthly summary
-- ---------------------------------------------------------------------------
-- Mirrors generate_recurring_invoice: one SQL implementation shared by the
-- Financial dashboard generator and the button on the summary record page.
create or replace function public.generate_invoice_from_summary(p_summary_id character varying)
returns character varying
language plpgsql
security definer
set search_path = public
as $$
declare
  s            public.monthly_summaries%rowtype;
  acc          public.accounts%rowtype;
  v_invoice_id varchar;
  v_prefix     text;
  v_seq        integer;
  v_now        bigint := public.epoch_ms();
  v_vat        numeric;
  v_hours      numeric;
  v_subtotal   numeric;
  v_period     text;
begin
  select * into s from public.monthly_summaries
   where id = p_summary_id and coalesce(is_deleted, false) = false;
  if not found then
    raise exception 'Monthly summary % not found', p_summary_id;
  end if;

  -- One summary bills once. Re-running must not create a second document for
  -- the same month's work.
  if exists (
    select 1 from public.invoices i
     where i.monthly_summary_id = p_summary_id
       and coalesce(i.is_deleted, false) = false
  ) then
    raise exception 'Monthly summary "%" has already been invoiced', s.name;
  end if;

  select * into acc from public.accounts where id = s.account_id;

  -- Bill the summary's own billable, unbilled, stopped entries — across every
  -- project they belong to. That set is the whole point of this change.
  select coalesce(sum(te.duration), 0),
         coalesce(sum(te.duration * coalesce(te.hourly_rate, 0)), 0)
    into v_hours, v_subtotal
    from public.time_entries te
   where te.monthly_summary_id = p_summary_id
     and te.is_billable
     and not te.is_running
     and te.invoice_id is null
     and coalesce(te.is_deleted, false) = false;

  if coalesce(v_subtotal, 0) <= 0 then
    raise exception 'Monthly summary "%" has no unbilled billable hours to invoice', s.name;
  end if;

  -- VAT: workspace default, waived when the client is flagged exempt.
  select case
           when coalesce(acc.vat_exempt, false) then 0
           else coalesce((settings->>'defaultVatRate')::numeric, 18)
         end
    into v_vat
    from public.workspace_settings limit 1;
  v_vat := coalesce(v_vat, case when coalesce(acc.vat_exempt, false) then 0 else 18 end);

  perform pg_advisory_xact_lock(hashtext('crm.invoice_number'));
  v_prefix := 'INV-' || to_char(now(), 'YYYY') || '-';
  select coalesce(max(substring(invoice_number from char_length(v_prefix) + 1)::integer), 0) + 1
    into v_seq
    from public.invoices
   where invoice_number like v_prefix || '%'
     and invoice_number ~ ('^' || v_prefix || '[0-9]+$');

  v_period := to_char(to_date(s.year || '-' || s.month || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');

  insert into public.invoices (
    account_id, monthly_summary_id, invoice_number, status,
    issue_date, due_date, subtotal, tax_rate, discount_percent, currency,
    notes, created_by_id, created_at, updated_at
  ) values (
    s.account_id, s.id,
    v_prefix || lpad(v_seq::text, 3, '0'),
    'draft', v_now, v_now + 30 * 86400000::bigint,
    0, v_vat, coalesce(s.discount, 0), coalesce(s.currency, 'ILS'),
    'Generated from monthly summary: ' || s.name,
    coalesce(s.owner_id, s.created_by_id, 'system'), v_now, v_now
  ) returning id into v_invoice_id;

  -- A single line for the month. Quantity 1 at the exact subtotal rather than
  -- hours x a blended rate: when rates differ across projects the blended
  -- figure rounds to a total that no longer reconciles with the summary.
  insert into public.invoice_line_items
    (invoice_id, description, quantity, unit_price, created_at)
  values (
    v_invoice_id,
    'Professional services — ' || v_period ||
      ' (' || trim(to_char(v_hours, 'FM999990.00')) || ' hours)',
    1, round(v_subtotal, 2), v_now
  );

  -- Stamping invoice_id fires trg_invoice_projects, which fills the junction
  -- with every project these entries belong to.
  update public.time_entries
     set invoice_id = v_invoice_id, updated_at = v_now
   where monthly_summary_id = p_summary_id
     and is_billable
     and not is_running
     and invoice_id is null
     and coalesce(is_deleted, false) = false;

  update public.monthly_summaries
     set status = 'invoiced', updated_at = v_now
   where id = p_summary_id;

  return v_invoice_id;
end; $$;

grant execute on function public.generate_invoice_from_summary(character varying) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The issued-invoice freeze has to cover the discount too
-- ---------------------------------------------------------------------------
-- discount_percent now moves the legal total, so it belongs in the same guard
-- as subtotal and tax_rate.
create or replace function public.guard_issued_invoice()
returns trigger
language plpgsql
as $$
begin
  if old.external_doc_number is not null
     and (new.subtotal         is distinct from old.subtotal
       or new.tax_rate         is distinct from old.tax_rate
       or new.discount_percent is distinct from old.discount_percent
       or new.currency         is distinct from old.currency
       or new.account_id       is distinct from old.account_id) then
    raise exception
      'Invoice % was issued as tax document % - its amounts can no longer be changed',
      old.invoice_number, old.external_doc_number;
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- 7. Settle derived values on every existing invoice
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.invoices loop
    perform public.refresh_invoice_derived(r.id);
  end loop;
end $$;
