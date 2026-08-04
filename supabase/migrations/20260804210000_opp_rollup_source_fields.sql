-- Phase 1 foundation:
--   1. Roll opportunity_line_items totals up into opportunities.amount, so the
--      pipeline/dashboard figures can never disagree with a deal's own lines.
--      (Mirrors the quote rollup in 20260707100000_quote_totals_rollup.sql.)
--   2. Add `source` to accounts and opportunities so lead-source attribution
--      survives conversion and won revenue can be traced back to its origin.

-- 1. Line total is always quantity * unit_price * (1 - discount%) ------------
create or replace function public.opp_line_total()
returns trigger
language plpgsql
as $$
begin
  new.total_price := round(
    coalesce(new.quantity, 0) * coalesce(new.unit_price, 0)
      * (1 - coalesce(new.discount, 0) / 100.0), 2);
  return new;
end; $$;

drop trigger if exists trg_opp_line_total on public.opportunity_line_items;
create trigger trg_opp_line_total
  before insert or update on public.opportunity_line_items
  for each row execute function public.opp_line_total();

-- 2. Roll the line totals up into opportunities.amount ----------------------
-- Deals with no line items keep whatever amount was typed on the deal.
create or replace function public.recompute_opportunity_amount(p_opportunity_id varchar)
returns void
language plpgsql
as $$
declare
  v_count integer;
begin
  if p_opportunity_id is null then return; end if;
  select count(*) into v_count
  from public.opportunity_line_items li
  where li.opportunity_id = p_opportunity_id
    and coalesce(li.is_deleted, false) = false;
  if v_count = 0 then return; end if;

  update public.opportunities o set
    amount     = sub.amt,
    updated_at = ((extract(epoch from now()) * 1000))::bigint
  from (
    select coalesce(sum(li.total_price), 0) as amt
    from public.opportunity_line_items li
    where li.opportunity_id = p_opportunity_id
      and coalesce(li.is_deleted, false) = false
  ) sub where o.id = p_opportunity_id;
end; $$;

create or replace function public.opp_line_rollup_trg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.opportunity_id is distinct from old.opportunity_id then
      perform public.recompute_opportunity_amount(old.opportunity_id);
    end if;
    perform public.recompute_opportunity_amount(new.opportunity_id); return new;
  elsif tg_op = 'INSERT' then
    perform public.recompute_opportunity_amount(new.opportunity_id); return new;
  else
    perform public.recompute_opportunity_amount(old.opportunity_id); return old;
  end if;
end; $$;

drop trigger if exists trg_opp_line_rollup on public.opportunity_line_items;
create trigger trg_opp_line_rollup
  after insert or update or delete on public.opportunity_line_items
  for each row execute function public.opp_line_rollup_trg();

-- 3. Backfill line totals, then amounts -------------------------------------
update public.opportunity_line_items
  set total_price = round(coalesce(quantity, 0) * coalesce(unit_price, 0)
                      * (1 - coalesce(discount, 0) / 100.0), 2)
  where total_price is distinct from round(coalesce(quantity, 0) * coalesce(unit_price, 0)
                      * (1 - coalesce(discount, 0) / 100.0), 2);

do $$
declare r record;
begin
  for r in select distinct opportunity_id from public.opportunity_line_items
           where opportunity_id is not null
  loop
    perform public.recompute_opportunity_amount(r.opportunity_id);
  end loop;
end $$;

-- 4. Source attribution carried from the lead -------------------------------
alter table public.accounts      add column if not exists source varchar;
alter table public.opportunities add column if not exists source varchar;
