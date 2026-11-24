-- Independent-review fixes for the FT-08 merge (reviewer-opus, spec 03 task 5):
-- 1. Overlaps introduced by a redraw are now listed as conflicts and can be resolved:
--    spatial resolutions are applied iteratively until no pending one matches, and
--    every blocking pair seen in any pass is reported.
-- 2. Blocking rule follows the design: a pair whose two elements already coexisted on
--    one side (target or source, including unchanged ancestor features) is a warning;
--    pairs that only exist because the merge combines both sides, or that involve a
--    user resolution, block.
-- 3. Operations no longer reveal ids of features that existed only in a private
--    ancestor (deleted on both sides).
-- 4. The commit checks the expected head right after locking the branch, so a
--    concurrent merge returns 409 stale_head instead of 422 already_merged.
-- 5. Feature equality is exact (EWKB bytes), not topological: a reversed line or a
--    rotated ring is a change, consistent with the exact EWKB copy.
-- 6. Only blocking overlaps are conflicts; non-blocking ones are warnings only.
-- 7. Spatial pairs use a bounding-box prefilter, transform each geometry once, and
--    compute each intersection area once. merge_preview caps resolutions at 512 KiB.

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
    else k1 = k2 and p1 = p2
      and extensions.st_asewkb(g1) = extensions.st_asewkb(g2)
  end;
$$;

revoke all on function public.merge_same_feature(
  public.intervention_kind, jsonb, extensions.geometry,
  public.intervention_kind, jsonb, extensions.geometry
) from public, anon, authenticated;

-- Exclusive-zone overlaps of one feature set, with the blocking rule. Provenance:
-- ancestor (unchanged), target, source, both (same change), resolved (user decision).
create or replace function public.merge_spatial_pairs(
  p_ids uuid[],
  p_kinds public.intervention_kind[],
  p_props jsonb[],
  p_geoms extensions.geometry[],
  p_prov text[],
  p_srid integer,
  p_threshold numeric
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with x as materialized (
    select u.id, u.kind, u.props, u.geom, u.prov, u.ord,
           extensions.st_transform(u.geom, p_srid) as mg,
           u.prov in ('ancestor', 'target', 'both') as in_t,
           u.prov in ('ancestor', 'source', 'both') as in_s
    from unnest(p_ids, p_kinds, p_props, p_geoms, p_prov)
           with ordinality as u(id, kind, props, geom, prov, ord)
  ),
  candidates as (
    select x1.id as id1, x2.id as id2, x1.kind as k1, x2.kind as k2,
           x1.props as p1, x2.props as p2,
           x1.prov = 'resolved' or x2.prov = 'resolved'
             or not ((x1.in_t and x2.in_t) or (x1.in_s and x2.in_s)) as blocking,
           extensions.st_area(extensions.st_intersection(x1.mg, x2.mg)) as area
    from x as x1
    join x as x2
      on x1.ord < x2.ord
     and x1.geom operator(extensions.&&) x2.geom
    where public.merge_exclusive_pair(x1.kind, x1.props, x2.kind, x2.props)
  )
  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', 'spatial:' || least(id1, id2)::text || ':' || greatest(id1, id2)::text,
             'type', 'exclusive_overlap',
             'featureIds', pg_catalog.jsonb_build_array(least(id1, id2), greatest(id1, id2)),
             'kinds', case when id1 < id2
                           then pg_catalog.jsonb_build_array(k1, k2)
                           else pg_catalog.jsonb_build_array(k2, k1) end,
             'timeSlot', coalesce(p1 ->> 'timeSlot', p2 ->> 'timeSlot'),
             'intersectionM2', pg_catalog.round(area::numeric, 2),
             'thresholdM2', p_threshold,
             'blocking', blocking
           ) order by least(id1, id2), greatest(id1, id2)), '[]'::jsonb)
  from candidates
  where area > p_threshold;
$$;

