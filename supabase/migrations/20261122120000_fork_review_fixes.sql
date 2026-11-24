-- Independent-review fixes for the fork feature (FT-03 R1):
-- 1. Provenance integrity: a fork's source publication must be the publication of its
--    source revision, enforced by a composite foreign key.
-- 2. fork_publication locks the publication and the site together (FOR SHARE), so a
--    site cannot be unpublished mid-fork. Canonical lock order: publication, then site.
--    A future moderation or unpublish path must lock in that order and use
--    FOR NO KEY UPDATE on sites, never FOR UPDATE.
-- 3. create_branch joins the same visibility rule as the fork and the public reads:
--    the site must be published.
-- 4. Labels and time slots now require JavaScript String.trim() parity at the edges.
--    btrim only strips the ASCII space, so a direct RPC caller could previously save a
--    label like U+0009 that the Zod schemas later reject, breaking the fork editor.
-- 5. Index for "forks of this publication" lookups.

alter table public.publications
  add constraint publications_id_revision_unique unique (id, revision_id);

alter table public.branches
  add constraint branches_source_publication_revision_fk
    foreign key (source_publication_id, source_revision_id)
    references public.publications (id, revision_id)
    on delete restrict;

create index branches_source_publication_idx
  on public.branches (source_publication_id)
  where source_publication_id is not null;

-- Trims the same edge characters as JavaScript's String.trim(): White_Space plus the
-- zero-width no-break space. Kept as an explicit chr() list to stay locale-independent.
create or replace function public.js_trim(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(
    p_value,
    pg_catalog.chr(32) || pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11)
      || pg_catalog.chr(12) || pg_catalog.chr(13) || pg_catalog.chr(160)
      || pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193)
      || pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196)
      || pg_catalog.chr(8197) || pg_catalog.chr(8198) || pg_catalog.chr(8199)
      || pg_catalog.chr(8200) || pg_catalog.chr(8201) || pg_catalog.chr(8202)
      || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239)
      || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279)
  );
$$;

revoke all on function public.js_trim(text) from public, anon, authenticated;

