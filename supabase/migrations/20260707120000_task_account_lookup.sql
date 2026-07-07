-- Task <-> Account lookup relationship.
-- tasks.project_id is already the master-detail side (NOT NULL + ON DELETE
-- CASCADE); account_id is a plain lookup (ON DELETE SET NULL) that always
-- mirrors the task's project's account: filled on insert when omitted and
-- resynced whenever the task moves to another project. Projects require an
-- account, so this is a consistent denormalization.

alter table public.tasks
  add column if not exists account_id varchar references public.accounts(id) on delete set null;

create index if not exists idx_tasks_account_id on public.tasks(account_id);

-- Backfill existing rows from their project
update public.tasks t
  set account_id = p.account_id
  from public.projects p
  where t.project_id = p.id and t.account_id is null;

-- Default + resync trigger (mirrors the time-entry rate inheritance style)
create or replace function public.task_account_default_trg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.account_id is null and new.project_id is not null then
      select p.account_id into new.account_id
        from public.projects p where p.id = new.project_id;
    end if;
  elsif new.project_id is distinct from old.project_id then
    select p.account_id into new.account_id
      from public.projects p where p.id = new.project_id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_task_account_default on public.tasks;
create trigger trg_task_account_default
  before insert or update on public.tasks
  for each row execute function public.task_account_default_trg();
