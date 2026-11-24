-- Tester-found fixes for the analysis catalog (spec 03):
-- 1. A CHECK passes when its expression is NULL, so catalog_items accepted a pair
--    with exactly one null price. cost_compute treats low=null as "unpriced" but would
--    still compute amountHighCents, and low=set/high=null as "priced" with a null cap.
--    Prices are now a pair: both null (unpriced) or low <= high.
-- 2. resolve_snapshot_ref ignored trailing junk after the second colon
--    ("publication:<uuid>:anything" parsed as the uuid). The format is now strict.

alter table public.catalog_items
  drop constraint catalog_items_price_range,
  add constraint catalog_items_price_range check (
    (price_low_cents is null) = (price_high_cents is null)
    and (price_low_cents is null or price_low_cents <= price_high_cents)
  );

create or replace function public.resolve_snapshot_ref(p_ref text)
returns table (
  ref_kind text,
  site_id uuid,
  baseline_id uuid,
  revision_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  prefix text;
  target uuid;
begin
  if p_ref is null
    or p_ref !~ '^(publication|baseline|revision):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then
    raise exception using errcode = '22023', message = 'invalid_snapshot_ref';
  end if;
  prefix := pg_catalog.split_part(p_ref, ':', 1);
  target := pg_catalog.split_part(p_ref, ':', 2)::uuid;

  if prefix = 'publication' then
    return query
    select 'publication', r.site_id, r.baseline_id, r.id
    from public.publications as p
    join public.revisions as r on r.id = p.revision_id
    join public.sites as s on s.id = r.site_id
    where p.id = target
      and p.moderation_state = 'visible'
      and s.published;
  elsif prefix = 'baseline' then
    return query
    select 'baseline', b.site_id, b.id, null::uuid
    from public.site_baselines as b
    join public.sites as s on s.id = b.site_id
    where b.id = target
      and s.published;
  else
    return query
    select 'revision', r.site_id, r.baseline_id, r.id
    from public.revisions as r
    join public.branches as b on b.id = r.branch_id
    where r.id = target
      and b.owner_id = auth.uid()
      and not b.is_deleted;
  end if;

  if not found then
    raise exception using errcode = 'P0002', message = 'snapshot_not_found';
  end if;
end;
$$;

revoke all on function public.resolve_snapshot_ref(text) from public, anon, authenticated;