create or replace function public.feature_properties_are_valid(
  p_kind public.intervention_kind,
  p_properties jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  allowed text[];
  property_key text;
  key_count integer := 0;
begin
  if p_properties is null or pg_catalog.jsonb_typeof(p_properties) <> 'object' then
    return false;
  end if;
  allowed := case p_kind
    when 'shade_tree' then array['label', 'canopyDiameterM', 'heightM']
    when 'shade_canopy' then array['label', 'heightM']
    when 'temporary_market' then array['label', 'stallCount', 'moduleM2', 'timeSlot']
    when 'proposed_crossing' then array['label', 'widthM']
    else array[]::text[]
  end;
  for property_key in select pg_catalog.jsonb_object_keys(p_properties) loop
    if not property_key = any (allowed) then
      return false;
    end if;
    key_count := key_count + 1;
  end loop;
  if key_count <> pg_catalog.cardinality(allowed)
    or pg_catalog.jsonb_typeof(p_properties -> 'label') <> 'string'
    or (p_properties ->> 'label') <> public.js_trim(p_properties ->> 'label')
    or char_length(p_properties ->> 'label') not between 1 and 80
  then
    return false;
  end if;
  return case p_kind
    when 'shade_tree' then
      public.json_number_between(p_properties -> 'canopyDiameterM', 1, 30)
      and public.json_number_between(p_properties -> 'heightM', 2, 30)
    when 'shade_canopy' then
      public.json_number_between(p_properties -> 'heightM', 2.5, 8)
    when 'temporary_market' then
      public.json_number_between(p_properties -> 'stallCount', 1, 200)
      and (p_properties -> 'stallCount')::numeric = pg_catalog.trunc((p_properties -> 'stallCount')::numeric)
      and public.json_number_between(p_properties -> 'moduleM2', 1, 20)
      and pg_catalog.jsonb_typeof(p_properties -> 'timeSlot') = 'string'
      and (p_properties ->> 'timeSlot') = public.js_trim(p_properties ->> 'timeSlot')
      and char_length(p_properties ->> 'timeSlot') between 1 and 40
    when 'proposed_crossing' then
      public.json_number_between(p_properties -> 'widthM', 2, 10)
    else false
  end;
end;
$$;

revoke all on function public.feature_properties_are_valid(public.intervention_kind, jsonb)
  from public, anon, authenticated;

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
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;
  -- One visibility rule with the fork and the public reads: the site must be published.
  select b.id
  into baseline
  from public.site_baselines as b
  join public.sites as s on s.id = b.site_id
  where b.site_id = p_site_id
    and b.is_active
    and s.published
  for share of b, s;
  if baseline is null then
    raise exception using errcode = 'P0002', message = 'site_not_found';
  end if;
  insert into public.branches (id, site_id, baseline_id, owner_id, title)
  values (branch_id, p_site_id, baseline, actor, trim(p_title));
  insert into public.revisions (id, branch_id, site_id, baseline_id, message, author_id)
  values (revision_id, branch_id, p_site_id, baseline, 'Branch created', actor);
  update public.branches
  set current_revision_id = revision_id
  where id = branch_id;
  result := pg_catalog.jsonb_build_object(
    'branchId', branch_id,
    'revisionId', revision_id,
    'siteId', p_site_id,
    'title', trim(p_title)
  );
  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'create_branch', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.create_branch(uuid, text, text, text) from public, anon;
grant execute on function public.create_branch(uuid, text, text, text) to authenticated;

create or replace function public.fork_publication(
  p_publication_id uuid,
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
  previous public.mutation_requests%rowtype;
  source_publication uuid;
  source_revision uuid;
  source_site uuid;
  source_baseline uuid;
  new_branch_id uuid := pg_catalog.gen_random_uuid();
  new_revision_id uuid := pg_catalog.gen_random_uuid();
  copied integer;
  baseline_active boolean;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  -- Explicit null and whitespace checks: a blank title must be a 422, never a 500.
  if p_publication_id is null
    or p_title is null
    or p_idempotency_key is null
    or p_payload_hash is null
    or p_title <> pg_catalog.btrim(p_title)
    or char_length(p_title) not between 1 and 100
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_branch_request';
  end if;

  -- Same idempotency namespace as create_branch: one key creates at most one branch,
  -- whichever source it names.
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
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  -- FOR SHARE on the publication and the site serializes with moderation hides and with
  -- unpublishing the site. Canonical lock order is publication, then site: any future
  -- moderation path must lock in the same order and use FOR NO KEY UPDATE on sites.
  -- The source branch's soft-delete is irrelevant: a publication outlives it.
  select p.id, r.id, r.site_id, r.baseline_id
  into source_publication, source_revision, source_site, source_baseline
  from public.publications as p
  join public.revisions as r on r.id = p.revision_id
  join public.sites as s on s.id = r.site_id
  where p.id = p_publication_id
    and p.moderation_state = 'visible'
    and s.published
  for share of p, s;

  if source_publication is null then
    raise exception using errcode = 'P0002', message = 'publication_not_found';
  end if;

  insert into public.branches (
    id, site_id, baseline_id, owner_id, title, source_revision_id, source_publication_id
  )
  values (
    new_branch_id, source_site, source_baseline, actor, p_title, source_revision, source_publication
  );

  insert into public.revisions (
    id, branch_id, site_id, baseline_id, parent_revision_id, merge_parent_revision_id,
    message, author_id
  )
  values (
    new_revision_id, new_branch_id, source_site, source_baseline, source_revision, null,
    'Forked from publication', actor
  );

  -- Exact copy, not revalidated: rules may have tightened since the source was saved,
  -- and the fork must reproduce the published snapshot.
  insert into public.revision_features (revision_id, site_id, feature_id, kind, properties, geometry)
  select new_revision_id, f.site_id, f.feature_id, f.kind, f.properties, f.geometry
  from public.revision_features as f
  where f.revision_id = source_revision
  order by f.feature_id;
  get diagnostics copied = row_count;

  update public.branches
  set current_revision_id = new_revision_id
  where id = new_branch_id;

  select b.is_active into baseline_active
  from public.site_baselines as b
  where b.id = source_baseline;

  result := pg_catalog.jsonb_build_object(
    'branchId', new_branch_id,
    'revisionId', new_revision_id,
    'siteId', source_site,
    'baselineId', source_baseline,
    'baselineIsActive', coalesce(baseline_active, false),
    'title', p_title,
    'sourcePublicationId', source_publication,
    'featureCount', copied
  );

  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'create_branch', p_idempotency_key, p_payload_hash, result);

  return result;
end;
$$;

revoke all on function public.fork_publication(uuid, text, text, text) from public, anon;
grant execute on function public.fork_publication(uuid, text, text, text) to authenticated;
