-- Three-way merge of a visible publication into an own branch (FT-08), spec 03 task 5.
--
-- Ancestor: nearest common revision on the primary-parent chains (limit 256 per side);
-- two complete chains on the same baseline with no shared node use the synthetic empty
-- baseline as ancestor. Element rules: one side changed keeps that change; the same
-- change on both sides is kept once; different changes (including edit against
-- delete) need a resolution. Spatial rules then run on the combined set, across
-- different feature ids. Geometry is never auto-adjusted.
--
-- Design note: the architect proposed extracting save_revision's per-feature checks into
-- a shared function and recreating save_revision. To keep the proven save path
-- untouched, normalize_feature_input reproduces those checks for redrawn merge features
-- only; pgTAP asserts parity on the rejection cases.

-- Per-feature input normalization for merge redraws. Same rules and error codes as
-- save_revision (FT422 + reason message), plus site containment against the boundary.
create or replace function public.normalize_feature_input(
  p_value jsonb,
  p_boundary extensions.geometry
)
returns table (
  feature_id uuid,
  kind public.intervention_kind,
  properties jsonb,
  geometry extensions.geometry
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_kind public.intervention_kind;
  v_expected text;
  v_shape extensions.geometry;
begin
  if p_value is null
    or pg_catalog.jsonb_typeof(p_value) <> 'object'
    or coalesce(p_value ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    raise exception using errcode = 'FT422', message = 'invalid_feature';
  end if;
  begin
    v_kind := (p_value ->> 'kind')::public.intervention_kind;
  exception when invalid_text_representation then
    raise exception using errcode = 'FT422', message = 'invalid_feature_kind';
  end;
  if v_kind is null then
    raise exception using errcode = 'FT422', message = 'invalid_feature_kind';
  end if;
  if v_kind = 'parking_conversion' then
    raise exception using errcode = 'FT422', message = 'kind_not_supported';
  end if;
  if not public.feature_properties_are_valid(v_kind, p_value -> 'properties') then
    raise exception using errcode = 'FT422', message = 'invalid_feature_properties';
  end if;
  v_expected := case v_kind
    when 'shade_tree' then 'POINT'
    when 'proposed_crossing' then 'LINESTRING'
    else 'POLYGON'
  end;
  begin
    v_shape := extensions.st_setsrid(
      extensions.st_geomfromgeojson((p_value -> 'geometry')::text), 4326);
  exception when others then
    raise exception using errcode = 'FT422', message = 'invalid_geometry';
  end;
  if v_shape is null
    or extensions.geometrytype(v_shape) <> v_expected
    or extensions.st_ndims(v_shape) <> 2
    or extensions.st_isempty(v_shape)
    or extensions.st_xmin(v_shape) < -180 or extensions.st_xmax(v_shape) > 180
    or extensions.st_ymin(v_shape) < -90 or extensions.st_ymax(v_shape) > 90
  then
    raise exception using errcode = 'FT422', message = 'invalid_geometry';
  end if;
  if extensions.st_npoints(v_shape) > 100 then
    raise exception using errcode = 'FT422', message = 'too_many_vertices';
  end if;
  v_shape := extensions.st_snaptogrid(v_shape, 0.000001);
  if v_shape is null
    or extensions.geometrytype(v_shape) <> v_expected
    or extensions.st_isempty(v_shape)
    or not extensions.st_isvalid(v_shape)
    or (v_expected = 'LINESTRING' and not extensions.st_issimple(v_shape))
    or (v_expected = 'POLYGON' and extensions.st_numinteriorrings(v_shape) <> 0)
  then
    raise exception using errcode = 'FT422', message = 'invalid_geometry';
  end if;
  if not extensions.st_covers(p_boundary, v_shape) then
    raise exception using errcode = 'FT422', message = 'feature_outside_site';
  end if;

  return query select (p_value ->> 'id')::uuid, v_kind, p_value -> 'properties', v_shape;
end;
$$;

revoke all on function public.normalize_feature_input(jsonb, extensions.geometry)
  from public, anon, authenticated;

create or replace function public.merge_same_feature(
  k1 public.intervention_kind, p1 jsonb, g1 extensions.geometry,
  k2 public.intervention_kind, p2 jsonb, g2 extensions.geometry
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when k1 is null and k2 is null then true
    when k1 is null or k2 is null then false
    else k1 = k2 and p1 = p2 and extensions.st_equals(g1, g2)
  end;
$$;

revoke all on function public.merge_same_feature(
  public.intervention_kind, jsonb, extensions.geometry,
  public.intervention_kind, jsonb, extensions.geometry
) from public, anon, authenticated;

-- Exclusive occupation zones in v1: a canopy footprint is permanent, so it excludes any
-- market and any other canopy; two markets exclude each other within the same time slot.
-- Projected shade never conflicts.
create or replace function public.merge_exclusive_pair(
  k1 public.intervention_kind, p1 jsonb,
  k2 public.intervention_kind, p2 jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (k1 = 'shade_canopy' and k2 = 'shade_canopy')
    or (k1 = 'shade_canopy' and k2 = 'temporary_market')
    or (k1 = 'temporary_market' and k2 = 'shade_canopy')
    or (k1 = 'temporary_market' and k2 = 'temporary_market'
        and (p1 ->> 'timeSlot') = (p2 ->> 'timeSlot'));
$$;

revoke all on function public.merge_exclusive_pair(
  public.intervention_kind, jsonb, public.intervention_kind, jsonb
) from public, anon, authenticated;

-- Nearest common ancestor on the primary-parent chains. Returns
-- {status: ok|nothing_to_merge|ancestor_limit_exceeded, ancestorId?}.
create or replace function public.merge_find_ancestor(p_target uuid, p_source uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := 256;
  v_source_in_target boolean;
  v_ancestor uuid;
  v_target_complete boolean;
  v_source_complete boolean;
begin
  with recursive tc as (
    select r.id, r.parent_revision_id as parent, 0 as depth
    from public.revisions as r
    where r.id = p_target
    union all
    select r.id, r.parent_revision_id, tc.depth + 1
    from public.revisions as r
    join tc on r.id = tc.parent
    where tc.depth < v_limit
  ),
  sc as (
    select r.id, r.parent_revision_id as parent, 0 as depth
    from public.revisions as r
    where r.id = p_source
    union all
    select r.id, r.parent_revision_id, sc.depth + 1
    from public.revisions as r
    join sc on r.id = sc.parent
    where sc.depth < v_limit
  )
  select
    exists (select 1 from tc where tc.id = p_source),
    (select sc.id from sc join tc on tc.id = sc.id order by sc.depth limit 1),
    exists (select 1 from tc where tc.parent is null),
    exists (select 1 from sc where sc.parent is null)
  into v_source_in_target, v_ancestor, v_target_complete, v_source_complete;

  if v_source_in_target then
    return pg_catalog.jsonb_build_object('status', 'nothing_to_merge');
  end if;
  if v_ancestor is not null then
    return pg_catalog.jsonb_build_object('status', 'ok', 'ancestorId', v_ancestor);
  end if;
  if v_target_complete and v_source_complete then
    return pg_catalog.jsonb_build_object('status', 'ok', 'ancestorId', null);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ancestor_limit_exceeded');
end;
$$;

revoke all on function public.merge_find_ancestor(uuid, uuid) from public, anon, authenticated;

-- Core three-way computation shared by preview and commit. Writes nothing.
-- Each output feature carries `wkb` (hex EWKB) so the commit copies geometry exactly;
-- the preview strips it before returning to clients.
create or replace function public.merge_compute(
  p_target uuid,
  p_source uuid,
  p_ancestor uuid,
  p_site_id uuid,
  p_boundary extensions.geometry,
  p_resolutions jsonb,
  p_expose_ancestor boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_srid integer;
  v_threshold numeric;
  r record;
  v_res jsonb;
  v_res_by_id jsonb := '{}'::jsonb;
  v_used text[] := array[]::text[];
  v_invalid jsonb := '[]'::jsonb;
  v_unresolved jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_operations jsonb := '[]'::jsonb;
  v_spatial1 jsonb;
  v_spatial2 jsonb;
  v_features jsonb;
  v_t_changed boolean;
  v_s_changed boolean;
  v_decision text;
  v_take text;
  v_cid text;
  v_action text;
  v_norm record;
  v_pair jsonb;
  v_target_fid uuid;
  v_idx integer;
  f_ids uuid[] := array[]::uuid[];
  f_kinds public.intervention_kind[] := array[]::public.intervention_kind[];
  f_props jsonb[] := array[]::jsonb[];
  f_geoms extensions.geometry[] := array[]::extensions.geometry[];
  f_prov text[] := array[]::text[];
  n_ids uuid[];
  n_kinds public.intervention_kind[];
  n_props jsonb[];
  n_geoms extensions.geometry[];
  n_prov text[];
begin
  select s.metric_srid, s.merge_overlap_threshold_m2
  into v_srid, v_threshold
  from public.sites as s
  where s.id = p_site_id;

  if p_resolutions is null or pg_catalog.jsonb_typeof(p_resolutions) <> 'array'
    or pg_catalog.jsonb_array_length(p_resolutions) > 400
  then
    raise exception using errcode = '22023', message = 'invalid_merge_request';
  end if;

  -- Index resolutions by conflict id; malformed and duplicate entries are invalid.
  for v_res in select value from pg_catalog.jsonb_array_elements(p_resolutions) loop
    if pg_catalog.jsonb_typeof(v_res) <> 'object'
      or pg_catalog.jsonb_typeof(v_res -> 'conflictId') <> 'string'
      or coalesce(v_res ->> 'action', '') not in ('keep_target', 'keep_source', 'remove', 'redraw')
    then
      v_invalid := v_invalid || pg_catalog.jsonb_build_object(
        'conflictId', v_res ->> 'conflictId', 'reason', 'malformed_resolution');
      continue;
    end if;
    if v_res_by_id ? (v_res ->> 'conflictId') then
      v_invalid := v_invalid || pg_catalog.jsonb_build_object(
        'conflictId', v_res ->> 'conflictId', 'reason', 'duplicate_resolution');
      continue;
    end if;
    v_res_by_id := v_res_by_id || pg_catalog.jsonb_build_object(v_res ->> 'conflictId', v_res);
  end loop;

  -- Element pass.
  for r in
    with a as (
      select f.feature_id as id, f.kind, f.properties, f.geometry
      from public.revision_features as f where f.revision_id = p_ancestor
    ),
    t as (
      select f.feature_id as id, f.kind, f.properties, f.geometry
      from public.revision_features as f where f.revision_id = p_target
    ),
    s as (
      select f.feature_id as id, f.kind, f.properties, f.geometry
      from public.revision_features as f where f.revision_id = p_source
    ),
    ids as (
      select id from a union select id from t union select id from s
    )
    select ids.id,
           a.kind as ak, a.properties as ap, a.geometry as ag,
           t.kind as tk, t.properties as tp, t.geometry as tg,
           s.kind as sk, s.properties as sp, s.geometry as sg
    from ids
    left join a on a.id = ids.id
    left join t on t.id = ids.id
    left join s on s.id = ids.id
    order by ids.id
  loop
    v_t_changed := not public.merge_same_feature(r.ak, r.ap, r.ag, r.tk, r.tp, r.tg);
    v_s_changed := not public.merge_same_feature(r.ak, r.ap, r.ag, r.sk, r.sp, r.sg);
    v_cid := null;

    if not v_t_changed and not v_s_changed then
      v_decision := 'unchanged'; v_take := 'target';
    elsif v_t_changed and not v_s_changed then
      v_decision := 'target'; v_take := 'target';
    elsif not v_t_changed and v_s_changed then
      v_decision := 'source'; v_take := 'source';
    elsif public.merge_same_feature(r.tk, r.tp, r.tg, r.sk, r.sp, r.sg) then
      v_decision := 'both'; v_take := 'target';
    else
      v_cid := 'element:' || r.id::text;
      v_conflicts := v_conflicts || pg_catalog.jsonb_build_object(
        'id', v_cid,
        'type', case when r.tk is null or r.sk is null then 'edit_delete' else 'edit_edit' end,
        'featureId', r.id,
        'target', case when r.tk is null then null else pg_catalog.jsonb_build_object(
          'kind', r.tk, 'properties', r.tp,
          'geometry', extensions.st_asgeojson(r.tg, 6)::jsonb) end,
        'source', case when r.sk is null then null else pg_catalog.jsonb_build_object(
          'kind', r.sk, 'properties', r.sp,
          'geometry', extensions.st_asgeojson(r.sg, 6)::jsonb) end,
        'ancestor', case when not p_expose_ancestor or r.ak is null then null
          else pg_catalog.jsonb_build_object(
            'kind', r.ak, 'properties', r.ap,
            'geometry', extensions.st_asgeojson(r.ag, 6)::jsonb) end
      );
      v_res := v_res_by_id -> v_cid;
      if v_res is null then
        v_unresolved := v_unresolved || pg_catalog.to_jsonb(v_cid);
        v_decision := 'unresolved'; v_take := 'target';
      else
        v_used := v_used || v_cid;
        v_action := v_res ->> 'action';
        v_decision := 'resolved';
        if v_action = 'keep_target' then
          v_take := 'target';
        elsif v_action = 'keep_source' then
          v_take := 'source';
        elsif v_action = 'remove' then
          v_take := 'none';
        else
          begin
            select * into v_norm from public.normalize_feature_input(v_res -> 'feature', p_boundary);
            if v_norm.feature_id <> r.id then
              v_invalid := v_invalid || pg_catalog.jsonb_build_object(
                'conflictId', v_cid, 'reason', 'redraw_id_mismatch');
              v_unresolved := v_unresolved || pg_catalog.to_jsonb(v_cid);
              v_decision := 'unresolved'; v_take := 'target';
            else
              v_take := 'redraw';
            end if;
          exception when sqlstate 'FT422' then
            v_invalid := v_invalid || pg_catalog.jsonb_build_object(
              'conflictId', v_cid, 'reason', sqlerrm);
            v_unresolved := v_unresolved || pg_catalog.to_jsonb(v_cid);
            v_decision := 'unresolved'; v_take := 'target';
          end;
        end if;
      end if;
    end if;

    if v_take = 'target' and r.tk is not null then
      f_ids := f_ids || r.id; f_kinds := f_kinds || r.tk; f_props := f_props || r.tp;
      f_geoms := f_geoms || r.tg;
      f_prov := f_prov || case v_decision
        when 'unchanged' then 'ancestor'
        when 'resolved' then 'resolved'
        when 'both' then 'both'
        else 'target' end;
    elsif v_take = 'source' and r.sk is not null then
      f_ids := f_ids || r.id; f_kinds := f_kinds || r.sk; f_props := f_props || r.sp;
      f_geoms := f_geoms || r.sg;
      f_prov := f_prov || case v_decision when 'resolved' then 'resolved' else 'source' end;
    elsif v_take = 'redraw' then
      f_ids := f_ids || v_norm.feature_id; f_kinds := f_kinds || v_norm.kind;
      f_props := f_props || v_norm.properties; f_geoms := f_geoms || v_norm.geometry;
      f_prov := f_prov || 'resolved'::text;
    end if;

    if v_decision <> 'unchanged' then
      v_operations := v_operations || pg_catalog.jsonb_build_object(
        'featureId', r.id,
        'decision', v_decision,
        'present', (v_take = 'target' and r.tk is not null)
                   or (v_take = 'source' and r.sk is not null)
                   or v_take = 'redraw'
      );
    end if;
  end loop;

  -- Spatial pass 1: exclusive overlaps on the combined set after element decisions.
  select coalesce(pg_catalog.jsonb_agg(pair order by pair ->> 'id'), '[]'::jsonb)
  into v_spatial1
  from (
    select pg_catalog.jsonb_build_object(
             'id', 'spatial:' || least(x1.id, x2.id)::text || ':' || greatest(x1.id, x2.id)::text,
             'type', 'exclusive_overlap',
             'featureIds', pg_catalog.jsonb_build_array(least(x1.id, x2.id), greatest(x1.id, x2.id)),
             'kinds', pg_catalog.jsonb_build_array(x1.kind, x2.kind),
             'timeSlot', coalesce(x1.props ->> 'timeSlot', x2.props ->> 'timeSlot'),
             'intersectionM2', pg_catalog.round(ov.area::numeric, 2),
             'thresholdM2', v_threshold,
             'blocking', (x1.prov = 'source') <> (x2.prov = 'source')
                         or x1.prov = 'resolved' or x2.prov = 'resolved'
           ) as pair
    from unnest(f_ids, f_kinds, f_props, f_geoms, f_prov)
           with ordinality as x1(id, kind, props, geom, prov, ord)
    join unnest(f_ids, f_kinds, f_props, f_geoms, f_prov)
           with ordinality as x2(id, kind, props, geom, prov, ord)
      on x1.ord < x2.ord
    cross join lateral (
      select extensions.st_area(
               extensions.st_intersection(
                 extensions.st_transform(x1.geom, v_srid),
                 extensions.st_transform(x2.geom, v_srid))) as area
    ) as ov
    where public.merge_exclusive_pair(x1.kind, x1.props, x2.kind, x2.props)
      and extensions.st_intersects(x1.geom, x2.geom)
      and ov.area > v_threshold
  ) as pairs;

  v_conflicts := v_conflicts || v_spatial1;

  -- Apply spatial resolutions (remove or redraw one feature of the pair).
  for v_cid, v_res in select key, value from pg_catalog.jsonb_each(v_res_by_id) loop
    if v_cid like 'element:%' then
      if not (v_cid = any (v_used)) then
        v_invalid := v_invalid || pg_catalog.jsonb_build_object(
          'conflictId', v_cid, 'reason', 'unknown_conflict');
      end if;
      continue;
    end if;
    -- SELECT INTO keeps the previous value when no row matches, so reset first.
    v_pair := null;
    select value into v_pair
    from pg_catalog.jsonb_array_elements(v_spatial1)
    where value ->> 'id' = v_cid;
    if v_pair is null then
      v_invalid := v_invalid || pg_catalog.jsonb_build_object(
        'conflictId', v_cid, 'reason', 'unknown_conflict');
      continue;
    end if;
    v_action := v_res ->> 'action';
    if v_action = 'remove' then
      begin
        v_target_fid := (v_res ->> 'featureId')::uuid;
      exception when invalid_text_representation then
        v_target_fid := null;
      end;
      if v_target_fid is null or not (v_pair -> 'featureIds') @> pg_catalog.to_jsonb(v_target_fid::text) then
        v_invalid := v_invalid || pg_catalog.jsonb_build_object(
          'conflictId', v_cid, 'reason', 'feature_not_in_conflict');
        continue;
      end if;
      v_idx := pg_catalog.array_position(f_ids, v_target_fid);
      if v_idx is not null then
        f_ids := f_ids[:v_idx - 1] || f_ids[v_idx + 1:];
        f_kinds := f_kinds[:v_idx - 1] || f_kinds[v_idx + 1:];
        f_props := f_props[:v_idx - 1] || f_props[v_idx + 1:];
        f_geoms := f_geoms[:v_idx - 1] || f_geoms[v_idx + 1:];
        f_prov := f_prov[:v_idx - 1] || f_prov[v_idx + 1:];
        v_operations := v_operations || pg_catalog.jsonb_build_object(
          'featureId', v_target_fid, 'decision', 'resolved', 'present', false);
      end if;
    elsif v_action = 'redraw' then
      begin
        select * into v_norm from public.normalize_feature_input(v_res -> 'feature', p_boundary);
      exception when sqlstate 'FT422' then
        v_invalid := v_invalid || pg_catalog.jsonb_build_object(
          'conflictId', v_cid, 'reason', sqlerrm);
        continue;
      end;
      if not (v_pair -> 'featureIds') @> pg_catalog.to_jsonb(v_norm.feature_id::text) then
        v_invalid := v_invalid || pg_catalog.jsonb_build_object(
          'conflictId', v_cid, 'reason', 'feature_not_in_conflict');
        continue;
      end if;
      v_idx := pg_catalog.array_position(f_ids, v_norm.feature_id);
      if v_idx is not null then
        f_kinds[v_idx] := v_norm.kind;
        f_props[v_idx] := v_norm.properties;
        f_geoms[v_idx] := v_norm.geometry;
        f_prov[v_idx] := 'resolved';
        v_operations := v_operations || pg_catalog.jsonb_build_object(
          'featureId', v_norm.feature_id, 'decision', 'resolved', 'present', true);
      end if;
    else
      v_invalid := v_invalid || pg_catalog.jsonb_build_object(
        'conflictId', v_cid, 'reason', 'action_not_allowed');
    end if;
  end loop;

  -- Spatial pass 2: what still blocks after every resolution, including new overlaps
  -- introduced by a redraw.
  select coalesce(pg_catalog.jsonb_agg(pair order by pair ->> 'id'), '[]'::jsonb)
  into v_spatial2
  from (
    select pg_catalog.jsonb_build_object(
             'id', 'spatial:' || least(x1.id, x2.id)::text || ':' || greatest(x1.id, x2.id)::text,
             'type', 'exclusive_overlap',
             'featureIds', pg_catalog.jsonb_build_array(least(x1.id, x2.id), greatest(x1.id, x2.id)),
             'intersectionM2', pg_catalog.round(ov.area::numeric, 2),
             'blocking', (x1.prov = 'source') <> (x2.prov = 'source')
                         or x1.prov = 'resolved' or x2.prov = 'resolved'
           ) as pair
    from unnest(f_ids, f_kinds, f_props, f_geoms, f_prov)
           with ordinality as x1(id, kind, props, geom, prov, ord)
    join unnest(f_ids, f_kinds, f_props, f_geoms, f_prov)
           with ordinality as x2(id, kind, props, geom, prov, ord)
      on x1.ord < x2.ord
    cross join lateral (
      select extensions.st_area(
               extensions.st_intersection(
                 extensions.st_transform(x1.geom, v_srid),
                 extensions.st_transform(x2.geom, v_srid))) as area
    ) as ov
    where public.merge_exclusive_pair(x1.kind, x1.props, x2.kind, x2.props)
      and extensions.st_intersects(x1.geom, x2.geom)
      and ov.area > v_threshold
  ) as pairs;

  select v_unresolved || coalesce(pg_catalog.jsonb_agg(value -> 'id'), '[]'::jsonb)
  into v_unresolved
  from pg_catalog.jsonb_array_elements(v_spatial2)
  where (value ->> 'blocking')::boolean;

  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', x.id,
             'kind', x.kind,
             'properties', x.props,
             'geometry', extensions.st_asgeojson(x.geom, 6)::jsonb,
             'provenance', x.prov,
             'wkb', pg_catalog.encode(extensions.st_asewkb(x.geom), 'hex')
           ) order by x.id), '[]'::jsonb)
  into v_features
  from unnest(f_ids, f_kinds, f_props, f_geoms, f_prov) as x(id, kind, props, geom, prov);

  return pg_catalog.jsonb_build_object(
    'engineVersion', public.analysis_engine_version(),
    'conflicts', v_conflicts,
    'unresolved', v_unresolved,
    'invalidResolutions', v_invalid,
    'warnings', (
      select coalesce(pg_catalog.jsonb_agg(value), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_spatial2)
      where not (value ->> 'blocking')::boolean
    ),
    'operations', v_operations,
    'featureCount', pg_catalog.cardinality(f_ids),
    'tooManyFeatures', pg_catalog.cardinality(f_ids) > 200,
    'features', v_features
  );
end;
$$;

revoke all on function public.merge_compute(
  uuid, uuid, uuid, uuid, extensions.geometry, jsonb, boolean
) from public, anon, authenticated;

-- Merge decisions live apart from revisions so the private ancestor id never reaches a
-- revision read. Owners can read only the non-sensitive columns.
create table public.revision_merge_decisions (
  revision_id uuid primary key references public.revisions (id) on delete restrict,
  source_publication_id uuid not null references public.publications (id) on delete restrict,
  source_revision_id uuid not null references public.revisions (id) on delete restrict,
  ancestor_revision_id uuid references public.revisions (id) on delete restrict,
  ancestor_kind text not null check (
    ancestor_kind in ('baseline', 'own_revision', 'publication', 'private_revision')),
  engine_version text not null,
  decisions jsonb not null check (pg_catalog.jsonb_typeof(decisions) = 'object'),
  created_at timestamptz not null default now()
);

create index revisions_merge_parent_idx
  on public.revisions (merge_parent_revision_id)
  where merge_parent_revision_id is not null;

alter table public.revision_merge_decisions enable row level security;
revoke all on table public.revision_merge_decisions from anon, authenticated;
grant select (revision_id, source_publication_id, ancestor_kind, engine_version, decisions, created_at)
  on table public.revision_merge_decisions to authenticated;

create policy revision_merge_decisions_select_owner
  on public.revision_merge_decisions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.revisions as r
      join public.branches as b on b.id = r.branch_id
      where r.id = revision_merge_decisions.revision_id
        and b.owner_id = (select auth.uid())
        and not b.is_deleted
    )
  );

create trigger revision_merge_decisions_are_immutable
  before update or delete on public.revision_merge_decisions
  for each row execute function public.prevent_curated_data_change();

create trigger revision_merge_decisions_cannot_be_truncated
  before truncate on public.revision_merge_decisions
  for each statement execute function public.prevent_curated_data_change();

-- Shared preconditions for preview and commit. Raises the documented errors.
create or replace function public.merge_context(
  p_branch_id uuid,
  p_source_publication_id uuid,
  p_lock boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_branch public.branches%rowtype;
  v_source_revision uuid;
  v_source_site uuid;
  v_source_baseline uuid;
  v_source_label text;
  v_ancestor jsonb;
  v_ancestor_id uuid;
  v_ancestor_kind text;
  v_expose boolean;
  v_boundary extensions.geometry;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_branch_id is null or p_source_publication_id is null then
    raise exception using errcode = '22023', message = 'invalid_merge_request';
  end if;

  -- Lock order: publication, then site, then branch (same as fork_publication).
  if p_lock then
    select r.id, r.site_id, r.baseline_id, p.public_label
    into v_source_revision, v_source_site, v_source_baseline, v_source_label
    from public.publications as p
    join public.revisions as r on r.id = p.revision_id
    join public.sites as s on s.id = r.site_id
    where p.id = p_source_publication_id
      and p.moderation_state = 'visible'
      and s.published
    for share of p, s;
  else
    select r.id, r.site_id, r.baseline_id, p.public_label
    into v_source_revision, v_source_site, v_source_baseline, v_source_label
    from public.publications as p
    join public.revisions as r on r.id = p.revision_id
    join public.sites as s on s.id = r.site_id
    where p.id = p_source_publication_id
      and p.moderation_state = 'visible'
      and s.published;
  end if;
  if v_source_revision is null then
    raise exception using errcode = 'P0002', message = 'publication_not_found';
  end if;

  if p_lock then
    select * into v_branch
    from public.branches as b
    where b.id = p_branch_id and b.owner_id = actor and not b.is_deleted
    for update;
  else
    select * into v_branch
    from public.branches as b
    where b.id = p_branch_id and b.owner_id = actor and not b.is_deleted;
  end if;
  if v_branch.id is null then
    raise exception using errcode = 'P0002', message = 'branch_not_found';
  end if;

  if v_branch.site_id <> v_source_site or v_branch.baseline_id <> v_source_baseline then
    raise exception using errcode = 'FT422', message = 'merge_incompatible';
  end if;

  if v_branch.current_revision_id = v_source_revision then
    raise exception using errcode = 'FT422', message = 'nothing_to_merge';
  end if;

  -- A source already merged into this head's primary chain cannot be merged again:
  -- the primary-parent ancestor would reintroduce changes rejected the first time.
  if exists (
    with recursive tc as (
      select r.id, r.parent_revision_id, r.merge_parent_revision_id, 0 as depth
      from public.revisions as r where r.id = v_branch.current_revision_id
      union all
      select r.id, r.parent_revision_id, r.merge_parent_revision_id, tc.depth + 1
      from public.revisions as r join tc on r.id = tc.parent_revision_id
      where tc.depth < 256
    )
    select 1 from tc where tc.merge_parent_revision_id = v_source_revision
  ) then
    raise exception using errcode = 'FT422', message = 'already_merged';
  end if;

  v_ancestor := public.merge_find_ancestor(v_branch.current_revision_id, v_source_revision);
  if v_ancestor ->> 'status' <> 'ok' then
    raise exception using errcode = 'FT422', message = v_ancestor ->> 'status';
  end if;
  v_ancestor_id := (v_ancestor ->> 'ancestorId')::uuid;

  if v_ancestor_id is null then
    v_ancestor_kind := 'baseline';
  elsif exists (
    select 1 from public.revisions as r join public.branches as b on b.id = r.branch_id
    where r.id = v_ancestor_id and b.owner_id = actor
  ) then
    v_ancestor_kind := 'own_revision';
  elsif exists (
    select 1 from public.publications as p
    where p.revision_id = v_ancestor_id and p.moderation_state = 'visible'
  ) then
    v_ancestor_kind := 'publication';
  else
    v_ancestor_kind := 'private_revision';
  end if;
  v_expose := v_ancestor_kind in ('own_revision', 'publication');

  select b.boundary into v_boundary
  from public.site_baselines as b
  where b.id = v_branch.baseline_id;

  return pg_catalog.jsonb_build_object(
    'branchId', v_branch.id,
    'siteId', v_branch.site_id,
    'headRevisionId', v_branch.current_revision_id,
    'sourceRevisionId', v_source_revision,
    'sourceLabel', v_source_label,
    'ancestorId', v_ancestor_id,
    'ancestorKind', v_ancestor_kind,
    'exposeAncestor', v_expose,
    'boundaryWkb', pg_catalog.encode(extensions.st_asewkb(v_boundary), 'hex')
  );
end;
$$;

revoke all on function public.merge_context(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.merge_preview(
  p_branch_id uuid,
  p_source_publication_id uuid,
  p_resolutions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_result jsonb;
  v_public_ancestor uuid;
begin
  v_ctx := public.merge_context(p_branch_id, p_source_publication_id, false);
  v_result := public.merge_compute(
    (v_ctx ->> 'headRevisionId')::uuid,
    (v_ctx ->> 'sourceRevisionId')::uuid,
    (v_ctx ->> 'ancestorId')::uuid,
    (v_ctx ->> 'siteId')::uuid,
    extensions.st_geomfromewkb(pg_catalog.decode(v_ctx ->> 'boundaryWkb', 'hex')),
    coalesce(p_resolutions, '[]'::jsonb),
    (v_ctx ->> 'exposeAncestor')::boolean
  );

  if v_ctx ->> 'ancestorKind' = 'publication' then
    select p.id into v_public_ancestor
    from public.publications as p
    where p.revision_id = (v_ctx ->> 'ancestorId')::uuid;
  end if;

  return pg_catalog.jsonb_build_object(
    'branchId', v_ctx -> 'branchId',
    'headRevisionId', v_ctx -> 'headRevisionId',
    'source', pg_catalog.jsonb_build_object(
      'publicationId', p_source_publication_id,
      'label', v_ctx -> 'sourceLabel'),
    'ancestor', pg_catalog.jsonb_build_object(
      'kind', v_ctx -> 'ancestorKind',
      'revisionId', case when v_ctx ->> 'ancestorKind' = 'own_revision' then v_ctx -> 'ancestorId' end,
      'publicationId', v_public_ancestor),
    'engineVersion', v_result -> 'engineVersion',
    'conflicts', v_result -> 'conflicts',
    'unresolved', v_result -> 'unresolved',
    'invalidResolutions', v_result -> 'invalidResolutions',
    'warnings', v_result -> 'warnings',
    'operations', v_result -> 'operations',
    'featureCount', v_result -> 'featureCount',
    'tooManyFeatures', v_result -> 'tooManyFeatures',
    'features', (
      select coalesce(pg_catalog.jsonb_agg(value - 'wkb'), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_result -> 'features')
    )
  );
end;
$$;

revoke all on function public.merge_preview(uuid, uuid, jsonb) from public, anon;
grant execute on function public.merge_preview(uuid, uuid, jsonb) to authenticated;

create or replace function public.merge_commit(
  p_branch_id uuid,
  p_source_publication_id uuid,
  p_expected_head_id uuid,
  p_message text,
  p_resolutions jsonb,
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
  v_ctx jsonb;
  v_result jsonb;
  v_revision_id uuid := pg_catalog.gen_random_uuid();
  v_head uuid;
  response jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_branch_id is null
    or p_source_publication_id is null
    or p_expected_head_id is null
    or p_message is null
    or char_length(pg_catalog.btrim(p_message)) not between 1 and 100
    or p_resolutions is null
    or pg_catalog.jsonb_typeof(p_resolutions) <> 'array'
    or pg_catalog.octet_length(p_resolutions::text) > 524288
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_merge_request';
  end if;

  -- Own idempotency namespace: a merge key never collides with a save key.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':merge_commit:' || p_idempotency_key, 0)
  );
  select * into previous
  from public.mutation_requests as request
  where request.actor_id = actor
    and request.operation = 'merge_commit'
    and request.idempotency_key = p_idempotency_key;
  if found then
    if previous.payload_hash <> p_payload_hash then
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  v_ctx := public.merge_context(p_branch_id, p_source_publication_id, true);
  v_head := (v_ctx ->> 'headRevisionId')::uuid;
  if v_head is distinct from p_expected_head_id then
    raise exception using errcode = 'FT409', message = 'stale_head', detail = v_head::text;
  end if;

  -- Recompute everything server-side with the exact ids; client previews are advisory.
  v_result := public.merge_compute(
    v_head,
    (v_ctx ->> 'sourceRevisionId')::uuid,
    (v_ctx ->> 'ancestorId')::uuid,
    (v_ctx ->> 'siteId')::uuid,
    extensions.st_geomfromewkb(pg_catalog.decode(v_ctx ->> 'boundaryWkb', 'hex')),
    p_resolutions,
    (v_ctx ->> 'exposeAncestor')::boolean
  );

  if pg_catalog.jsonb_array_length(v_result -> 'invalidResolutions') > 0 then
    raise exception using errcode = 'FT422', message = 'invalid_resolution',
      detail = (v_result -> 'invalidResolutions')::text;
  end if;
  if pg_catalog.jsonb_array_length(v_result -> 'unresolved') > 0 then
    raise exception using errcode = 'FT422', message = 'unresolved_conflicts',
      detail = (v_result -> 'unresolved')::text;
  end if;
  if (v_result ->> 'tooManyFeatures')::boolean then
    raise exception using errcode = 'FT422', message = 'too_many_features';
  end if;

  insert into public.revisions (
    id, branch_id, site_id, baseline_id, parent_revision_id, merge_parent_revision_id,
    message, author_id
  )
  select v_revision_id, b.id, b.site_id, b.baseline_id, v_head,
         (v_ctx ->> 'sourceRevisionId')::uuid, pg_catalog.btrim(p_message), actor
  from public.branches as b
  where b.id = p_branch_id;

  -- Exact geometry copy through EWKB; the containment trigger still checks every row.
  insert into public.revision_features (revision_id, site_id, feature_id, kind, properties, geometry)
  select v_revision_id,
         (v_ctx ->> 'siteId')::uuid,
         (f ->> 'id')::uuid,
         (f ->> 'kind')::public.intervention_kind,
         f -> 'properties',
         extensions.st_geomfromewkb(pg_catalog.decode(f ->> 'wkb', 'hex'))
  from pg_catalog.jsonb_array_elements(v_result -> 'features') as f;

  insert into public.revision_merge_decisions (
    revision_id, source_publication_id, source_revision_id, ancestor_revision_id,
    ancestor_kind, engine_version, decisions
  )
  values (
    v_revision_id,
    p_source_publication_id,
    (v_ctx ->> 'sourceRevisionId')::uuid,
    (v_ctx ->> 'ancestorId')::uuid,
    v_ctx ->> 'ancestorKind',
    v_result ->> 'engineVersion',
    pg_catalog.jsonb_build_object(
      'conflicts', (
        select coalesce(pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object('id', c -> 'id', 'type', c -> 'type')), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(v_result -> 'conflicts') as c),
      'resolutions', (
        select coalesce(pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'conflictId', res -> 'conflictId',
                   'action', res -> 'action',
                   'featureId', coalesce(res -> 'featureId', res #> '{feature,id}'))), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(p_resolutions) as res),
      'operations', v_result -> 'operations',
      'warnings', v_result -> 'warnings'
    )
  );

  update public.branches
  set current_revision_id = v_revision_id
  where id = p_branch_id;

  response := pg_catalog.jsonb_build_object(
    'branchId', p_branch_id,
    'revisionId', v_revision_id,
    'parentRevisionId', v_head,
    'sourcePublicationId', p_source_publication_id,
    'ancestorKind', v_ctx ->> 'ancestorKind',
    'featureCount', v_result -> 'featureCount',
    'conflictCount', pg_catalog.jsonb_array_length(v_result -> 'conflicts')
  );

  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'merge_commit', p_idempotency_key, p_payload_hash, response);

  return response;
end;
$$;

revoke all on function public.merge_commit(uuid, uuid, uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.merge_commit(uuid, uuid, uuid, text, jsonb, text, text) to authenticated;

-- Branch head gains merge provenance: the merged publication and whether it is still
-- visible. A hidden source never deletes materialized changes.
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
    'sourcePublicationId', b.source_publication_id,
    'sourceVisible', case
      when b.source_publication_id is null then null
      else public.public_publication_exists(b.source_publication_id)
    end,
    'mergeSourcePublicationId', d.source_publication_id,
    'mergeSourceVisible', case
      when d.source_publication_id is null then null
      else public.public_publication_exists(d.source_publication_id)
    end,
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
  left join public.revision_merge_decisions as d on d.revision_id = r.id
  where b.id = p_branch_id
    and b.owner_id = (select auth.uid())
    and not b.is_deleted;
$$;

revoke all on function public.get_branch_head(uuid) from public, anon;
grant execute on function public.get_branch_head(uuid) to authenticated;
