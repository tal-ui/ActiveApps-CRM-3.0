-- Quote totals become formula-driven (same pattern as monthly_summaries):
--   1. quote_line_items.total_price := quantity * unit_price   (BEFORE trigger)
--   2. quotes.subtotal = sum of non-deleted line totals        (AFTER rollup trigger)
--   3. quotes.tax_amount / total_amount                        (generated columns)
--      tax_amount   = subtotal * tax_rate / 100
--      total_amount = subtotal + tax_amount
-- The app shows these fields read-only; no client code may write them.
-- Rollback: drop the two triggers + three functions, then drop the generated
-- columns and re-add tax_amount/total_amount as plain numeric default 0.

-- 1. Line total formula ------------------------------------------------------
create or replace function public.compute_quote_line_total_trg()
returns trigger
language plpgsql
as $$
begin
  new.total_price := round(coalesce(new.quantity, 0) * coalesce(new.unit_price, 0), 2);
  return new;
end; $$;

drop trigger if exists trg_quote_line_total on public.quote_line_items;
create trigger trg_quote_line_total
  before insert or update on public.quote_line_items
  for each row execute function public.compute_quote_line_total_trg();

-- 2. Subtotal rollup (mirrors recompute_summary_totals) ----------------------
create or replace function public.recompute_quote_totals(p_quote_id character varying)
returns void
language plpgsql
as $$
begin
  if p_quote_id is null then return; end if;
  update public.quotes q set
    subtotal   = sub.amt,
    updated_at = ((extract(epoch from now()) * 1000))::bigint
  from (
    select coalesce(sum(li.total_price), 0) as amt
    from public.quote_line_items li
    where li.quote_id = p_quote_id and coalesce(li.is_deleted, false) = false
  ) sub where q.id = p_quote_id;
end; $$;

create or replace function public.quote_line_rollup_trg()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.quote_id is distinct from old.quote_id then
      perform public.recompute_quote_totals(old.quote_id);
    end if;
    perform public.recompute_quote_totals(new.quote_id); return new;
  elsif tg_op = 'INSERT' then
    perform public.recompute_quote_totals(new.quote_id); return new;
  else
    perform public.recompute_quote_totals(old.quote_id); return old;
  end if;
end; $$;

drop trigger if exists trg_quote_line_rollup on public.quote_line_items;
create trigger trg_quote_line_rollup
  after insert or update or delete on public.quote_line_items
  for each row execute function public.quote_line_rollup_trg();

-- 3. tax_amount / total_amount become generated columns ----------------------
alter table public.quotes drop column if exists tax_amount;
alter table public.quotes drop column if exists total_amount;
alter table public.quotes add column tax_amount numeric
  generated always as
    (round(coalesce(subtotal, 0) * coalesce(tax_rate, 0) / 100.0, 2)) stored;
alter table public.quotes add column total_amount numeric
  generated always as
    (round(coalesce(subtotal, 0)
       + coalesce(subtotal, 0) * coalesce(tax_rate, 0) / 100.0, 2)) stored;

-- 4. Backfill existing rows (fires the triggers above; quotes without any
--    line items keep their current subtotal) --------------------------------
update public.quote_line_items
  set total_price = round(coalesce(quantity, 0) * coalesce(unit_price, 0), 2)
  where total_price is distinct from round(coalesce(quantity, 0) * coalesce(unit_price, 0), 2);

update public.quotes q set subtotal = sub.amt
  from (
    select quote_id, coalesce(sum(total_price), 0) as amt
    from public.quote_line_items
    where coalesce(is_deleted, false) = false
    group by quote_id
  ) sub
  where q.id = sub.quote_id and q.subtotal is distinct from sub.amt;
