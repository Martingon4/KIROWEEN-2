-- Tester-found fix for merge_compute (FT-08): a resolution without a conflictId made
-- jsonb_typeof(...) return NULL, so the malformed-entry check evaluated to NULL instead
-- of TRUE and jsonb_build_object(NULL, ...) raised 22023. Missing keys now count as
-- malformed resolutions, like an unknown action. Body otherwise unchanged.

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
      or coalesce(pg_catalog.jsonb_typeof(v_res -> 'conflictId'), '') <> 'string'
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