revoke all on function public.merge_spatial_pairs(
  uuid[], public.intervention_kind[], jsonb[], extensions.geometry[], text[], integer, numeric
) from public, anon, authenticated;

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
  v_pending jsonb;
  v_pairs jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_applied boolean := false;
  v_round integer := 0;
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

    if v_decision <> 'unchanged'
      and not (r.tk is null and r.sk is null and not p_expose_ancestor)
    then
      v_operations := v_operations || pg_catalog.jsonb_build_object(
        'featureId', r.id,
        'decision', v_decision,
        'present', (v_take = 'target' and r.tk is not null)
                   or (v_take = 'source' and r.sk is not null)
                   or v_take = 'redraw'
      );
    end if;
  end loop;

  -- Element resolutions that matched no element conflict are unknown.
  for v_cid in select key from pg_catalog.jsonb_each(v_res_by_id) loop
    if (v_cid like 'element:%' and not (v_cid = any (v_used)))
      or (v_cid not like 'element:%' and v_cid not like 'spatial:%')
    then
      v_invalid := v_invalid || pg_catalog.jsonb_build_object(
        'conflictId', v_cid, 'reason', 'unknown_conflict');
    end if;
  end loop;

  -- Spatial rounds. Each round recomputes overlaps on the current set and applies the
  -- pending resolutions whose blocking conflict is present. Overlaps introduced by a
  -- redraw therefore become conflicts the user can resolve in the next preview.
  select coalesce(pg_catalog.jsonb_object_agg(key, value), '{}'::jsonb)
  into v_pending
  from pg_catalog.jsonb_each(v_res_by_id)
  where key like 'spatial:%';

  loop
    v_round := v_round + 1;
    v_pairs := public.merge_spatial_pairs(
      f_ids, f_kinds, f_props, f_geoms, f_prov, v_srid, v_threshold);

    select v_seen || coalesce(pg_catalog.jsonb_object_agg(value ->> 'id', value), '{}'::jsonb)
    into v_seen
    from pg_catalog.jsonb_array_elements(v_pairs)
    where (value ->> 'blocking')::boolean
      and not (v_seen ? (value ->> 'id'));

    v_applied := false;
    for v_cid, v_res in select key, value from pg_catalog.jsonb_each(v_pending) loop
      -- SELECT INTO keeps the previous value when no row matches, so reset first.
      v_pair := null;
      select value into v_pair
      from pg_catalog.jsonb_array_elements(v_pairs)
      where value ->> 'id' = v_cid
        and (value ->> 'blocking')::boolean;
      if v_pair is null then
        continue;
      end if;
      v_pending := v_pending - v_cid;
      v_applied := true;
      v_action := v_res ->> 'action';
      if v_action = 'remove' then
        begin
          v_target_fid := (v_res ->> 'featureId')::uuid;
        exception when invalid_text_representation then
          v_target_fid := null;
        end;
        if v_target_fid is null
          or not (v_pair -> 'featureIds') @> pg_catalog.to_jsonb(v_target_fid::text)
        then
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

    exit when not v_applied or v_round >= 50;
  end loop;

  -- The last round applied something: recompute the final state once more.
  if v_applied then
    v_pairs := public.merge_spatial_pairs(
      f_ids, f_kinds, f_props, f_geoms, f_prov, v_srid, v_threshold);
    select v_seen || coalesce(pg_catalog.jsonb_object_agg(value ->> 'id', value), '{}'::jsonb)
    into v_seen
    from pg_catalog.jsonb_array_elements(v_pairs)
    where (value ->> 'blocking')::boolean
      and not (v_seen ? (value ->> 'id'));
  end if;

  -- Spatial resolutions whose conflict never appeared are unknown.
  for v_cid in select key from pg_catalog.jsonb_each(v_pending) loop
    v_invalid := v_invalid || pg_catalog.jsonb_build_object(
      'conflictId', v_cid, 'reason', 'unknown_conflict');
  end loop;

  -- Only blocking overlaps are conflicts; the rest are warnings.
  select v_conflicts || coalesce(pg_catalog.jsonb_agg(value order by key), '[]'::jsonb)
  into v_conflicts
  from pg_catalog.jsonb_each(v_seen);

  select v_unresolved || coalesce(pg_catalog.jsonb_agg(value -> 'id'), '[]'::jsonb)
  into v_unresolved
  from pg_catalog.jsonb_array_elements(v_pairs)
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
      from pg_catalog.jsonb_array_elements(v_pairs)
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
  if p_resolutions is not null and pg_catalog.octet_length(p_resolutions::text) > 524288 then
    raise exception using errcode = '22023', message = 'invalid_merge_request';
  end if;
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

  -- Lock order publication -> site -> branch, then compare the head before the domain
  -- checks: a concurrent merge is a stale head (409), not already_merged (422).
  perform 1
  from public.publications as p
  join public.revisions as r on r.id = p.revision_id
  join public.sites as s on s.id = r.site_id
  where p.id = p_source_publication_id
  for share of p, s;
  select b.current_revision_id into v_head
  from public.branches as b
  where b.id = p_branch_id and b.owner_id = actor and not b.is_deleted
  for update;
  if found and v_head is distinct from p_expected_head_id then
    raise exception using errcode = 'FT409', message = 'stale_head', detail = v_head::text;
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
