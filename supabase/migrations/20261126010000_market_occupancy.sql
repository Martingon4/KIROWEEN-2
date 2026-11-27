-- A trunk occupies its mapped point. Its projected shade or crown is separate.
create function public.guard_market_tree_occupancy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind not in ('shade_tree', 'temporary_market') then
    return new;
  end if;

  if exists (
    select 1
    from public.revision_features as other
    join public.revisions as revision on revision.id = new.revision_id
    where other.revision_id = new.revision_id
      and (
        (new.kind = 'shade_tree' and other.kind = 'temporary_market'
          and extensions.st_covers(other.geometry, new.geometry))
        or (new.kind = 'temporary_market' and other.kind = 'shade_tree'
          and extensions.st_covers(new.geometry, other.geometry))
      )
      -- Keep historical revisions forkable and allow unchanged geometry to be carried forward.
      and not exists (
        select 1
        from public.revision_features as parent_feature
        join public.revision_features as parent_other
          on parent_other.revision_id = parent_feature.revision_id
         and parent_other.feature_id = other.feature_id
        where parent_feature.revision_id in (revision.parent_revision_id, revision.merge_parent_revision_id)
          and parent_feature.feature_id = new.feature_id
          and parent_feature.kind = new.kind
          and parent_other.kind = other.kind
          and extensions.st_equals(parent_feature.geometry, new.geometry)
          and extensions.st_equals(parent_other.geometry, other.geometry)
      )
  ) then
    raise exception using errcode = 'FT422', message = 'market_tree_overlap';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_market_tree_occupancy() from public, anon, authenticated;

create trigger revision_features_market_tree_occupancy
after insert on public.revision_features
for each row execute function public.guard_market_tree_occupancy();

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
           case when u.kind = 'proposed_crossing'
                then extensions.st_buffer(
                  extensions.st_transform(u.geom, p_srid),
                  (u.props ->> 'widthM')::double precision / 2,
                  'endcap=flat'
                )
                else extensions.st_transform(u.geom, p_srid)
           end as mg,
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
           case when x1.kind = 'shade_tree' or x2.kind = 'shade_tree'
                then 0
                else extensions.st_area(extensions.st_intersection(x1.mg, x2.mg))
           end as area,
           (x1.kind = 'shade_tree' or x2.kind = 'shade_tree') as point_conflict
    from x as x1
    join x as x2 on x1.ord < x2.ord
    where (x1.kind = 'shade_tree' and x2.kind = 'temporary_market'
             and extensions.st_covers(x2.geom, x1.geom))
       or (x1.kind = 'temporary_market' and x2.kind = 'shade_tree'
             and extensions.st_covers(x1.geom, x2.geom))
       or (x1.mg operator(extensions.&&) x2.mg
           and (public.merge_exclusive_pair(x1.kind, x1.props, x2.kind, x2.props)
             or (x1.kind = 'proposed_crossing' and x2.kind = 'temporary_market')
             or (x1.kind = 'temporary_market' and x2.kind = 'proposed_crossing')))
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
             'thresholdM2', case when point_conflict then 0 else p_threshold end,
             'blocking', blocking
           ) order by least(id1, id2), greatest(id1, id2)), '[]'::jsonb)
  from candidates
  where point_conflict or area > p_threshold;
$$;
