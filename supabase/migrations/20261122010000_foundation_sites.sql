create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create type public.site_completeness as enum ('partial', 'reviewed');

create table public.sites (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name_es text not null check (char_length(name_es) between 1 and 100),
  name_en text not null check (char_length(name_en) between 1 and 100),
  locality_es text not null,
  locality_en text not null,
  timezone text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  metric_srid integer not null check (metric_srid > 0),
  completeness public.site_completeness not null,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.site_baselines (
  id uuid primary key,
  site_id uuid not null references public.sites (id) on delete restrict,
  version integer not null check (version > 0),
  boundary extensions.geometry(Polygon, 4326) not null,
  pedestrian_area extensions.geometry(Polygon, 4326),
  source_url text not null check (source_url ~ '^https://'),
  source_license text not null,
  source_attribution text not null,
  capture_date date not null,
  source_checksum text not null check (source_checksum ~ '^[a-f0-9]{64}$'),
  coverage_note_es text not null,
  coverage_note_en text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (site_id, version),
  constraint baseline_boundary_valid check (extensions.st_isvalid(boundary)),
  constraint baseline_boundary_nonempty check (not extensions.st_isempty(boundary)),
  constraint baseline_pedestrian_valid check (
    pedestrian_area is null
    or (
      extensions.st_isvalid(pedestrian_area)
      and not extensions.st_isempty(pedestrian_area)
      and extensions.st_covers(boundary, pedestrian_area)
    )
  )
);

create unique index site_baselines_one_active_per_site
  on public.site_baselines (site_id)
  where is_active;

create index site_baselines_boundary_gist
  on public.site_baselines
  using gist (boundary);

alter table public.sites enable row level security;
alter table public.site_baselines enable row level security;

revoke all on table public.sites from anon, authenticated;
revoke all on table public.site_baselines from anon, authenticated;

create or replace function public.list_public_sites()
returns table (
  id uuid,
  slug text,
  name_es text,
  name_en text,
  locality_es text,
  locality_en text,
  timezone text,
  currency text,
  completeness public.site_completeness,
  baseline_version integer,
  boundary jsonb,
  source_url text,
  source_license text,
  source_attribution text,
  capture_date date,
  coverage_note_es text,
  coverage_note_en text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.slug,
    s.name_es,
    s.name_en,
    s.locality_es,
    s.locality_en,
    s.timezone,
    s.currency,
    s.completeness,
    b.version,
    extensions.st_asgeojson(b.boundary, 6)::jsonb,
    b.source_url,
    b.source_license,
    b.source_attribution,
    b.capture_date,
    b.coverage_note_es,
    b.coverage_note_en
  from public.sites as s
  join public.site_baselines as b
    on b.site_id = s.id
   and b.is_active
  where s.published
  order by s.slug;
$$;

revoke all on function public.list_public_sites() from public, anon, authenticated;
grant execute on function public.list_public_sites() to anon, authenticated;

comment on function public.list_public_sites() is
  'Allowlisted public site projection. It excludes account data, internal timestamps, and private proposals.';
