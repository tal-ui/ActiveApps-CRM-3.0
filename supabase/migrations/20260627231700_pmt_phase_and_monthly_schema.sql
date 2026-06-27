-- ============================================================================
-- PMT ERD — extend the existing model with a Phase tier between projects and
-- tasks, plus Monthly Summary / Monthly Line Item billing objects.
--
-- Additive only. Mirrors existing conventions:
--   * ids: varchar holding a text uuid  (uuid_generate_v4()::text)
--   * dates: bigint epoch-milliseconds
--   * audit: owner_id / created_by_id (varchar, not null), created_at/updated_at
--     (bigint epoch-ms defaults), is_deleted boolean soft-delete
--   * RLS: permissive authenticated policies + service_role full access
--
-- Salesforce field fidelity:
--   * Formula fields  -> Postgres GENERATED columns (same-row math)
--   * Roll-Up Summary -> trigger-maintained columns on the parent
--   * cross-object formula fields (Monthly Line Item) -> security_invoker view
-- ============================================================================

-- epoch-ms default reused below
-- ((extract(epoch from now()) * 1000))::bigint

-- ----------------------------------------------------------------------------
-- 1) PMT Phase  ->  public.phases   (master-detail child of projects)
-- ----------------------------------------------------------------------------
create table if not exists public.phases (
  id                   varchar primary key default (uuid_generate_v4())::text,
  project_id           varchar not null references public.projects(id) on delete cascade,
  name                 varchar not null,
  phase_description    text,
  phase_health         varchar default 'not_started'
                         check (phase_health in
                           ('not_started','on_track','at_risk','off_track','complete')),
  sort_order           numeric default 0,
  start_date           bigint,

  -- Roll-Up Summary (from child PMT Tasks) — maintained by trigger
  task_count           integer not null default 0,   -- COUNT(PMT Task)
  completed_task_count integer not null default 0,    -- COUNT(PMT Task where done)
  end_date_rollup      bigint,                         -- MAX(PMT Task due date)

  -- Formula fields — generated from same-row values
  phase_completion_pct numeric generated always as (
    case when task_count > 0
         then round((completed_task_count::numeric / task_count) * 100, 2)
         else 0 end
  ) stored,
  duration_days        numeric generated always as (
    case when start_date is not null and end_date_rollup is not null
         then round((end_date_rollup - start_date) / 86400000.0, 1)
         else null end
  ) stored,

  currency             varchar default 'ILS',
  owner_id             varchar not null,
  created_by_id        varchar not null,
  created_at           bigint not null default ((extract(epoch from now()) * 1000))::bigint,
  updated_at           bigint not null default ((extract(epoch from now()) * 1000))::bigint,
  is_deleted           boolean default false
);
create index if not exists idx_phases_project on public.phases(project_id);

-- ----------------------------------------------------------------------------
-- 2) PMT Task.Phase  ->  tasks.phase_id   (lookup to the new phase tier)
-- ----------------------------------------------------------------------------
alter table public.tasks
  add column if not exists phase_id varchar
    references public.phases(id) on delete set null;
create index if not exists idx_tasks_phase on public.tasks(phase_id);

-- ----------------------------------------------------------------------------
-- 3) PMT Project roll-ups (from child phases) — added to existing projects
-- ----------------------------------------------------------------------------
alter table public.projects
  add column if not exists phase_count integer not null default 0,
  add column if not exists phase_end_date_rollup bigint;   -- MAX(phase end_date_rollup)

-- ----------------------------------------------------------------------------
-- 4) Roll-up trigger functions
-- ----------------------------------------------------------------------------
-- Recompute a single phase's task roll-ups
create or replace function public.recompute_phase_rollups(p_phase_id varchar)
returns void language plpgsql as $$
begin
  if p_phase_id is null then return; end if;
  update public.phases ph set
    task_count           = sub.cnt,
    completed_task_count = sub.done,
    end_date_rollup      = sub.max_due,
    updated_at           = ((extract(epoch from now()) * 1000))::bigint
  from (
    select
      count(*) filter (where coalesce(t.is_deleted,false) = false) as cnt,
      count(*) filter (where coalesce(t.is_deleted,false) = false and t.status = 'done') as done,
      max(t.due_date) filter (where coalesce(t.is_deleted,false) = false) as max_due
    from public.tasks t
    where t.phase_id = p_phase_id
  ) sub
  where ph.id = p_phase_id;
