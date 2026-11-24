-- Compare two visible snapshots of the same site and baseline (FT-07), spec 03 task 4.
-- Joins by feature id and classifies equal/added/removed/modified. Comparing never
-- changes snapshots: the function is STABLE and writes nothing.

create or replace function public.compare_revisions(
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
  v_left record;
  v_right record;
  v_scenario public.analysis_scenarios%rowtype;
  v_left_created timestamptz;
  v_right_created timestamptz;
  v_left_label text;
  v_right_label text;
  v_left_analysis jsonb;
  v_right_analysis jsonb;
  v_left_cost jsonb;
  v_right_cost jsonb;
  v_features jsonb;
  v_counts jsonb;
  v_compatible boolean;
begin
  select r.ref_kind, r.site_id, r.baseline_id, r.revision_id
  into v_left
  from public.resolve_snapshot_ref(p_left) as r;

  select r.ref_kind, r.site_id, r.baseline_id, r.revision_id
  into v_right
  from public.resolve_snapshot_ref(p_right) as r;

  if v_left.site_id <> v_right.site_id or v_left.baseline_id <> v_right.baseline_id then
    raise exception using errcode = 'FT422', message = 'incompatible_snapshots';
  end if;

  select a.*
  into v_scenario
  from public.analysis_scenarios as a
  where a.site_id = v_left.site_id
    and (a.slug = p_scenario_slug or (p_scenario_slug is null and a.is_default))
  limit 1;

  if v_scenario.id is null then
    raise exception using errcode = '22023', message = 'invalid_scenario';
  end if;

  -- Per-side creation time pins the catalog; per-side label is public or own data only.
  if v_left.revision_id is not null then
    select r.created_at into v_left_created from public.revisions as r where r.id = v_left.revision_id;
  else
    select b.created_at into v_left_created from public.site_baselines as b where b.id = v_left.baseline_id;
  end if;
  if v_right.revision_id is not null then
    select r.created_at into v_right_created from public.revisions as r where r.id = v_right.revision_id;
  else
    select b.created_at into v_right_created from public.site_baselines as b where b.id = v_right.baseline_id;
  end if;

  if v_left.ref_kind = 'publication' then
    select p.public_label into v_left_label
    from public.publications as p
    where p.id = pg_catalog.split_part(p_left, ':', 2)::uuid;
  elsif v_left.ref_kind = 'baseline' then
    v_left_label := 'baseline';
  else
    select b.title into v_left_label
    from public.revisions as r
    join public.branches as b on b.id = r.branch_id
    where r.id = v_left.revision_id;
  end if;

  if v_right.ref_kind = 'publication' then
    select p.public_label into v_right_label
    from public.publications as p
    where p.id = pg_catalog.split_part(p_right, ':', 2)::uuid;
  elsif v_right.ref_kind = 'baseline' then
    v_right_label := 'baseline';
  else
    select b.title into v_right_label
    from public.revisions as r
    join public.branches as b on b.id = r.branch_id
    where r.id = v_right.revision_id;
  end if;

  v_left_analysis := public.analysis_compute(v_left.revision_id, v_left.baseline_id, v_scenario.id);
  v_right_analysis := public.analysis_compute(v_right.revision_id, v_right.baseline_id, v_scenario.id);
  v_left_cost := public.cost_compute(v_left.revision_id, v_left.site_id, v_left_created);
  v_right_cost := public.cost_compute(v_right.revision_id, v_right.site_id, v_right_created);

  -- Catalogs must match unless one side has no lines at all (the empty baseline):
  -- a zero side cannot distort the delta, whichever catalog the other side pins.
  v_compatible := (v_left_cost -> 'catalogVersionId') is not distinct from (v_right_cost -> 'catalogVersionId')
    or pg_catalog.jsonb_array_length(v_left_cost -> 'lines') = 0
    or pg_catalog.jsonb_array_length(v_right_cost -> 'lines') = 0;

  with lf as (
    select f.feature_id as id, f.kind, f.properties, f.geometry
    from public.revision_features as f
    where f.revision_id = v_left.revision_id
  ),
  rf as (
    select f.feature_id as id, f.kind, f.properties, f.geometry
    from public.revision_features as f
    where f.revision_id = v_right.revision_id
  ),
  joined as (
    select coalesce(l.id, r.id) as id,
           l.kind as lk, r.kind as rk,
           l.properties as lp, r.properties as rp,
           l.geometry as lg, r.geometry as rg,
           case
             when l.id is null then 'added'
             when r.id is null then 'removed'
             when l.kind <> r.kind
               or l.properties <> r.properties
               or not extensions.st_equals(l.geometry, r.geometry) then 'modified'
             else 'equal'
           end as class
    from lf as l
    full outer join rf as r on r.id = l.id
  )
  select pg_catalog.jsonb_build_object(
           'equal', pg_catalog.count(*) filter (where class = 'equal'),
           'added', pg_catalog.count(*) filter (where class = 'added'),
           'removed', pg_catalog.count(*) filter (where class = 'removed'),
           'modified', pg_catalog.count(*) filter (where class = 'modified')
         ),
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', id,
               'class', class,
               'kindChanged', lk is distinct from rk,
               'propertiesChanged', lp is distinct from rp,
               'geometryChanged', case
                 when class in ('added', 'removed') then null
                 else not extensions.st_equals(lg, rg) end,
               'changedKeys', (
                 select coalesce(pg_catalog.jsonb_agg(k order by k), '[]'::jsonb)
                 from (
                   select pg_catalog.jsonb_object_keys(
                     coalesce(lp, '{}'::jsonb) || coalesce(rp, '{}'::jsonb)) as k
                 ) as keys
                 where coalesce(lp, '{}'::jsonb) -> k
                   is distinct from coalesce(rp, '{}'::jsonb) -> k
               ),
               'left', case when lk is not null then pg_catalog.jsonb_build_object(
                 'kind', lk, 'properties', lp,
                 'geometry', extensions.st_asgeojson(lg, 6)::jsonb) end,
               'right', case when rk is not null then pg_catalog.jsonb_build_object(
                 'kind', rk, 'properties', rp,
                 'geometry', extensions.st_asgeojson(rg, 6)::jsonb) end
             )
             order by id
           ) filter (where class <> 'equal'),
           '[]'::jsonb)
  into v_counts, v_features
  from joined;

  return pg_catalog.jsonb_build_object(
    'siteId', v_left.site_id,
    'baselineId', v_left.baseline_id,
    'scenario', pg_catalog.jsonb_build_object(
      'slug', v_scenario.slug,
      'localDatetime', v_scenario.local_datetime,
      'timezone', v_scenario.timezone,
      'instantUtc', v_scenario.instant_utc,
      'azimuthRad', v_scenario.azimuth_rad,
      'elevationRad', v_scenario.elevation_rad
    ),
    'engineVersion', public.analysis_engine_version(),
    'left', pg_catalog.jsonb_build_object(
      'ref', p_left,
      'refKind', v_left.ref_kind,
      'label', v_left_label,
      'analysis', v_left_analysis,
      'cost', v_left_cost
    ),
    'right', pg_catalog.jsonb_build_object(
      'ref', p_right,
      'refKind', v_right.ref_kind,
      'label', v_right_label,
      'analysis', v_right_analysis,
      'cost', v_right_cost
    ),
    'counts', v_counts,
    'features', v_features,
    'metricDeltas', pg_catalog.jsonb_build_object(
      'shadeM2', pg_catalog.round(
        ((v_right_analysis #>> '{shade,m2}')::numeric - (v_left_analysis #>> '{shade,m2}')::numeric), 2),
      'shadePct', pg_catalog.round(
        ((v_right_analysis #>> '{shade,pct}')::numeric - (v_left_analysis #>> '{shade,pct}')::numeric), 2),
      'remainingM2', pg_catalog.round(
        ((v_right_analysis #>> '{occupancy,remainingM2}')::numeric - (v_left_analysis #>> '{occupancy,remainingM2}')::numeric), 2),
      'crossingLengthM', pg_catalog.round(
        ((v_right_analysis #>> '{occupancy,crossingLengthM}')::numeric - (v_left_analysis #>> '{occupancy,crossingLengthM}')::numeric), 2)
    ),
    'catalogCompatible', v_compatible,
    'costDelta', case when v_compatible then pg_catalog.jsonb_build_object(
      'totalLowCents', (v_right_cost ->> 'totalLowCents')::bigint - (v_left_cost ->> 'totalLowCents')::bigint,
      'totalHighCents', (v_right_cost ->> 'totalHighCents')::bigint - (v_left_cost ->> 'totalHighCents')::bigint
    ) end
  );
end;
$$;

revoke all on function public.compare_revisions(text, text, text) from public;
grant execute on function public.compare_revisions(text, text, text) to anon, authenticated;
