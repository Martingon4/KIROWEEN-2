-- Spatial indicators and cost ranges (FT-11, FT-12), spec 03 tasks 2-3.
-- One internal compute function per concern and one public wrapper that resolves
-- visibility through resolve_snapshot_ref. All metric math happens in the site's
-- metric SRID; money is integer cents with half-up rounding per line.

create or replace function public.analysis_compute(
  p_revision_id uuid,
  p_baseline_id uuid,
  p_scenario_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_metric_srid integer;
  v_completeness text;
  v_reference extensions.geometry;
  v_reference_kind text;
  v_reference_m2 numeric;
  v_azimuth numeric;
  v_elevation numeric;
  v_shade_m2 numeric;
  v_shade_elements integer;
  v_slots jsonb;
  v_market_m2 numeric;
  v_crossing_m numeric;
begin
  select b.site_id,
         coalesce(b.pedestrian_area, b.boundary),
         case when b.pedestrian_area is not null then 'pedestrian_area' else 'boundary_fallback' end,
         s.metric_srid,
         s.completeness
  into v_site_id, v_reference, v_reference_kind, v_metric_srid, v_completeness
  from public.site_baselines as b
  join public.sites as s on s.id = b.site_id
  where b.id = p_baseline_id;

  if v_site_id is null then
    raise exception using errcode = '22023', message = 'invalid_baseline';
  end if;

  select a.azimuth_rad, a.elevation_rad
  into v_azimuth, v_elevation
  from public.analysis_scenarios as a
  where a.id = p_scenario_id
    and a.site_id = v_site_id;

  if v_azimuth is null then
    raise exception using errcode = '22023', message = 'invalid_scenario';
  end if;

  v_reference_m2 := extensions.st_area(extensions.st_transform(v_reference, v_metric_srid));

  -- Shade: d = H / tan(elevation), opposite the sun. Tree as canopy disc, canopy as
  -- translated polygon; union, then clip to the reference surface.
  with feats as (
    select f.kind, f.properties,
           extensions.st_transform(f.geometry, v_metric_srid) as g
    from public.revision_features as f
    where f.revision_id = p_revision_id
  ),
  shadows as (
    select case
             when f.kind = 'shade_tree' then
               extensions.st_translate(
                 extensions.st_buffer(f.g, ((f.properties ->> 'canopyDiameterM')::numeric / 2)::double precision, 'quad_segs=8'),
                 o.dx, o.dy)
             else
               extensions.st_translate(f.g, o.dx, o.dy)
           end as shadow
    from feats as f
    cross join lateral (
      select (-( (f.properties ->> 'heightM')::numeric / pg_catalog.tan(v_elevation) )
              * pg_catalog.sin(v_azimuth))::double precision as dx,
             (-( (f.properties ->> 'heightM')::numeric / pg_catalog.tan(v_elevation) )
              * pg_catalog.cos(v_azimuth))::double precision as dy
    ) as o
    where f.kind in ('shade_tree', 'shade_canopy')
  )
  select pg_catalog.count(*)::integer,
         coalesce(
           extensions.st_area(
             extensions.st_intersection(
               extensions.st_union(shadows.shadow),
               extensions.st_transform(v_reference, v_metric_srid))),
           0)
  into v_shade_elements, v_shade_m2
  from shadows;

  -- Occupancy: market polygons unioned per time slot to avoid double counting.
  with feats as (
    select f.kind, f.properties,
           extensions.st_transform(f.geometry, v_metric_srid) as g
    from public.revision_features as f
    where f.revision_id = p_revision_id
  ),
  markets as (
    select f.properties ->> 'timeSlot' as slot,
           f.g,
           (f.properties ->> 'stallCount')::numeric as stalls,
           (f.properties ->> 'moduleM2')::numeric as module_m2,
           extensions.st_area(f.g) as area_m2
    from feats as f
    where f.kind = 'temporary_market'
  ),
  per_slot as (
    select slot,
           extensions.st_area(
             extensions.st_intersection(
               extensions.st_union(g),
               extensions.st_transform(v_reference, v_metric_srid))) as slot_area,
           pg_catalog.sum(stalls) as slot_stalls,
           pg_catalog.sum(pg_catalog.floor(area_m2 / module_m2)) as slot_fit
    from markets
    group by slot
  )
  select coalesce(
           (select pg_catalog.jsonb_agg(
                     pg_catalog.jsonb_build_object(
                       'timeSlot', per_slot.slot,
                       'areaM2', pg_catalog.round(per_slot.slot_area::numeric, 2),
                       'stallCount', per_slot.slot_stalls,
                       'fitByArea', per_slot.slot_fit,
                       'fitByAreaPreliminary', true
                     )
                     order by per_slot.slot)
            from per_slot),
           '[]'::jsonb)
  into v_slots;

  with feats as (
    select f.kind,
           extensions.st_transform(f.geometry, v_metric_srid) as g
    from public.revision_features as f
    where f.revision_id = p_revision_id
  )
  select coalesce(
           extensions.st_area(
             extensions.st_intersection(
               extensions.st_union(feats.g) filter (where feats.kind = 'temporary_market'),
               extensions.st_transform(v_reference, v_metric_srid))),
           0),
         coalesce(
           pg_catalog.sum(extensions.st_length(feats.g)) filter (where feats.kind = 'proposed_crossing'),
           0)
  into v_market_m2, v_crossing_m
  from feats;

  return pg_catalog.jsonb_build_object(
    'engineVersion', public.analysis_engine_version(),
    'referenceSurface', v_reference_kind,
    'referenceM2', pg_catalog.round(v_reference_m2, 2),
    'shade', pg_catalog.jsonb_build_object(
      'm2', pg_catalog.round(v_shade_m2, 2),
      'pct', case when v_reference_m2 > 0
                  then pg_catalog.round(v_shade_m2 / v_reference_m2 * 100, 2)
                  else 0 end,
      'elementCount', v_shade_elements,
      'coverage', case when v_completeness = 'partial'
                       then 'modeled shade of the inventoried elements'
                       else 'complete' end,
      'coverageIncomplete', v_completeness = 'partial',
      'assumptions', 'Flat ground; buildings and unmapped objects ignored.'
    ),
    'occupancy', pg_catalog.jsonb_build_object(
      'slots', v_slots,
      'remainingM2', pg_catalog.round(v_reference_m2 - v_market_m2, 2),
      'crossingLengthM', pg_catalog.round(v_crossing_m, 2),
      'affectedParking', null,
      'affectedParkingReason', 'no_parking_inventory'
    )
  );
end;
$$;

revoke all on function public.analysis_compute(uuid, uuid, uuid) from public, anon, authenticated;

-- Cost range of a revision against the (feature-empty) baseline, pinned to the catalog
-- whose effective_from is the latest not after the revision's creation. Unpriced
-- concepts are listed, never zeroed.
create or replace function public.cost_compute(
  p_revision_id uuid,
  p_site_id uuid,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_catalog public.catalog_versions%rowtype;
  v_site_currency text;
  v_metric_srid integer;
  v_lines jsonb;
  v_unknown jsonb;
  v_total_low bigint;
  v_total_high bigint;
  v_partial boolean;
  v_assumption_lines integer;
  v_priced_lines integer;
begin
  select s.currency, s.metric_srid
  into v_site_currency, v_metric_srid
  from public.sites as s
  where s.id = p_site_id;

  if p_revision_id is null or v_site_currency is null then
    return pg_catalog.jsonb_build_object(
      'catalogVersionId', null,
      'currency', v_site_currency,
      'label', 'sourced',
      'partial', false,
      'unknownConcepts', '[]'::jsonb,
      'lines', '[]'::jsonb,
      'totalLowCents', 0,
      'totalHighCents', 0
    );
  end if;

  select c.*
  into v_catalog
  from public.catalog_versions as c
  where c.site_id = p_site_id
    and c.effective_from <= p_created_at
  order by c.effective_from desc
  limit 1;

  if v_catalog.id is null then
    return pg_catalog.jsonb_build_object(
      'catalogVersionId', null,
      'currency', v_site_currency,
      'label', 'sourced',
      'partial', true,
      'unknownConcepts', '[]'::jsonb,
      'lines', '[]'::jsonb,
      'totalLowCents', 0,
      'totalHighCents', 0,
      'note', 'no_catalog_version'
    );
  end if;

  if v_catalog.currency <> v_site_currency then
    return pg_catalog.jsonb_build_object(
      'catalogVersionId', v_catalog.id,
      'currency', v_catalog.currency,
      'siteCurrency', v_site_currency,
      'error', 'currency_mismatch'
    );
  end if;

  with feats as (
    select f.kind, f.properties,
           extensions.st_transform(f.geometry, v_metric_srid) as g
    from public.revision_features as f
    where f.revision_id = p_revision_id
  ),
  quantities as (
    select f.kind,
           case f.kind
             when 'shade_tree' then 1::numeric
             when 'shade_canopy' then extensions.st_area(f.g)::numeric
             when 'temporary_market' then (f.properties ->> 'stallCount')::numeric
             when 'proposed_crossing' then extensions.st_length(f.g)::numeric * (f.properties ->> 'widthM')::numeric
           end as qty
    from feats as f
  ),
  lines as (
    select q.kind,
           pg_catalog.round(pg_catalog.sum(q.qty), 2) as quantity,
           i.code,
           i.unit,
           i.quantity_formula,
           i.price_low_cents,
           i.price_high_cents,
           i.is_assumption,
           i.assumption_owner,
           i.assumption_date
    from quantities as q
    left join public.catalog_items as i
      on i.catalog_version_id = v_catalog.id
     and i.kind = q.kind
    group by q.kind, i.code, i.unit, i.quantity_formula, i.price_low_cents, i.price_high_cents,
             i.is_assumption, i.assumption_owner, i.assumption_date
  )
  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'concept', lines.kind,
               'action', 'add',
               'code', lines.code,
               'unit', lines.unit,
               'quantity', lines.quantity,
               'formula', lines.quantity_formula,
               'status', case when lines.price_low_cents is null then 'unpriced' else 'priced' end,
               'amountLowCents', case when lines.price_low_cents is null then null
                                      else pg_catalog.round(lines.quantity * lines.price_low_cents)::bigint end,
               'amountHighCents', case when lines.price_high_cents is null then null
                                       else pg_catalog.round(lines.quantity * lines.price_high_cents)::bigint end,
               'isAssumption', coalesce(lines.is_assumption, false),
               'assumptionOwner', lines.assumption_owner,
               'assumptionDate', lines.assumption_date
             )
           ),
           '[]'::jsonb),
         coalesce(
           pg_catalog.jsonb_agg(lines.kind order by lines.kind) filter (where lines.price_low_cents is null),
           '[]'::jsonb),
         coalesce(
           pg_catalog.sum(pg_catalog.round(lines.quantity * lines.price_low_cents)) filter (where lines.price_low_cents is not null),
           0)::bigint,
         coalesce(
           pg_catalog.sum(pg_catalog.round(lines.quantity * lines.price_high_cents)) filter (where lines.price_high_cents is not null),
           0)::bigint,
         pg_catalog.count(*) filter (where lines.price_low_cents is null) > 0,
         pg_catalog.count(*) filter (where lines.price_low_cents is not null and lines.is_assumption)::integer,
         pg_catalog.count(*) filter (where lines.price_low_cents is not null)::integer
  into v_lines, v_unknown, v_total_low, v_total_high, v_partial, v_assumption_lines, v_priced_lines
  from lines;

  return pg_catalog.jsonb_build_object(
    'catalogVersionId', v_catalog.id,
    'currency', v_catalog.currency,
    'label', case
      when v_priced_lines > 0 and v_assumption_lines = v_priced_lines then 'fully_illustrative'
      when v_assumption_lines > 0 then 'partially_illustrative'
      else 'sourced' end,
    'partial', v_partial,
    'unknownConcepts', v_unknown,
    'lines', v_lines,
    'totalLowCents', v_total_low,
    'totalHighCents', v_total_high,
    'rounding', 'half-up per line, totals sum rounded lines',
    'priceDate', v_catalog.price_date,
    'source', v_catalog.source
  );
