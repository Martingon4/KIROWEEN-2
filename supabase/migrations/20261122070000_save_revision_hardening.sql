-- Review fixes for save_revision and get_branch_head (append-only; 20261122060000 is unchanged).
-- 1. A snap-to-grid result that is NULL or changes type is rejected as invalid_geometry (422)
--    instead of reaching the NOT NULL column as a 500.
-- 2. Vertices are counted before rounding, matching the API limit of 100 positions.
-- 3. Labels and time slots must already be trimmed, so direct RPC calls store the same
--    canonical text as the API.
-- 4. get_branch_head filters by owner explicitly instead of relying only on RLS.

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
    or (p_properties ->> 'label') <> pg_catalog.btrim(p_properties ->> 'label')
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
      and (p_properties ->> 'timeSlot') = pg_catalog.btrim(p_properties ->> 'timeSlot')
      and char_length(p_properties ->> 'timeSlot') between 1 and 40
    when 'proposed_crossing' then
      public.json_number_between(p_properties -> 'widthM', 2, 10)
    else false
  end;
end;
$$;

revoke all on function public.feature_properties_are_valid(public.intervention_kind, jsonb)
  from public, anon, authenticated;

create or replace function public.save_revision(
  p_branch_id uuid,
  p_expected_head_id uuid,
  p_message text,
  p_features jsonb,
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
  branch public.branches%rowtype;
  revision_id uuid := pg_catalog.gen_random_uuid();
  item record;
  feature_kind public.intervention_kind;
  expected_type text;
  shape extensions.geometry;
  ids uuid[] := array[]::uuid[];
  kinds public.intervention_kind[] := array[]::public.intervention_kind[];
  property_sets jsonb[] := array[]::jsonb[];
  shapes extensions.geometry[] := array[]::extensions.geometry[];
  position integer;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  if p_branch_id is null
    or p_expected_head_id is null
    or p_message is null
    or char_length(pg_catalog.btrim(p_message)) not between 1 and 100
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash !~ '^[a-f0-9]{64}$'
    or p_features is null
    or pg_catalog.jsonb_typeof(p_features) <> 'array'
    or pg_catalog.octet_length(p_features::text) > 1048576
  then
    raise exception using errcode = '22023', message = 'invalid_revision_request';
  end if;

  -- Same lock order as create_branch: idempotency key first, then the branch row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':save_revision:' || p_idempotency_key, 0)
  );

  select *
  into previous
  from public.mutation_requests as request
  where request.actor_id = actor
    and request.operation = 'save_revision'
    and request.idempotency_key = p_idempotency_key;

  -- Replay before the head check, so retrying a successful save is not a conflict.
  if found then
    if previous.payload_hash <> p_payload_hash then
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  select *
  into branch
  from public.branches as b
  where b.id = p_branch_id
    and b.owner_id = actor
    and not b.is_deleted
  for update;

  -- Missing, deleted, and another participant's branch are indistinguishable.
  if not found then
    raise exception using errcode = 'P0002', message = 'branch_not_found';
  end if;

  if branch.current_revision_id is distinct from p_expected_head_id then
    raise exception using
      errcode = 'FT409',
      message = 'stale_head',
      detail = branch.current_revision_id::text;
  end if;

  if pg_catalog.jsonb_array_length(p_features) > 200 then
    raise exception using errcode = 'FT422', message = 'too_many_features';
  end if;

  for item in
    select value, ordinality - 1 as position
    from pg_catalog.jsonb_array_elements(p_features) with ordinality
  loop
    if pg_catalog.jsonb_typeof(item.value) <> 'object'
      or coalesce(item.value ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      raise exception using errcode = 'FT422', message = 'invalid_feature', detail = item.position::text;
    end if;

    if (item.value ->> 'id')::uuid = any (ids) then
      raise exception using errcode = 'FT422', message = 'duplicate_feature_id', detail = item.position::text;
    end if;

    begin
      feature_kind := (item.value ->> 'kind')::public.intervention_kind;
    exception when invalid_text_representation then
      raise exception using errcode = 'FT422', message = 'invalid_feature_kind', detail = item.position::text;
    end;

    if feature_kind is null then
      raise exception using errcode = 'FT422', message = 'invalid_feature_kind', detail = item.position::text;
    end if;

    -- No verifiable parking inventory exists for the pilot, so conversions are unavailable in v1.
    if feature_kind = 'parking_conversion' then
      raise exception using errcode = 'FT422', message = 'kind_not_supported', detail = item.position::text;
    end if;

    if not public.feature_properties_are_valid(feature_kind, item.value -> 'properties') then
      raise exception using errcode = 'FT422', message = 'invalid_feature_properties', detail = item.position::text;
    end if;

    expected_type := case feature_kind
      when 'shade_tree' then 'POINT'
      when 'proposed_crossing' then 'LINESTRING'
      else 'POLYGON'
    end;

    begin
      shape := extensions.st_setsrid(
        extensions.st_geomfromgeojson((item.value -> 'geometry')::text),
        4326
      );
    exception when others then
      raise exception using errcode = 'FT422', message = 'invalid_geometry', detail = item.position::text;
    end;

    if shape is null
      or extensions.geometrytype(shape) <> expected_type
      or extensions.st_ndims(shape) <> 2
      or extensions.st_isempty(shape)
      or extensions.st_xmin(shape) < -180 or extensions.st_xmax(shape) > 180
      or extensions.st_ymin(shape) < -90 or extensions.st_ymax(shape) > 90
    then
      raise exception using errcode = 'FT422', message = 'invalid_geometry', detail = item.position::text;
    end if;

    -- Count submitted positions (polygon closing point included) before rounding, like the API.
    if extensions.st_npoints(shape) > 100 then
      raise exception using errcode = 'FT422', message = 'too_many_vertices', detail = item.position::text;
    end if;

    -- Round to the canonical six decimals, then validate again: rounding can collapse a shape.
    shape := extensions.st_snaptogrid(shape, 0.000001);

    if shape is null
      or extensions.geometrytype(shape) <> expected_type
      or extensions.st_isempty(shape)
      or not extensions.st_isvalid(shape)
      or (expected_type = 'LINESTRING' and not extensions.st_issimple(shape))
      or (expected_type = 'POLYGON' and extensions.st_numinteriorrings(shape) <> 0)
    then
      raise exception using errcode = 'FT422', message = 'invalid_geometry', detail = item.position::text;
    end if;

    ids := ids || (item.value ->> 'id')::uuid;
    kinds := kinds || feature_kind;
    property_sets := property_sets || (item.value -> 'properties');
    shapes := shapes || shape;
  end loop;

  insert into public.revisions (
    id, branch_id, site_id, baseline_id, parent_revision_id, message, author_id
  )
  values (
    revision_id, branch.id, branch.site_id, branch.baseline_id,
    branch.current_revision_id, pg_catalog.btrim(p_message), actor
  );

  -- The site-containment trigger validates every row; any failure rolls back everything.
  for position in 1 .. pg_catalog.cardinality(ids) loop
    insert into public.revision_features (revision_id, site_id, feature_id, kind, properties, geometry)
    values (
      revision_id,
      branch.site_id,
      ids[position],
      kinds[position],
      property_sets[position],
      shapes[position]
    );
  end loop;

  update public.branches
  set current_revision_id = revision_id
  where id = branch.id;

  result := pg_catalog.jsonb_build_object(
    'branchId', branch.id,
    'revisionId', revision_id,
    'parentRevisionId', branch.current_revision_id,
    'featureCount', pg_catalog.cardinality(ids)
  );

  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'save_revision', p_idempotency_key, p_payload_hash, result);

  return result;
end;
$$;

revoke all on function public.save_revision(uuid, uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.save_revision(uuid, uuid, text, jsonb, text, text) to authenticated;

-- Owner filter is explicit, so later public-read policies for published revisions cannot
-- expose a private branch head through this function.
create or replace function public.get_branch_head(p_branch_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'branchId', b.id,
    'title', b.title,
    'siteId', b.site_id,
    'baselineId', b.baseline_id,
    'revisionId', r.id,
    'parentRevisionId', r.parent_revision_id,
    'message', r.message,
    'createdAt', r.created_at,
    'features', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', f.feature_id,
            'kind', f.kind,
            'properties', f.properties,
            'geometry', extensions.st_asgeojson(f.geometry, 6)::jsonb
          )
          order by f.feature_id
        )
        from public.revision_features as f
        where f.revision_id = r.id
      ),
      '[]'::jsonb
    )
  )
  from public.branches as b
  join public.revisions as r on r.id = b.current_revision_id
  where b.id = p_branch_id
    and b.owner_id = (select auth.uid())
    and not b.is_deleted;
$$;

revoke all on function public.get_branch_head(uuid) from public, anon;
grant execute on function public.get_branch_head(uuid) to authenticated;
