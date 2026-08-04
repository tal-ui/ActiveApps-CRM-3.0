-- Automation engine: make automation_rules executable and wire record events
-- to the `automations` edge function (same pg_net pattern as notify_slack()).

-- 1. Rules need to know which object they watch, and which field to watch ----
alter table public.automation_rules
  add column if not exists object_name  varchar,
  add column if not exists trigger_field varchar;

-- Existing legacy rows (CRM 2.0 carryover) have no object and can never match;
-- disable them rather than deleting so they stay auditable.
update public.automation_rules set enabled = false where object_name is null;

create index if not exists idx_automation_rules_object
  on public.automation_rules (object_name) where enabled;

-- 2. Dispatcher: POST the record event to the automations function, but only
--    when something is actually listening — no rules, no HTTP call.
create or replace function public.run_automations()
returns trigger
language plpgsql
security definer
as $$
declare
  v_event text := TG_TABLE_NAME || '.' ||
    case when TG_OP = 'INSERT' then 'created' else 'updated' end;
begin
  -- Only dispatch when something is listening. webhooks.events is text[], so
  -- compare with a text[] literal — a varchar[] cast raises "operator does not
  -- exist" and would be swallowed by the handler at the bottom.
  if not exists (
    select 1 from public.automation_rules
    where enabled and object_name = TG_TABLE_NAME
  ) and not exists (
    select 1 from public.webhooks
    where enabled and events @> array[v_event]::text[]
  ) then
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://ndzvqldluzfstowhhkvd.supabase.co/functions/v1/automations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Publishable anon key, same as notify_slack() uses
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kenZxbGRsdXpmc3Rvd2hoa3ZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2OTkxMTMsImV4cCI6MjA5MDI3NTExM30.YSNvdwoE9Qo_QnHzXf4HrmC8b4hLOagfBDPhy8DILhk'
    ),
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'record', to_jsonb(NEW),
      'old_record', case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end
    ),
    timeout_milliseconds := 5000
  );
  return NEW;
exception when others then
  -- Never let automation dispatch block a write
  return NEW;
end; $$;

-- 3. Attach to the objects users can automate --------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'leads','accounts','contacts','opportunities','projects',
    'tasks','invoices','quotes','time_entries'
  ]
  loop
    execute format('drop trigger if exists automations_on_change on public.%I', t);
    execute format(
      'create trigger automations_on_change after insert or update on public.%I
         for each row execute function public.run_automations()', t);
  end loop;
end $$;
