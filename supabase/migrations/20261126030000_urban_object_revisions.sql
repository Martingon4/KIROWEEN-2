-- Catalog objects are immutable revision features with deterministic rectangular footprints.
-- Dimensions mirror src/lib/schemas/terrain-objects.ts. Footprint edges are snapped to 1e-6 degrees.
create function public.urban_object_dimensions(p_model text)
returns double precision[]
language sql
immutable
set search_path = ''
as $$
  select array[model.width, model.depth]::double precision[]
  from (values
    ('bench', 1.8, 0.65), ('planter', 0.95, 0.95), ('picnic_table', 1.85, 1.65),
    ('parasol', 2.8, 2.8), ('lamp', 0.45, 0.45), ('bike_rack', 1.75, 0.55),
    ('waste_bin', 0.52, 0.52), ('fountain', 2.8, 2.8), ('swing', 3.2, 2.3),
    ('stall', 2.52, 1.36), ('ramp', 1.4, 3.2), ('bollard', 0.28, 0.28),
    ('water_station', 0.7, 0.65), ('table_tennis', 2.74, 1.52), ('slide', 1.65, 3.45),
    ('stage', 4.8, 3.1)
  ) as model(id, width, depth)
  where model.id = p_model;
$$;

create function public.urban_object_footprint_valid(p_properties jsonb, p_shape extensions.geometry)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    extensions.geometrytype(p_shape) = 'POLYGON'
    and extensions.st_npoints(p_shape) = 5
    and extensions.st_equals(p_shape, extensions.st_envelope(p_shape))
    and pg_catalog.abs((extensions.st_xmax(p_shape) - extensions.st_xmin(p_shape)) * 111195
        * pg_catalog.cos(pg_catalog.radians((extensions.st_ymin(p_shape) + extensions.st_ymax(p_shape)) / 2))
        - (public.urban_object_dimensions(p_properties ->> 'objectType'))[1]) <= 0.12
    and pg_catalog.abs((extensions.st_ymax(p_shape) - extensions.st_ymin(p_shape)) * 111195
        - (public.urban_object_dimensions(p_properties ->> 'objectType'))[2]) <= 0.12,
    false
  );
$$;

create function public.urban_objects_overlap(
  p_a public.intervention_kind, p_shape_a extensions.geometry,
  p_b public.intervention_kind, p_shape_b extensions.geometry
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_a = 'urban_object' and p_b in ('urban_object', 'temporary_market', 'shade_tree'))
      or (p_b = 'urban_object' and p_a in ('temporary_market', 'shade_tree'))
    then extensions.st_intersects(p_shape_a, p_shape_b)
    else false
  end;
$$;

revoke all on function public.urban_object_dimensions(text) from public, anon, authenticated;
revoke all on function public.urban_object_footprint_valid(jsonb, extensions.geometry) from public, anon, authenticated;
revoke all on function public.urban_objects_overlap(public.intervention_kind, extensions.geometry, public.intervention_kind, extensions.geometry)
  from public, anon, authenticated;

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
    when 'urban_object' then array['label', 'objectType', 'heightM']
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
    when 'urban_object' then
      public.urban_object_dimensions(p_properties ->> 'objectType') is not null
      and public.json_number_between(p_properties -> 'heightM', 0.3,
        case when (p_properties ->> 'objectType') in ('bench', 'planter') then 3 else 8 end)
    else false
  end;
end;
$$;

revoke all on function public.feature_properties_are_valid(public.intervention_kind, jsonb)
  from public, anon, authenticated;

create function public.guard_urban_object_feature()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind not in ('urban_object', 'temporary_market', 'shade_tree') then
    return new;
  end if;

  if new.kind = 'urban_object' and not public.urban_object_footprint_valid(new.properties, new.geometry) then
    raise exception using errcode = 'FT422', message = 'invalid_geometry';
  end if;

  if exists (
    select 1 from public.revision_features as other
    where other.revision_id = new.revision_id
      and other.feature_id <> new.feature_id
      and public.urban_objects_overlap(new.kind, new.geometry, other.kind, other.geometry)
  ) then
    raise exception using errcode = 'FT422', message = 'urban_object_overlap';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_urban_object_feature() from public, anon, authenticated;

create trigger revision_features_urban_object
  after insert on public.revision_features
  for each row execute function public.guard_urban_object_feature();

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
  if v_kind = 'urban_object' and not public.urban_object_footprint_valid(p_value -> 'properties', v_shape) then
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
           (x1.kind in ('shade_tree', 'urban_object') or x2.kind in ('shade_tree', 'urban_object')) as strict_overlap
    from x as x1
    join x as x2 on x1.ord < x2.ord
    where (x1.kind = 'shade_tree' and x2.kind = 'temporary_market'
             and extensions.st_covers(x2.geom, x1.geom))
       or (x1.kind = 'temporary_market' and x2.kind = 'shade_tree'
             and extensions.st_covers(x1.geom, x2.geom))
       or public.urban_objects_overlap(x1.kind, x1.geom, x2.kind, x2.geom)
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
             'thresholdM2', case when strict_overlap then 0 else p_threshold end,
             'blocking', blocking
           ) order by least(id1, id2), greatest(id1, id2)), '[]'::jsonb)
  from candidates
  where strict_overlap or area > p_threshold;
$$;

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
             when 'urban_object' then 1::numeric
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