end;
$$;

revoke all on function public.cost_compute(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Public wrapper: one visibility checkpoint for single-snapshot analysis and budget.
create or replace function public.get_snapshot_analysis(p_ref text, p_scenario_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ref record;
  v_scenario public.analysis_scenarios%rowtype;
  v_created_at timestamptz;
begin
  select r.ref_kind, r.site_id, r.baseline_id, r.revision_id
  into v_ref
  from public.resolve_snapshot_ref(p_ref) as r;

  select a.*
  into v_scenario
  from public.analysis_scenarios as a
  where a.site_id = v_ref.site_id
    and (a.slug = p_scenario_slug or (p_scenario_slug is null and a.is_default))
  limit 1;

  if v_scenario.id is null then
    raise exception using errcode = '22023', message = 'invalid_scenario';
  end if;

  if v_ref.revision_id is not null then
    select r.created_at into v_created_at
    from public.revisions as r
    where r.id = v_ref.revision_id;
  else
    select b.created_at into v_created_at
    from public.site_baselines as b
    where b.id = v_ref.baseline_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'ref', p_ref,
    'refKind', v_ref.ref_kind,
    'siteId', v_ref.site_id,
    'baselineId', v_ref.baseline_id,
    'scenario', pg_catalog.jsonb_build_object(
      'slug', v_scenario.slug,
      'localDatetime', v_scenario.local_datetime,
      'timezone', v_scenario.timezone,
      'instantUtc', v_scenario.instant_utc,
      'azimuthRad', v_scenario.azimuth_rad,
      'elevationRad', v_scenario.elevation_rad
    ),
    'inputs', pg_catalog.jsonb_build_object(
      'baselineId', v_ref.baseline_id,
      'scenarioSlug', v_scenario.slug,
      'datasetChecksum', v_scenario.dataset_checksum,
      'generator', v_scenario.generator
    ),
    'analysis', public.analysis_compute(v_ref.revision_id, v_ref.baseline_id, v_scenario.id),
    'cost', public.cost_compute(v_ref.revision_id, v_ref.site_id, v_created_at)
  );
end;
$$;

revoke all on function public.get_snapshot_analysis(text, text) from public;
grant execute on function public.get_snapshot_analysis(text, text) to anon, authenticated;
