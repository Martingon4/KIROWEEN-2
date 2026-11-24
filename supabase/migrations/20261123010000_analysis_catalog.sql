-- Analysis scenarios and cost catalog (FT-11, FT-12), spec 03 task 1.
-- Both datasets are curated, versioned, and immutable: a change ships under a new
-- scenario slug or catalog version, so historical analysis results never move.

create table public.analysis_scenarios (
  id uuid primary key,
  site_id uuid not null references public.sites (id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  local_datetime timestamp not null,
  timezone text not null,
  instant_utc timestamptz not null,
  azimuth_rad numeric(9, 6) not null check (azimuth_rad >= 0 and azimuth_rad < 2 * pi()),
  elevation_rad numeric(9, 6) not null check (elevation_rad >= radians(10)),
  generator text not null,
  dataset_checksum text not null check (dataset_checksum ~ '^[a-f0-9]{64}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (site_id, slug)
);

create table public.catalog_versions (
  id uuid primary key,
  site_id uuid not null references public.sites (id) on delete restrict,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  version text not null,
  effective_from timestamptz not null,
  source text not null,
  price_date date not null,
  is_illustrative boolean not null,
  assumption_owner text,
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (site_id, version),
  constraint catalog_versions_assumption check (
    not is_illustrative
    or (assumption_owner is not null and char_length(assumption_owner) between 1 and 100)
  )
);

create type public.catalog_unit as enum ('u', 'm', 'm2', 'jornada');

create table public.catalog_items (
  catalog_version_id uuid not null references public.catalog_versions (id) on delete restrict,
  code text not null check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  kind public.intervention_kind not null,
  unit public.catalog_unit not null,
  quantity_formula text not null,
  price_low_cents bigint,
  price_high_cents bigint,
  is_assumption boolean not null default false,
  assumption_owner text,
  assumption_date date,
  primary key (catalog_version_id, code),
  unique (catalog_version_id, kind),
  constraint catalog_items_price_range check (
    (price_low_cents is null and price_high_cents is null)
    or price_low_cents <= price_high_cents
  ),
  constraint catalog_items_assumption check (
    not is_assumption
    or (assumption_owner is not null and assumption_date is not null)
  )
);

-- Exclusive-zone overlap threshold for merge conflict detection (FT-08).
alter table public.sites
  add column merge_overlap_threshold_m2 numeric not null default 1.0
    check (merge_overlap_threshold_m2 > 0);

alter table public.analysis_scenarios enable row level security;
alter table public.catalog_versions enable row level security;
alter table public.catalog_items enable row level security;

revoke all on table public.analysis_scenarios from anon, authenticated;
revoke all on table public.catalog_versions from anon, authenticated;
revoke all on table public.catalog_items from anon, authenticated;

-- Curated data changes only through new slugs or versions, never in place.
create or replace function public.prevent_curated_data_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'immutable_curated_data';
end;
$$;

revoke all on function public.prevent_curated_data_change() from public, anon, authenticated;

create trigger analysis_scenarios_are_immutable
  before update or delete on public.analysis_scenarios
  for each row execute function public.prevent_curated_data_change();

create trigger analysis_scenarios_cannot_be_truncated
  before truncate on public.analysis_scenarios
  for each statement execute function public.prevent_curated_data_change();

create trigger catalog_versions_are_immutable
  before update or delete on public.catalog_versions
  for each row execute function public.prevent_curated_data_change();

create trigger catalog_versions_cannot_be_truncated
  before truncate on public.catalog_versions
  for each statement execute function public.prevent_curated_data_change();

create trigger catalog_items_are_immutable
  before update or delete on public.catalog_items
  for each row execute function public.prevent_curated_data_change();

create trigger catalog_items_cannot_be_truncated
  before truncate on public.catalog_items
  for each statement execute function public.prevent_curated_data_change();

-- A catalog version cannot be backdated to rewrite historical pinning. The bootstrap
-- setting exists so the seed can load the first version with a past effective date.
create or replace function public.catalog_version_effective_from_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.effective_from < pg_catalog.now()
    and pg_catalog.current_setting('app.catalog_bootstrap', true) is distinct from 'on'
  then
    raise exception using errcode = '22023', message = 'catalog_backdated';
  end if;
  return new;
end;
$$;

revoke all on function public.catalog_version_effective_from_check() from public, anon, authenticated;

create trigger catalog_versions_no_backdating
  before insert on public.catalog_versions
  for each row execute function public.catalog_version_effective_from_check();

-- Bumped together with the formula set; stored in every analysis result.
create or replace function public.analysis_engine_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'ft-analysis@1';
$$;

revoke all on function public.analysis_engine_version() from public, anon, authenticated;

-- Resolves one snapshot reference for analysis and compare. References:
--   publication:<uuid>  visible publication on a published site
--   baseline:<uuid>     baseline of a published site (synthetic empty snapshot)
--   revision:<uuid>     own, not-deleted branch head revision only
-- Invisible references are indistinguishable from missing ones.
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
  if p_ref is null then
    raise exception using errcode = '22023', message = 'invalid_snapshot_ref';
  end if;
  prefix := pg_catalog.split_part(p_ref, ':', 1);
  begin
    target := pg_catalog.split_part(p_ref, ':', 2)::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_snapshot_ref';
  end;

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
  elsif prefix = 'revision' then
    return query
    select 'revision', r.site_id, r.baseline_id, r.id
    from public.revisions as r
    join public.branches as b on b.id = r.branch_id
    where r.id = target
      and b.owner_id = auth.uid()
      and not b.is_deleted;
  else
    raise exception using errcode = '22023', message = 'invalid_snapshot_ref';
  end if;

  if not found then
    raise exception using errcode = 'P0002', message = 'snapshot_not_found';
  end if;
end;
$$;

revoke all on function public.resolve_snapshot_ref(text) from public, anon, authenticated;
