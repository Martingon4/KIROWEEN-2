-- Add a page read model using the same spatial rules as merge. Both references
-- must pass the ordinary comparison visibility and compatibility checks.
create function public.compare_revisions_for_page(
  p_left text,
  p_right text,
  p_scenario_slug text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_compare jsonb;
  v_left uuid;
  v_right uuid;
  v_overlaps jsonb;
begin
  v_compare := public.compare_revisions(p_left, p_right, p_scenario_slug);
  select r.revision_id into v_left from public.resolve_snapshot_ref(p_left) as r;
  select r.revision_id into v_right from public.resolve_snapshot_ref(p_right) as r;

  if v_left is not null and v_right is not null and v_left <> v_right then
    with variants as materialized (
      select f.feature_id, f.kind, f.properties, f.geometry,
             case when f.revision_id = v_left then 'target' else 'source' end as side,
             -- Distinguish the two versions of a changed feature for this read.
             pg_catalog.md5(f.revision_id::text || ':' || f.feature_id::text)::uuid as variant_id
      from public.revision_features as f
      where f.revision_id in (v_left, v_right)
        and not exists (
          select 1
          from public.revision_features as other
          where other.revision_id = case when f.revision_id = v_left then v_right else v_left end
            and other.feature_id = f.feature_id
            and other.kind = f.kind
            and (other.properties -> 'timeSlot') is not distinct from (f.properties -> 'timeSlot')
            and (other.properties -> 'widthM') is not distinct from (f.properties -> 'widthM')
            and extensions.st_equals(other.geometry, f.geometry)
        )
    ), merge_inputs as (
      select array_agg(variant_id order by variant_id) as ids,
             array_agg(kind order by variant_id) as kinds,
             array_agg(properties order by variant_id) as props,
             array_agg(geometry order by variant_id) as geoms,
             array_agg(side order by variant_id) as sides
      from variants
    ), pairs as (
      select item
      from merge_inputs as i
      join public.sites as s on s.id = (v_compare ->> 'siteId')::uuid
      cross join lateral pg_catalog.jsonb_array_elements(public.merge_spatial_pairs(
        i.ids, i.kinds, i.props, i.geoms, i.sides, s.metric_srid, s.merge_overlap_threshold_m2
      )) as item
      where (item ->> 'blocking')::boolean
    ), ranked as (
      select pg_catalog.jsonb_build_object(
               'leftLabel', case when a.side = 'target' then a.properties else b.properties end ->> 'label',
               'rightLabel', case when a.side = 'source' then a.properties else b.properties end ->> 'label',
               'intersectionM2', case when a.kind = 'shade_tree' or b.kind = 'shade_tree'
                                 then null else item -> 'intersectionM2' end
             ) as overlap,
             row_number() over (order by (item ->> 'intersectionM2')::numeric desc, item ->> 'id') as rank
      from pairs
      join variants as a on a.variant_id = (item #>> '{featureIds,0}')::uuid
      join variants as b on b.variant_id = (item #>> '{featureIds,1}')::uuid
      where a.feature_id <> b.feature_id
    )
    select pg_catalog.jsonb_build_object(
      'count', count(*),
      'examples', coalesce(pg_catalog.jsonb_agg(overlap order by rank) filter (where rank <= 3), '[]'::jsonb)
    )
    into v_overlaps
    from ranked;
  end if;

  return v_compare || pg_catalog.jsonb_build_object(
    'spatialOverlaps', coalesce(v_overlaps, '{"count":0,"examples":[]}'::jsonb)
  );
end;
$$;

revoke all on function public.compare_revisions_for_page(text, text, text) from public;
grant execute on function public.compare_revisions_for_page(text, text, text) to anon, authenticated;
