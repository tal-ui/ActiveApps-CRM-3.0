-- ============================================================================
-- Consolidate Time Entries + Monthly Summary Line Items; drop Milestones &
-- Phases; move billing rate to the project level with computed Monthly Summary
-- totals.
--
--  1. Time Entry becomes the single "work line": child of a Task and a Monthly
--     Summary (both required in the app; DB columns stay nullable so the live
--     timer and the 226 existing rows keep working). monthly_line_items is
--     removed.
--  2. Milestones and Phases (and tasks.milestone_id / tasks.phase_id and the
--     project phase roll-ups) are removed entirely.
--  3. Rate is managed on the project (default 300). Each time entry inherits
--     the project's rate at write time; Monthly Summary total_hrs / sub_total
--     roll up from its time entries and total_amount is generated (− discount).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Remove Monthly Line Item (folded into Time Entry)
-- ---------------------------------------------------------------------------
drop view     if exists public.v_monthly_line_items;
drop table    if exists public.monthly_line_items cascade;
drop sequence if exists public.monthly_line_item_seq;

-- ---------------------------------------------------------------------------
-- 2) Remove Phases (+ roll-up plumbing) and Milestones
-- ---------------------------------------------------------------------------
drop trigger if exists trg_tasks_phase_rollup    on public.tasks;
drop trigger if exists trg_phases_project_rollup on public.phases;

alter table public.tasks    drop column if exists phase_id;
alter table public.tasks    drop column if exists milestone_id;
alter table public.projects drop column if exists phase_count;
alter table public.projects drop column if exists phase_end_date_rollup;

drop table if exists public.phases     cascade;
drop table if exists public.milestones cascade;

drop function if exists public.tasks_phase_rollup_trg();
drop function if exists public.phases_project_rollup_trg();
drop function if exists public.recompute_phase_rollups(varchar);
drop function if exists public.recompute_project_phase_rollups(varchar);

-- ---------------------------------------------------------------------------
-- 3) Time Entry -> child of Monthly Summary (required in app; nullable in DB)
-- ---------------------------------------------------------------------------
alter table public.time_entries
  add column if not exists monthly_summary_id varchar
    references public.monthly_summaries(id) on delete cascade;
create index if not exists idx_time_entries_summary on public.time_entries(monthly_summary_id);

-- ---------------------------------------------------------------------------
-- 4) Rate at the project level (default 300, currency NIS)
-- ---------------------------------------------------------------------------
alter table public.projects alter column hourly_rate set default 300;
alter table public.projects alter column currency    set default 'ILS';

-- Time entries inherit the project's rate when none is given (snapshot at
-- write time, so changing a project's rate never rewrites past billing).
create or replace function public.time_entry_inherit_rate()
returns trigger language plpgsql as $$
begin
  if new.hourly_rate is null and new.project_id is not null then
    select pr.hourly_rate into new.hourly_rate
    from public.projects pr where pr.id = new.project_id;
  end if;
  if new.hourly_rate is null then new.hourly_rate := 300; end if;
  return new;
end; $$;
drop trigger if exists trg_time_entry_inherit_rate on public.time_entries;
create trigger trg_time_entry_inherit_rate
before insert or update of project_id, hourly_rate on public.time_entries
for each row execute function public.time_entry_inherit_rate();

-- ---------------------------------------------------------------------------
-- 5) Monthly Summary computed fields: total_hrs / sub_total roll up from
--    time entries; total_amount generated (sub_total minus discount %).
--    Rate column removed (now project-level).
-- ---------------------------------------------------------------------------
alter table public.monthly_summaries drop column if exists total_amount;  -- generated
alter table public.monthly_summaries drop column if exists sub_total;     -- generated
alter table public.monthly_summaries drop column if exists rate;

alter table public.monthly_summaries add column if not exists sub_total numeric default 0;
alter table public.monthly_summaries
  add column if not exists total_amount numeric
    generated always as (coalesce(sub_total, 0) * (1 - coalesce(discount, 0) / 100.0)) stored;
-- total_hrs column is retained and becomes roll-up maintained.

create or replace function public.recompute_summary_totals(p_summary_id varchar)
returns void language plpgsql as $$
begin
  if p_summary_id is null then return; end if;
  update public.monthly_summaries ms set
    total_hrs  = sub.hrs,
    sub_total  = sub.amt,
    updated_at = ((extract(epoch from now()) * 1000))::bigint
  from (
    select
      coalesce(sum(te.duration), 0)                              as hrs,
      coalesce(sum(te.duration * coalesce(te.hourly_rate, 0)), 0) as amt
    from public.time_entries te
    where te.monthly_summary_id = p_summary_id
      and coalesce(te.is_deleted, false) = false
  ) sub
  where ms.id = p_summary_id;
end; $$;

create or replace function public.time_entry_summary_rollup_trg()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.monthly_summary_id is distinct from old.monthly_summary_id then
      perform public.recompute_summary_totals(old.monthly_summary_id);
    end if;
    perform public.recompute_summary_totals(new.monthly_summary_id);
    return new;
  elsif tg_op = 'INSERT' then
    perform public.recompute_summary_totals(new.monthly_summary_id);
    return new;
  else
    perform public.recompute_summary_totals(old.monthly_summary_id);
    return old;
  end if;
end; $$;
drop trigger if exists trg_time_entry_summary_rollup on public.time_entries;
create trigger trg_time_entry_summary_rollup
after insert or delete or update of monthly_summary_id, duration, hourly_rate, is_deleted
on public.time_entries
for each row execute function public.time_entry_summary_rollup_trg();