end; $$;

-- Recompute a single project's phase roll-ups
create or replace function public.recompute_project_phase_rollups(p_project_id varchar)
returns void language plpgsql as $$
begin
  if p_project_id is null then return; end if;
  update public.projects pr set
    phase_count           = sub.cnt,
    phase_end_date_rollup = sub.max_end,
    updated_at            = ((extract(epoch from now()) * 1000))::bigint
  from (
    select
      count(*) filter (where coalesce(ph.is_deleted,false) = false) as cnt,
      max(ph.end_date_rollup) filter (where coalesce(ph.is_deleted,false) = false) as max_end
    from public.phases ph
    where ph.project_id = p_project_id
  ) sub
  where pr.id = p_project_id;
end; $$;

-- tasks -> phases
create or replace function public.tasks_phase_rollup_trg()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.phase_id is distinct from old.phase_id then
      perform public.recompute_phase_rollups(old.phase_id);
    end if;
    perform public.recompute_phase_rollups(new.phase_id);
    return new;
  elsif tg_op = 'INSERT' then
    perform public.recompute_phase_rollups(new.phase_id);
    return new;
  else
    perform public.recompute_phase_rollups(old.phase_id);
    return old;
  end if;
end; $$;

drop trigger if exists trg_tasks_phase_rollup on public.tasks;
create trigger trg_tasks_phase_rollup
after insert or delete or update of phase_id, status, due_date, is_deleted
on public.tasks
for each row execute function public.tasks_phase_rollup_trg();

-- phases -> projects
create or replace function public.phases_project_rollup_trg()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      perform public.recompute_project_phase_rollups(old.project_id);
    end if;
    perform public.recompute_project_phase_rollups(new.project_id);
    return new;
  elsif tg_op = 'INSERT' then
    perform public.recompute_project_phase_rollups(new.project_id);
    return new;
  else
    perform public.recompute_project_phase_rollups(old.project_id);
    return old;
  end if;
end; $$;

drop trigger if exists trg_phases_project_rollup on public.phases;
create trigger trg_phases_project_rollup
after insert or delete or update of project_id, end_date_rollup, is_deleted
on public.phases
for each row execute function public.phases_project_rollup_trg();

-- ----------------------------------------------------------------------------
-- 5) Monthly Summary  ->  public.monthly_summaries  (master-detail of accounts)
-- ----------------------------------------------------------------------------
create table if not exists public.monthly_summaries (
  id            varchar primary key default (uuid_generate_v4())::text,
  account_id    varchar not null references public.accounts(id) on delete cascade,
  name          varchar not null,
  month         varchar check (month in
                  ('01','02','03','04','05','06','07','08','09','10','11','12')),
  year          varchar,
  summary_date  bigint,
  status        varchar default 'draft'
                  check (status in ('draft','submitted','approved','invoiced','paid')),
  rate          numeric default 0,           -- Currency(16,2)
  discount      numeric default 0,           -- Percent — e.g. 10 = 10%
  total_hrs     numeric default 0,           -- Number(5,2)

  -- Formula(Currency) — generated from same-row values
  sub_total     numeric generated always as (coalesce(rate,0) * coalesce(total_hrs,0)) stored,
  total_amount  numeric generated always as (
    coalesce(rate,0) * coalesce(total_hrs,0) * (1 - coalesce(discount,0) / 100.0)
  ) stored,

  currency      varchar default 'ILS',
  owner_id      varchar not null,
  created_by_id varchar not null,
  created_at    bigint not null default ((extract(epoch from now()) * 1000))::bigint,
  updated_at    bigint not null default ((extract(epoch from now()) * 1000))::bigint,
  is_deleted    boolean default false
);
create index if not exists idx_monthly_summaries_account on public.monthly_summaries(account_id);

