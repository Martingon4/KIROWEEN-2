create type public.intervention_kind as enum (
  'shade_tree',
  'shade_canopy',
  'temporary_market',
  'parking_conversion',
  'proposed_crossing'
);

create type public.publication_moderation_state as enum ('visible', 'hidden');

create table public.revisions (
  id uuid primary key,
  branch_id uuid not null references public.branches (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  baseline_id uuid not null,
  parent_revision_id uuid references public.revisions (id) on delete restrict,
  merge_parent_revision_id uuid references public.revisions (id) on delete restrict,
  message text not null check (char_length(message) between 1 and 100),
  author_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, site_id),
  constraint revisions_baseline_site_fk
    foreign key (baseline_id, site_id)
    references public.site_baselines (id, site_id)
    on delete restrict,
  constraint revisions_distinct_parents check (
    merge_parent_revision_id is null
    or merge_parent_revision_id <> parent_revision_id
  )
);

alter table public.branches
  add column source_revision_id uuid references public.revisions (id) on delete restrict,
  add column current_revision_id uuid references public.revisions (id) on delete restrict;

create table public.revision_features (
  revision_id uuid not null,
  site_id uuid not null,
  feature_id uuid not null,
  kind public.intervention_kind not null,
  properties jsonb not null check (jsonb_typeof(properties) = 'object'),
  geometry extensions.geometry(Geometry, 4326) not null,
  primary key (revision_id, feature_id),
  constraint revision_features_revision_site_fk
    foreign key (revision_id, site_id)
    references public.revisions (id, site_id)
    on delete restrict,
  constraint revision_features_supported_geometry check (
    extensions.geometrytype(geometry) in ('POINT', 'LINESTRING', 'POLYGON')
  ),
  constraint revision_features_2d check (extensions.st_ndims(geometry) = 2),
  constraint revision_features_valid check (
    not extensions.st_isempty(geometry)
    and extensions.st_isvalid(geometry)
    and (
      extensions.geometrytype(geometry) <> 'LINESTRING'
      or extensions.st_issimple(geometry)
    )
    and (
      extensions.geometrytype(geometry) <> 'POLYGON'
      or extensions.st_numinteriorrings(geometry) = 0
    )
  )
);

create index revision_features_geometry_gist
  on public.revision_features
  using gist (geometry);

create table public.publications (
  id uuid primary key,
  revision_id uuid not null unique references public.revisions (id) on delete restrict,
  branch_id uuid not null references public.branches (id) on delete restrict,
  public_label text not null check (char_length(public_label) between 1 and 100),
  public_summary text not null check (char_length(public_summary) between 1 and 1000),
  moderation_state public.publication_moderation_state not null default 'visible',
  published_by uuid not null references auth.users (id) on delete restrict,
  published_at timestamptz not null default now()
);

create table public.mutation_requests (
  actor_id uuid not null references auth.users (id) on delete cascade,
  operation text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation, idempotency_key)
);

alter table public.revisions enable row level security;
alter table public.revision_features enable row level security;
alter table public.publications enable row level security;
alter table public.mutation_requests enable row level security;

revoke all on table public.revisions from anon, authenticated;
revoke all on table public.revision_features from anon, authenticated;
revoke all on table public.publications from anon, authenticated;
revoke all on table public.mutation_requests from anon, authenticated;

grant select on table public.revisions to authenticated;
grant select on table public.revision_features to authenticated;
grant select on table public.publications to authenticated;

create policy revisions_select_branch_owner
  on public.revisions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.branches as b
      where b.id = revisions.branch_id
        and b.owner_id = (select auth.uid())
        and not b.is_deleted
    )
  );

create policy revision_features_select_branch_owner
  on public.revision_features
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.revisions as r
      join public.branches as b on b.id = r.branch_id
      where r.id = revision_features.revision_id
        and b.owner_id = (select auth.uid())
        and not b.is_deleted
    )
  );

create policy publications_select_owner
  on public.publications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.branches as b
      where b.id = publications.branch_id
        and b.owner_id = (select auth.uid())
        and not b.is_deleted
    )
  );

create or replace function public.prevent_immutable_revision_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'immutable_revision';
end;
$$;

revoke all on function public.prevent_immutable_revision_change() from public, anon, authenticated;

create trigger revisions_are_immutable
  before update or delete on public.revisions
  for each row execute function public.prevent_immutable_revision_change();

create trigger revision_features_are_immutable
  before update or delete on public.revision_features
  for each row execute function public.prevent_immutable_revision_change();

create or replace function public.validate_revision_feature_site()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  site_boundary extensions.geometry(Polygon, 4326);
begin
  select b.boundary
  into site_boundary
  from public.revisions as r
  join public.site_baselines as b
    on b.id = r.baseline_id
   and b.site_id = r.site_id
  where r.id = new.revision_id
    and r.site_id = new.site_id;

  if site_boundary is null or not extensions.st_covers(site_boundary, new.geometry) then
    raise exception using
      errcode = '23514',
      message = 'feature_outside_site';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_revision_feature_site() from public, anon, authenticated;

create trigger revision_features_validate_site
  before insert on public.revision_features
  for each row execute function public.validate_revision_feature_site();

create or replace function public.create_branch(
  p_site_id uuid,
  p_title text,
  p_idempotency_key text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  baseline uuid;
  branch_id uuid := pg_catalog.gen_random_uuid();
  revision_id uuid := pg_catalog.gen_random_uuid();
  previous public.mutation_requests%rowtype;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  if char_length(p_title) not between 1 and 100
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_branch_request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':create_branch:' || p_idempotency_key, 0)
  );

  select *
  into previous
  from public.mutation_requests as request
  where request.actor_id = actor
    and request.operation = 'create_branch'
    and request.idempotency_key = p_idempotency_key;

  if found then
    if previous.payload_hash <> p_payload_hash then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  select id
  into baseline
  from public.site_baselines
  where site_id = p_site_id
    and is_active
  for share;

  if baseline is null then
    raise exception using errcode = 'P0002', message = 'site_not_found';
  end if;

  insert into public.branches (id, site_id, baseline_id, owner_id, title)
  values (branch_id, p_site_id, baseline, actor, trim(p_title));

  insert into public.revisions (
    id,
    branch_id,
    site_id,
    baseline_id,
    message,
    author_id
  )
  values (
    revision_id,
    branch_id,
    p_site_id,
    baseline,
    'Branch created',
    actor
  );

  update public.branches
  set current_revision_id = revision_id
  where id = branch_id;

  result := pg_catalog.jsonb_build_object(
    'branchId', branch_id,
    'revisionId', revision_id,
    'siteId', p_site_id,
    'title', trim(p_title)
  );

  insert into public.mutation_requests (
    actor_id,
    operation,
    idempotency_key,
    payload_hash,
    response_json
  )
  values (actor, 'create_branch', p_idempotency_key, p_payload_hash, result);

  return result;
end;
$$;

revoke all on function public.create_branch(uuid, text, text, text)
  from public, anon;
grant execute on function public.create_branch(uuid, text, text, text)
  to authenticated;
