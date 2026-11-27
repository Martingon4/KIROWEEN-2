begin;

select plan(6);

select ok(public.feature_properties_are_valid('urban_object', '{"label":"Banca","objectType":"bench","heightM":0.95}'), 'accepts a catalog model');
select ok(not public.feature_properties_are_valid('urban_object', '{"label":"Banca","objectType":"unknown","heightM":0.95}'), 'rejects unknown models');
select ok(not public.feature_properties_are_valid('urban_object', '{"label":"Banca","objectType":"bench","heightM":3.1}'), 'enforces the height limit of the model');

create temp table object_shape as
select extensions.st_makeenvelope(-98.198109, 19.043597, -98.198091, 19.043603, 4326) as geom;

select ok(public.urban_object_footprint_valid('{"objectType":"bench"}', geom), 'accepts a rounded bench footprint') from object_shape;
select ok(not public.urban_object_footprint_valid('{"objectType":"stage"}', geom), 'rejects a footprint inconsistent with its model') from object_shape;
select is(
  public.merge_spatial_pairs(
    array['51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002']::uuid[],
    array['urban_object','urban_object']::public.intervention_kind[],
    array['{"objectType":"bench"}','{"objectType":"bench"}']::jsonb[],
    array[geom, geom], array['target','source'], 32614, 2
  ) -> 0 -> 'blocking', 'true'::jsonb, 'overlapping new objects from different branches need a resolution'
) from object_shape;

select * from finish();
rollback;