-- ----------------------------------------------------------------------------
-- 6) Monthly Line Item  ->  public.monthly_line_items
--    master-detail(Monthly Summary) + lookup(Project) + lookup(PMT Task)
-- ----------------------------------------------------------------------------
create sequence if not exists public.monthly_line_item_seq;

create table if not exists public.monthly_line_items (
  id                 varchar primary key default (uuid_generate_v4())::text,
  monthly_summary_id varchar not null references public.monthly_summaries(id) on delete cascade,
  project_id         varchar references public.projects(id) on delete set null,
  task_id            varchar references public.tasks(id) on delete set null,
  line_number        bigint not null default nextval('public.monthly_line_item_seq'),  -- Auto Number
  currency           varchar default 'ILS',
  owner_id           varchar not null,
  created_by_id      varchar not null,
  created_at         bigint not null default ((extract(epoch from now()) * 1000))::bigint,
  updated_at         bigint not null default ((extract(epoch from now()) * 1000))::bigint,
  is_deleted         boolean default false
);
create index if not exists idx_mli_summary on public.monthly_line_items(monthly_summary_id);
create index if not exists idx_mli_project on public.monthly_line_items(project_id);
create index if not exists idx_mli_task    on public.monthly_line_items(task_id);

-- Cross-object Formula fields (Item / Description / Start / End / Status /
-- Working Hours) pulled live from the linked PMT Task and that task's time
-- entries within the summary's month. Exposed as a security_invoker view so it
-- honours the base tables' RLS.
create or replace view public.v_monthly_line_items with (security_invoker = on) as
select
  mli.*,
  t.name        as item,            -- Formula(Text)
  t.description as description,      -- Formula(Text)
  t.created_at  as start_date,      -- Formula(Date)
  t.due_date    as end_date,        -- Formula(Date)
  t.status      as status,          -- Formula(Text)
  coalesce(wh.hours, 0) as working_hours   -- Formula(Number)
from public.monthly_line_items mli
left join public.tasks t              on t.id  = mli.task_id
left join public.monthly_summaries ms on ms.id = mli.monthly_summary_id
left join lateral (
  select sum(te.duration) as hours
  from public.time_entries te
  where te.task_id = mli.task_id
    and coalesce(te.is_deleted, false) = false
    and ms.year is not null and ms.month is not null
    and te.date >= (extract(epoch from make_timestamptz(ms.year::int, ms.month::int, 1, 0, 0, 0, 'UTC')) * 1000)::bigint
    and te.date <  (extract(epoch from (make_timestamptz(ms.year::int, ms.month::int, 1, 0, 0, 0, 'UTC') + interval '1 month')) * 1000)::bigint
) wh on true;

-- ----------------------------------------------------------------------------
-- 7) RLS + grants (mirror existing permissive pattern)
-- ----------------------------------------------------------------------------
alter table public.phases             enable row level security;
alter table public.monthly_summaries  enable row level security;
alter table public.monthly_line_items enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array['phases','monthly_summaries','monthly_line_items'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', tbl);
    execute format('grant all on public.%I to service_role;', tbl);
    execute format('create policy "Allow authenticated read on %1$s"   on public.%1$I for select to authenticated using (true);', tbl);
    execute format('create policy "Allow authenticated insert on %1$s" on public.%1$I for insert to authenticated with check (true);', tbl);
    execute format('create policy "Allow authenticated update on %1$s" on public.%1$I for update to authenticated using (true) with check (true);', tbl);
    execute format('create policy "Allow authenticated delete on %1$s" on public.%1$I for delete to authenticated using (true);', tbl);
    execute format('create policy "Allow service_role full access on %1$s" on public.%1$I for all to service_role using (true) with check (true);', tbl);
  end loop;
end $$;

grant usage, select on sequence public.monthly_line_item_seq to authenticated, service_role;
grant select on public.v_monthly_line_items to authenticated, service_role;
