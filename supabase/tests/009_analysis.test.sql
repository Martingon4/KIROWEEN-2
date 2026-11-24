begin;

select plan(234);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- 1. Schema: tables and columns
select has_table('public', 'analysis_scenarios', 'analysis_scenarios exists');
select has_table('public', 'catalog_versions', 'catalog_versions exists');
select has_table('public', 'catalog_items', 'catalog_items exists');
select columns_are(
  'public', 'analysis_scenarios',
  array['id', 'site_id', 'slug', 'local_datetime', 'timezone', 'instant_utc', 'azimuth_rad', 'elevation_rad', 'generator', 'dataset_checksum', 'is_default', 'created_at'],
  'analysis_scenarios has exactly the documented columns'
);
select columns_are(
  'public', 'catalog_versions',
  array['id', 'site_id', 'currency', 'version', 'effective_from', 'source', 'price_date', 'is_illustrative', 'assumption_owner', 'checksum', 'created_at'],
  'catalog_versions has exactly the documented columns'
);
select columns_are(
  'public', 'catalog_items',
  array['catalog_version_id', 'code', 'kind', 'unit', 'quantity_formula', 'price_low_cents', 'price_high_cents', 'is_assumption', 'assumption_owner', 'assumption_date'],
  'catalog_items has exactly the documented columns'
);
select col_type_is('public', 'analysis_scenarios', 'azimuth_rad', 'numeric(9,6)', 'azimuth_rad is numeric(9,6)');
select col_type_is('public', 'analysis_scenarios', 'elevation_rad', 'numeric(9,6)', 'elevation_rad is numeric(9,6)');
select col_not_null('public', 'catalog_items', 'quantity_formula', 'quantity_formula is required');
select col_is_null('public', 'catalog_items', 'price_low_cents', 'price_low_cents is nullable (unpriced)');
select col_is_null('public', 'catalog_items', 'price_high_cents', 'price_high_cents is nullable (unpriced)');

-- 2. Schema: RLS and table grants
select is((select relrowsecurity from pg_class where oid = 'public.analysis_scenarios'::regclass), true, 'RLS enabled on analysis_scenarios');
select is((select relrowsecurity from pg_class where oid = 'public.catalog_versions'::regclass), true, 'RLS enabled on catalog_versions');
select is((select relrowsecurity from pg_class where oid = 'public.catalog_items'::regclass), true, 'RLS enabled on catalog_items');

select is(
  (select count(*) from unnest(array['anon', 'authenticated']) as r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p
    where has_table_privilege(r, 'public.analysis_scenarios', p)),
  0::bigint, 'anon/authenticated hold no privilege on analysis_scenarios'
);
select is(
  (select count(*) from unnest(array['anon', 'authenticated']) as r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p
    where has_table_privilege(r, 'public.catalog_versions', p)),
  0::bigint, 'anon/authenticated hold no privilege on catalog_versions'
);
select is(
  (select count(*) from unnest(array['anon', 'authenticated']) as r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p
    where has_table_privilege(r, 'public.catalog_items', p)),
  0::bigint, 'anon/authenticated hold no privilege on catalog_items'
);

set local role anon;
select throws_ok($$select * from public.analysis_scenarios$$, '42501', null, 'anon cannot read analysis_scenarios');
select throws_ok($$select * from public.catalog_versions$$, '42501', null, 'anon cannot read catalog_versions');
select throws_ok($$select * from public.catalog_items$$, '42501', null, 'anon cannot read catalog_items');
set local role authenticated;
select throws_ok($$select * from public.analysis_scenarios$$, '42501', null, 'authenticated cannot read analysis_scenarios');
select throws_ok($$select * from public.catalog_versions$$, '42501', null, 'authenticated cannot read catalog_versions');
select throws_ok($$select * from public.catalog_items$$, '42501', null, 'authenticated cannot read catalog_items');
reset role;

-- 3. Seeds present
select is((select count(*) from public.analysis_scenarios where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99'), 2::bigint, 'two pilot scenarios are seeded');
select is((select slug from public.analysis_scenarios where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_default), 'equinox-1000', 'equinox-1000 is the single default scenario');
select is((select count(*) from public.analysis_scenarios where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_default), 1::bigint, 'exactly one default scenario');
select is((select count(*) from public.catalog_items where catalog_version_id = '8f5a6417-0000-4000-8000-0000000000c1'), 4::bigint, 'catalog v1 has four items');
select is(
  (select array_agg(kind::text order by kind::text) from public.catalog_items where catalog_version_id = '8f5a6417-0000-4000-8000-0000000000c1'),
  array['proposed_crossing', 'shade_canopy', 'shade_tree', 'temporary_market'],
  'catalog v1 prices the four modeled kinds'
);

-- 4. Check constraints and uniqueness
select throws_ok(
  $$insert into public.analysis_scenarios (id, site_id, slug, local_datetime, timezone, instant_utc, azimuth_rad, elevation_rad, generator, dataset_checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'bad-az', '2027-03-20T10:00:00', 'America/Mexico_City', now(), 7, 0.8, 'g', repeat('a', 64))$$,
  '23514', null, 'azimuth_rad >= 2*pi is rejected'
);
select throws_ok(
  $$insert into public.analysis_scenarios (id, site_id, slug, local_datetime, timezone, instant_utc, azimuth_rad, elevation_rad, generator, dataset_checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'neg-az', '2027-03-20T10:00:00', 'America/Mexico_City', now(), -0.1, 0.8, 'g', repeat('a', 64))$$,
  '23514', null, 'negative azimuth_rad is rejected'
);
select throws_ok(
  $$insert into public.analysis_scenarios (id, site_id, slug, local_datetime, timezone, instant_utc, azimuth_rad, elevation_rad, generator, dataset_checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'low-sun', '2027-03-20T10:00:00', 'America/Mexico_City', now(), 1, 0.17, 'g', repeat('a', 64))$$,
  '23514', null, 'elevation below radians(10) is rejected'
);
select throws_ok(
  $$insert into public.analysis_scenarios (id, site_id, slug, local_datetime, timezone, instant_utc, azimuth_rad, elevation_rad, generator, dataset_checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Bad Slug', '2027-03-20T10:00:00', 'America/Mexico_City', now(), 1, 0.8, 'g', repeat('a', 64))$$,
  '23514', null, 'a non-kebab slug is rejected'
);
select throws_ok(
  $$insert into public.analysis_scenarios (id, site_id, slug, local_datetime, timezone, instant_utc, azimuth_rad, elevation_rad, generator, dataset_checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'bad-sum', '2027-03-20T10:00:00', 'America/Mexico_City', now(), 1, 0.8, 'g', 'XYZ')$$,
  '23514', null, 'a malformed dataset_checksum is rejected'
);
select throws_ok(
  $$insert into public.analysis_scenarios (id, site_id, slug, local_datetime, timezone, instant_utc, azimuth_rad, elevation_rad, generator, dataset_checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'equinox-1000', '2027-03-20T10:00:00', 'America/Mexico_City', now(), 1, 0.8, 'g', repeat('a', 64))$$,
  '23505', null, '(site_id, slug) is unique'
);
select lives_ok(
  $$insert into public.analysis_scenarios (id, site_id, slug, local_datetime, timezone, instant_utc, azimuth_rad, elevation_rad, generator, dataset_checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'edge-ten-degrees', '2027-03-20T10:00:00', 'America/Mexico_City', now(), 0, radians(10), 'g', repeat('a', 64))$$,
  'elevation exactly radians(10) is accepted at numeric(9,6) precision'
);

select throws_ok(
  $$insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'mxn', 'bad-cur', now() + interval '1 hour', 's', current_date, false, null, repeat('a', 64))$$,
  '23514', null, 'a lowercase currency code is rejected'
);
select throws_ok(
  $$insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'no-owner', now() + interval '1 hour', 's', current_date, true, null, repeat('a', 64))$$,
  '23514', null, 'an illustrative catalog requires assumption_owner'
);
select throws_ok(
  $$insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'bad-sum', now() + interval '1 hour', 's', current_date, false, null, 'nope')$$,
  '23514', null, 'a malformed catalog checksum is rejected'
);
select throws_ok(
  $$insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'v1', now() + interval '1 hour', 's', current_date, false, null, repeat('a', 64))$$,
  '23505', null, '(site_id, version) is unique'
);
select throws_ok(
  $$insert into public.catalog_items (catalog_version_id, code, kind, unit, quantity_formula, price_low_cents, price_high_cents)
    values ('8f5a6417-0000-4000-8000-0000000000c1', 'dup-kind', 'shade_tree', 'u', 'x', 1, 2)$$,
  '23505', null, '(catalog_version_id, kind) is unique'
);
select throws_ok(
  $$insert into public.catalog_items (catalog_version_id, code, kind, unit, quantity_formula, price_low_cents, price_high_cents)
    values ('8f5a6417-0000-4000-8000-0000000000c1', 'parking', 'parking_conversion', 'u', 'x', 10, 5)$$,
  '23514', null, 'price_low_cents > price_high_cents is rejected'
);
insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
values
  ('93000000-0000-4000-8000-0000000000a0', '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'half-a', now() + interval '2 days', 's', current_date, false, null, repeat('a', 64)),
  ('93000000-0000-4000-8000-0000000000a1', '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'half-b', now() + interval '2 days', 's', current_date, false, null, repeat('a', 64));
select throws_ok(
  $$insert into public.catalog_items (catalog_version_id, code, kind, unit, quantity_formula, price_low_cents, price_high_cents)
    values ('93000000-0000-4000-8000-0000000000a0', 'parking', 'parking_conversion', 'u', 'x', 10, null)$$,
  '23514', null, 'a half-priced item (low set, high null) is rejected'
);
select throws_ok(
  $$insert into public.catalog_items (catalog_version_id, code, kind, unit, quantity_formula, price_low_cents, price_high_cents)
    values ('93000000-0000-4000-8000-0000000000a1', 'parking', 'parking_conversion', 'u', 'x', null, 10)$$,
  '23514', null, 'a half-priced item (low null, high set) is rejected'
);
select throws_ok(
  $$insert into public.catalog_items (catalog_version_id, code, kind, unit, quantity_formula, price_low_cents, price_high_cents, is_assumption)
    values ('8f5a6417-0000-4000-8000-0000000000c1', 'parking', 'parking_conversion', 'u', 'x', 1, 2, true)$$,
  '23514', null, 'an assumption item requires owner and date'
);
select throws_ok(
  $$insert into public.catalog_items (catalog_version_id, code, kind, unit, quantity_formula, price_low_cents, price_high_cents)
    values ('8f5a6417-0000-4000-8000-0000000000c1', 'Bad Code', 'parking_conversion', 'u', 'x', 1, 2)$$,
  '23514', null, 'a non-kebab item code is rejected'
);
select throws_ok(
  $$insert into public.catalog_items (catalog_version_id, code, kind, unit, quantity_formula, price_low_cents, price_high_cents)
    values ('8f5a6417-0000-4000-8000-0000000000c1', 'parking', 'parking_conversion', 'hectare', 'x', 1, 2)$$,
  '22P02', null, 'an unknown catalog unit is rejected'
);

-- 5. Immutability triggers
select has_trigger('public', 'analysis_scenarios', 'analysis_scenarios_are_immutable', 'scenario update/delete trigger exists');
select has_trigger('public', 'analysis_scenarios', 'analysis_scenarios_cannot_be_truncated', 'scenario truncate trigger exists');
select has_trigger('public', 'catalog_versions', 'catalog_versions_are_immutable', 'catalog version update/delete trigger exists');
select has_trigger('public', 'catalog_versions', 'catalog_versions_cannot_be_truncated', 'catalog version truncate trigger exists');
select has_trigger('public', 'catalog_items', 'catalog_items_are_immutable', 'catalog item update/delete trigger exists');
select has_trigger('public', 'catalog_items', 'catalog_items_cannot_be_truncated', 'catalog item truncate trigger exists');
select has_trigger('public', 'catalog_versions', 'catalog_versions_no_backdating', 'backdating trigger exists');

select throws_ok($$update public.analysis_scenarios set is_default = is_default$$, '55000', 'immutable_curated_data', 'analysis_scenarios cannot be updated');
select throws_ok($$delete from public.analysis_scenarios$$, '55000', 'immutable_curated_data', 'analysis_scenarios cannot be deleted');
select throws_ok($$truncate table public.analysis_scenarios$$, '55000', 'immutable_curated_data', 'analysis_scenarios cannot be truncated');
select throws_ok($$update public.catalog_versions set source = source$$, '55000', 'immutable_curated_data', 'catalog_versions cannot be updated');
select throws_ok($$delete from public.catalog_versions$$, '55000', 'immutable_curated_data', 'catalog_versions cannot be deleted');
select throws_ok($$truncate table public.catalog_versions$$, '0A000', null, 'catalog_versions cannot be truncated (blocked by the catalog_items foreign key)');
select throws_ok($$truncate table public.catalog_versions cascade$$, '55000', 'immutable_curated_data', 'catalog_versions cannot be truncated with CASCADE either');
select throws_ok($$update public.catalog_items set code = code$$, '55000', 'immutable_curated_data', 'catalog_items cannot be updated');
select throws_ok($$delete from public.catalog_items$$, '55000', 'immutable_curated_data', 'catalog_items cannot be deleted');
select throws_ok($$truncate table public.catalog_items$$, '55000', 'immutable_curated_data', 'catalog_items cannot be truncated');

-- 6. Catalog backdating trigger
select throws_ok(
  $$insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'backdated', now() - interval '1 day', 's', current_date, false, null, repeat('a', 64))$$,
  '22023', 'catalog_backdated', 'effective_from in the past is rejected without the bootstrap setting'
);
select set_config('app.catalog_bootstrap', 'on', true);
select lives_ok(
  $$insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
    values ('93000000-0000-4000-8000-0000000000b0', '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'backdated', '2026-11-21T00:00:00Z', 's', current_date, false, null, repeat('a', 64))$$,
  'effective_from in the past is accepted with app.catalog_bootstrap = on'
);
select set_config('app.catalog_bootstrap', 'off', true);
select throws_ok(
  $$insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
    values (gen_random_uuid(), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'backdated-2', now() - interval '1 second', 's', current_date, false, null, repeat('a', 64))$$,
  '22023', 'catalog_backdated', 'the bootstrap setting set to off rejects backdating again'
);
select lives_ok(
  $$insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
    values ('93000000-0000-4000-8000-0000000000b1', '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'future', now() + interval '1 day', 's', current_date, false, null, repeat('a', 64))$$,
  'a future effective_from is accepted without bootstrap'
);

-- 7. sites.merge_overlap_threshold_m2
select has_column('public', 'sites', 'merge_overlap_threshold_m2', 'sites.merge_overlap_threshold_m2 exists');
select col_not_null('public', 'sites', 'merge_overlap_threshold_m2', 'merge_overlap_threshold_m2 is not null');
select is(
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'sites' and column_name = 'merge_overlap_threshold_m2'),
  '1.0',
  'merge_overlap_threshold_m2 defaults to 1.0'
);
select is((select merge_overlap_threshold_m2 from public.sites where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99'), 1.0::numeric, 'the pilot site carries threshold 1.0');
select throws_ok($$update public.sites set merge_overlap_threshold_m2 = 0 where slug = 'zocalo-puebla'$$, '23514', null, 'threshold 0 is rejected');
select throws_ok($$update public.sites set merge_overlap_threshold_m2 = -1 where slug = 'zocalo-puebla'$$, '23514', null, 'a negative threshold is rejected');
select lives_ok($$update public.sites set merge_overlap_threshold_m2 = 0.5 where slug = 'zocalo-puebla'$$, 'a positive threshold below 1 is accepted');
update public.sites set merge_overlap_threshold_m2 = 1.0 where slug = 'zocalo-puebla';

-- 8. Function grants
select is(has_function_privilege('anon', 'public.get_snapshot_analysis(text,text)', 'EXECUTE'), true, 'anon can execute get_snapshot_analysis');
select is(has_function_privilege('authenticated', 'public.get_snapshot_analysis(text,text)', 'EXECUTE'), true, 'authenticated can execute get_snapshot_analysis');
select is(has_function_privilege('public', 'public.get_snapshot_analysis(text,text)', 'EXECUTE'), false, 'public pseudo-role cannot execute get_snapshot_analysis');
select is_definer('public', 'get_snapshot_analysis', array['text', 'text'], 'get_snapshot_analysis is security definer');
select function_returns('public', 'get_snapshot_analysis', array['text', 'text'], 'jsonb', 'get_snapshot_analysis returns jsonb');
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc as p where p.oid = 'public.get_snapshot_analysis(text,text)'::regprocedure),
  'get_snapshot_analysis pins an empty search_path'
);

select is(has_function_privilege('anon', 'public.analysis_compute(uuid,uuid,uuid)', 'EXECUTE'), false, 'anon cannot execute analysis_compute');
select is(has_function_privilege('authenticated', 'public.analysis_compute(uuid,uuid,uuid)', 'EXECUTE'), false, 'authenticated cannot execute analysis_compute');
select is(has_function_privilege('public', 'public.analysis_compute(uuid,uuid,uuid)', 'EXECUTE'), false, 'public cannot execute analysis_compute');
select is(has_function_privilege('anon', 'public.cost_compute(uuid,uuid,timestamptz)', 'EXECUTE'), false, 'anon cannot execute cost_compute');
select is(has_function_privilege('authenticated', 'public.cost_compute(uuid,uuid,timestamptz)', 'EXECUTE'), false, 'authenticated cannot execute cost_compute');
select is(has_function_privilege('public', 'public.cost_compute(uuid,uuid,timestamptz)', 'EXECUTE'), false, 'public cannot execute cost_compute');
select is(has_function_privilege('anon', 'public.resolve_snapshot_ref(text)', 'EXECUTE'), false, 'anon cannot execute resolve_snapshot_ref');
select is(has_function_privilege('authenticated', 'public.resolve_snapshot_ref(text)', 'EXECUTE'), false, 'authenticated cannot execute resolve_snapshot_ref');
select is(has_function_privilege('public', 'public.resolve_snapshot_ref(text)', 'EXECUTE'), false, 'public cannot execute resolve_snapshot_ref');
select is(has_function_privilege('anon', 'public.analysis_engine_version()', 'EXECUTE'), false, 'anon cannot execute analysis_engine_version');
select is(has_function_privilege('authenticated', 'public.analysis_engine_version()', 'EXECUTE'), false, 'authenticated cannot execute analysis_engine_version');
select is(has_function_privilege('public', 'public.analysis_engine_version()', 'EXECUTE'), false, 'public cannot execute analysis_engine_version');
select is(has_function_privilege('anon', 'public.prevent_curated_data_change()', 'EXECUTE'), false, 'anon cannot execute the immutability trigger function');
select is(has_function_privilege('anon', 'public.catalog_version_effective_from_check()', 'EXECUTE'), false, 'anon cannot execute the backdating trigger function');
select is(public.analysis_engine_version(), 'ft-analysis@1', 'engine version is ft-analysis@1');

set local role anon;
select throws_ok($$select public.analysis_compute(null, null, null)$$, '42501', null, 'anon is denied analysis_compute (42501)');
select throws_ok($$select public.cost_compute(null, null, now())$$, '42501', null, 'anon is denied cost_compute (42501)');
select throws_ok($$select * from public.resolve_snapshot_ref('baseline:00000000-0000-4000-8000-000000000000')$$, '42501', null, 'anon is denied resolve_snapshot_ref (42501)');
reset role;

-- 9. Setup: users, branches, revisions, publications
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  ('93000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('93000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

insert into ctx (name, id, doc)
select 'site', '8f5a6417-5f6d-4f02-a50c-76d97167db99'::uuid, null;
insert into ctx (name, id, doc)
select 'baseline', id, null from public.site_baselines
where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active;

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);

-- b1: one canopy well inside the plaza (known answer)
insert into ctx (name, id, doc)
select 'b1', (r ->> 'branchId')::uuid, r
from (select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Canopy only', 'an-branch-key-1', repeat('a', 64)) as r) s;
insert into ctx (name, id, doc)
select 'r1', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'b1'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'b1'),
    'Canopy',
    '[{"id":"93000000-0000-4000-8000-000000000011","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'an-save-key-0001', repeat('1', 64)) as r
) s;
insert into ctx (name, id, doc)
select 'p1', (r ->> 'publicationId')::uuid, r
from (select public.publish_revision((select id from ctx where name = 'r1'), 'Canopy only', 'Known answer', 'an-pub-key-00001', repeat('2', 64)) as r) s;

-- b2: all modeled kinds, overlapping markets in one slot
insert into ctx (name, id, doc)
select 'b2', (r ->> 'branchId')::uuid, r
from (select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'All kinds', 'an-branch-key-2', repeat('b', 64)) as r) s;
insert into ctx (name, id, doc)
select 'r2', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'b2'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'b2'),
    'All kinds',
    '[{"id":"93000000-0000-4000-8000-000000000021","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}},
      {"id":"93000000-0000-4000-8000-000000000022","kind":"shade_tree","properties":{"label":"Tree","canopyDiameterM":6,"heightM":8},"geometry":{"type":"Point","coordinates":[-98.19775,19.0436]}},
      {"id":"93000000-0000-4000-8000-000000000023","kind":"temporary_market","properties":{"label":"Market A","stallCount":10,"moduleM2":4,"timeSlot":"Mañana"},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04375],[-98.19805,19.04375],[-98.19805,19.04385],[-98.19825,19.04385],[-98.19825,19.04375]]]}},
      {"id":"93000000-0000-4000-8000-000000000024","kind":"temporary_market","properties":{"label":"Market B","stallCount":20,"moduleM2":4,"timeSlot":"Mañana"},"geometry":{"type":"Polygon","coordinates":[[[-98.19815,19.04375],[-98.19795,19.04375],[-98.19795,19.04385],[-98.19815,19.04385],[-98.19815,19.04375]]]}},
      {"id":"93000000-0000-4000-8000-000000000025","kind":"temporary_market","properties":{"label":"Market C","stallCount":5,"moduleM2":2,"timeSlot":"Tarde"},"geometry":{"type":"Polygon","coordinates":[[[-98.19800,19.04345],[-98.19790,19.04345],[-98.19790,19.04355],[-98.19800,19.04355],[-98.19800,19.04345]]]}},
      {"id":"93000000-0000-4000-8000-000000000026","kind":"proposed_crossing","properties":{"label":"Crossing","widthM":4},"geometry":{"type":"LineString","coordinates":[[-98.19825,19.0436],[-98.19805,19.0436]]}}]'::jsonb,
    'an-save-key-0002', repeat('3', 64)) as r
) s;
insert into ctx (name, id, doc)
select 'p2', (r ->> 'publicationId')::uuid, r
from (select public.publish_revision((select id from ctx where name = 'r2'), 'All kinds', 'Every modeled kind', 'an-pub-key-00002', repeat('4', 64)) as r) s;

-- b3: canopy near the east tip: the 1600 shadow leaves the plaza, the 1000 shadow does not
insert into ctx (name, id, doc)
select 'b3', (r ->> 'branchId')::uuid, r
from (select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Edge canopy', 'an-branch-key-3', repeat('c', 64)) as r) s;
insert into ctx (name, id, doc)
select 'r3', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'b3'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'b3'),
    'Edge canopy',
    '[{"id":"93000000-0000-4000-8000-000000000031","kind":"shade_canopy","properties":{"label":"Edge canopy","heightM":6},"geometry":{"type":"Polygon","coordinates":[[[-98.19739,19.04357],[-98.19735,19.04357],[-98.19735,19.04363],[-98.19739,19.04363],[-98.19739,19.04357]]]}}]'::jsonb,
    'an-save-key-0003', repeat('5', 64)) as r
) s;

-- b4: untouched branch (initial empty revision), later soft-deleted
insert into ctx (name, id, doc)
select 'b4', (r ->> 'branchId')::uuid, r
from (select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Empty branch', 'an-branch-key-4', repeat('d', 64)) as r) s;

-- 10. Compute and store results under the real roles
insert into ctx (name, id, doc) select 'a_baseline', null, public.get_snapshot_analysis('baseline:' || (select id from ctx where name = 'baseline'));
insert into ctx (name, id, doc) select 'a_empty_rev', null, public.get_snapshot_analysis('revision:' || (select (doc ->> 'revisionId') from ctx where name = 'b4'));
insert into ctx (name, id, doc) select 'a_r1', null, public.get_snapshot_analysis('revision:' || (select id from ctx where name = 'r1'));
insert into ctx (name, id, doc) select 'a_r1_1600', null, public.get_snapshot_analysis('revision:' || (select id from ctx where name = 'r1'), 'equinox-1600');
insert into ctx (name, id, doc) select 'a_r2', null, public.get_snapshot_analysis('revision:' || (select id from ctx where name = 'r2'));
insert into ctx (name, id, doc) select 'a_r3_1000', null, public.get_snapshot_analysis('revision:' || (select id from ctx where name = 'r3'), 'equinox-1000');
insert into ctx (name, id, doc) select 'a_r3_1600', null, public.get_snapshot_analysis('revision:' || (select id from ctx where name = 'r3'), 'equinox-1600');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
insert into ctx (name, id, doc) select 'a_p1_anon', null, public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p1'));
insert into ctx (name, id, doc) select 'a_p2_anon', null, public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p2'));
insert into ctx (name, id, doc) select 'a_baseline_anon', null, public.get_snapshot_analysis('baseline:' || (select id from ctx where name = 'baseline'));
reset role;

-- Independent expectations, computed from the stored geometries.
insert into ctx (name, id, doc)
select 'expect', null, jsonb_build_object(
  'refM2', (select round(extensions.st_area(extensions.st_transform(boundary, 32614))::numeric, 2) from public.site_baselines where id = (select id from ctx where name = 'baseline')),
  'canopyR1', (select extensions.st_area(extensions.st_transform(geometry, 32614))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r1')),
  'canopyR2', (select extensions.st_area(extensions.st_transform(geometry, 32614))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r2') and kind = 'shade_canopy'),
  'treeDisc', (select extensions.st_area(extensions.st_buffer(extensions.st_transform(geometry, 32614), 3, 'quad_segs=8'))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r2') and kind = 'shade_tree'),
  'marketA', (select extensions.st_area(extensions.st_transform(geometry, 32614))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r2') and feature_id = '93000000-0000-4000-8000-000000000023'),
  'marketB', (select extensions.st_area(extensions.st_transform(geometry, 32614))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r2') and feature_id = '93000000-0000-4000-8000-000000000024'),
  'marketC', (select extensions.st_area(extensions.st_transform(geometry, 32614))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r2') and feature_id = '93000000-0000-4000-8000-000000000025'),
  'slotMorning', (select extensions.st_area(extensions.st_union(extensions.st_transform(geometry, 32614)))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r2') and properties ->> 'timeSlot' = 'Mañana'),
  'allMarkets', (select extensions.st_area(extensions.st_union(extensions.st_transform(geometry, 32614)))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r2') and kind = 'temporary_market'),
  'crossingLength', (select extensions.st_length(extensions.st_transform(geometry, 32614))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r2') and kind = 'proposed_crossing'),
  'edgeCanopy', (select extensions.st_area(extensions.st_transform(geometry, 32614))::numeric from public.revision_features where revision_id = (select id from ctx where name = 'r3'))
);

-- 11. Empty baseline ref
select is((select doc ->> 'refKind' from ctx where name = 'a_baseline'), 'baseline', 'baseline ref reports refKind baseline');
select is((select doc #>> '{analysis,engineVersion}' from ctx where name = 'a_baseline'), 'ft-analysis@1', 'analysis carries the engine version');
select is((select doc #>> '{analysis,referenceSurface}' from ctx where name = 'a_baseline'), 'boundary_fallback', 'pilot baseline uses the boundary fallback surface');
select ok(
  abs((select (doc #>> '{analysis,referenceM2}')::numeric from ctx where name = 'a_baseline') - 11355.31) < 0.01,
  'pilot reference area is about 11355.31 m2'
);
select is(
  (select (doc #>> '{analysis,referenceM2}')::numeric from ctx where name = 'a_baseline'),
  (select (doc ->> 'refM2')::numeric from ctx where name = 'expect'),
  'referenceM2 equals the metric-SRID area of the boundary'
);
select is((select (doc #>> '{analysis,shade,m2}')::numeric from ctx where name = 'a_baseline'), 0::numeric, 'empty baseline has shade.m2 0');
select is((select (doc #>> '{analysis,shade,pct}')::numeric from ctx where name = 'a_baseline'), 0::numeric, 'empty baseline has shade.pct 0');
select is((select (doc #>> '{analysis,shade,elementCount}')::int from ctx where name = 'a_baseline'), 0, 'empty baseline has no shade elements');
select is((select doc #> '{analysis,occupancy,slots}' from ctx where name = 'a_baseline'), '[]'::jsonb, 'empty baseline has no occupancy slots');
select is(
  (select (doc #>> '{analysis,occupancy,remainingM2}')::numeric from ctx where name = 'a_baseline'),
  (select (doc #>> '{analysis,referenceM2}')::numeric from ctx where name = 'a_baseline'),
  'empty baseline leaves the whole reference surface remaining'
);
select is((select (doc #>> '{analysis,occupancy,crossingLengthM}')::numeric from ctx where name = 'a_baseline'), 0::numeric, 'empty baseline has crossing length 0');
select is((select (doc #>> '{cost,totalLowCents}')::bigint from ctx where name = 'a_baseline'), 0::bigint, 'empty baseline cost low total is 0');
select is((select (doc #>> '{cost,totalHighCents}')::bigint from ctx where name = 'a_baseline'), 0::bigint, 'empty baseline cost high total is 0');
select is((select (doc #>> '{cost,partial}')::boolean from ctx where name = 'a_baseline'), false, 'empty baseline cost is not partial');
select is((select doc #> '{cost,lines}' from ctx where name = 'a_baseline'), '[]'::jsonb, 'empty baseline has no cost lines');
select is((select doc #>> '{inputs,baselineId}' from ctx where name = 'a_baseline'), (select id::text from ctx where name = 'baseline'), 'inputs echo the baseline id');
select is((select doc #>> '{inputs,scenarioSlug}' from ctx where name = 'a_baseline'), 'equinox-1000', 'null scenario slug resolves to the default scenario');
select is(
  (select doc -> 'analysis' from ctx where name = 'a_baseline_anon'),
  (select doc -> 'analysis' from ctx where name = 'a_baseline'),
  'anon and authenticated get identical baseline analysis'
);
select is((select doc #>> '{analysis,shade,coverageIncomplete}' from ctx where name = 'a_baseline'), 'true', 'a partial-coverage site flags coverageIncomplete');
select is((select doc #>> '{analysis,shade,assumptions}' from ctx where name = 'a_baseline') is not null, true, 'shade assumptions are always stated');
select is((select doc #>> '{analysis,occupancy,affectedParkingReason}' from ctx where name = 'a_baseline'), 'no_parking_inventory', 'affectedParkingReason is no_parking_inventory');
select is((select doc #> '{analysis,occupancy,affectedParking}' from ctx where name = 'a_baseline'), 'null'::jsonb, 'affectedParking is JSON null');

-- Empty (untouched) revision of a branch
select is((select doc ->> 'refKind' from ctx where name = 'a_empty_rev'), 'revision', 'revision ref reports refKind revision');
select is((select (doc #>> '{analysis,shade,m2}')::numeric from ctx where name = 'a_empty_rev'), 0::numeric, 'empty revision has shade.m2 0');
select is((select doc #> '{analysis,occupancy,slots}' from ctx where name = 'a_empty_rev'), '[]'::jsonb, 'empty revision has no slots');
select is((select (doc #>> '{cost,totalLowCents}')::bigint from ctx where name = 'a_empty_rev'), 0::bigint, 'empty revision cost low total is 0');
select is((select (doc #>> '{cost,totalHighCents}')::bigint from ctx where name = 'a_empty_rev'), 0::bigint, 'empty revision cost high total is 0');
select is((select (doc #>> '{cost,partial}')::boolean from ctx where name = 'a_empty_rev'), false, 'empty revision cost is not partial');
select is((select doc #> '{cost,unknownConcepts}' from ctx where name = 'a_empty_rev'), '[]'::jsonb, 'empty revision has no unknown concepts');

-- 12. Known answer: one canopy inside the plaza
select ok(
  abs((select (doc ->> 'canopyR1')::numeric from ctx where name = 'expect') - 326.05) < 0.5,
  'the canopy polygon measures about 326.05 m2 in EPSG:32614'
);
select ok(
  abs((select (doc #>> '{analysis,shade,m2}')::numeric from ctx where name = 'a_r1') - (select (doc ->> 'canopyR1')::numeric from ctx where name = 'expect')) <= 0.01,
  'shade.m2 equals the canopy area when the shadow stays inside the plaza'
);
select is((select (doc #>> '{analysis,shade,elementCount}')::int from ctx where name = 'a_r1'), 1, 'one shade element');
select ok(
  abs(
    (select (doc #>> '{analysis,shade,pct}')::numeric from ctx where name = 'a_r1')
    - (select (doc #>> '{analysis,shade,m2}')::numeric / (doc #>> '{analysis,referenceM2}')::numeric * 100 from ctx where name = 'a_r1')
  ) <= 0.01,
  'shade.pct = shade.m2 / referenceM2 x 100 (two-decimal rounding)'
);
select ok(
  (select (doc #>> '{analysis,shade,pct}')::numeric from ctx where name = 'a_r1') between 2.8 and 2.95,
  'canopy shade percentage is about 2.87 %'
);
select is(
  (select doc #>> '{scenario,slug}' from ctx where name = 'a_r1'), 'equinox-1000', 'default scenario is equinox-1000'
);
select is((select doc #>> '{scenario,timezone}' from ctx where name = 'a_r1'), 'America/Mexico_City', 'scenario reports its time zone');
select is((select doc #>> '{scenario,azimuthRad}' from ctx where name = 'a_r1'), '1.945190', 'scenario reports azimuth_rad as stored');
select is(
  (select doc #>> '{inputs,datasetChecksum}' from ctx where name = 'a_r1'),
  (select dataset_checksum from public.analysis_scenarios where slug = 'equinox-1000' and site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99'),
  'inputs carry the scenario dataset checksum'
);
select is(
  (select doc -> 'analysis' from ctx where name = 'a_p1_anon'),
  (select doc -> 'analysis' from ctx where name = 'a_r1'),
  'anon analysis of the publication equals the owner analysis of its revision'
);
select is((select doc ->> 'refKind' from ctx where name = 'a_p1_anon'), 'publication', 'publication ref reports refKind publication');
select is(
  (select doc -> 'cost' from ctx where name = 'a_p1_anon'),
  (select doc -> 'cost' from ctx where name = 'a_r1'),
  'anon cost of the publication equals the owner cost of its revision'
);

-- 13. Scenario pinning
select is((select doc #>> '{scenario,slug}' from ctx where name = 'a_r1_1600'), 'equinox-1600', 'an explicit slug selects that scenario');
select isnt(
  (select doc #>> '{scenario,azimuthRad}' from ctx where name = 'a_r1_1600'),
  (select doc #>> '{scenario,azimuthRad}' from ctx where name = 'a_r1'),
  'scenarios differ in azimuth'
);
select ok(
  abs((select (doc #>> '{analysis,shade,m2}')::numeric from ctx where name = 'a_r1_1600') - (select (doc #>> '{analysis,shade,m2}')::numeric from ctx where name = 'a_r1')) <= 0.01,
  'a fully interior canopy casts the same area under both scenarios'
);
select ok(
  abs((select (doc #>> '{analysis,shade,m2}')::numeric from ctx where name = 'a_r3_1000') - (select (doc ->> 'edgeCanopy')::numeric from ctx where name = 'expect')) <= 0.01,
  'edge canopy: the equinox-1000 shadow stays inside the plaza'
);
select ok(
  (select (doc #>> '{analysis,shade,m2}')::numeric from ctx where name = 'a_r3_1600') < (select (doc #>> '{analysis,shade,m2}')::numeric from ctx where name = 'a_r3_1000') - 1,
  'edge canopy: the equinox-1600 shadow is clipped by the boundary, so the same snapshot yields less shade'
);
select is(
  (select doc #>> '{inputs,scenarioSlug}' from ctx where name = 'a_r3_1600'), 'equinox-1600', 'inputs echo the pinned scenario slug'
);
select is(
  (select doc -> 'cost' from ctx where name = 'a_r3_1600'),
  (select doc -> 'cost' from ctx where name = 'a_r3_1000'),
  'the scenario does not change the cost block'
);

-- 14. All kinds: shade union, occupancy and crossing
select is((select (doc #>> '{analysis,shade,elementCount}')::int from ctx where name = 'a_r2'), 2, 'canopy plus tree are two shade elements');
select ok(
  abs(
    (select (doc #>> '{analysis,shade,m2}')::numeric from ctx where name = 'a_r2')
    - (select (doc ->> 'canopyR2')::numeric + (doc ->> 'treeDisc')::numeric from ctx where name = 'expect')
  ) <= 0.02,
  'shade.m2 = canopy area + 32-gon tree disc when the shadows are disjoint'
);
select is(
  (select jsonb_array_length(doc #> '{analysis,occupancy,slots}') from ctx where name = 'a_r2'),
  2,
  'three markets in two time slots yield two slot rows'
);
select is(
  (select array_agg(s ->> 'timeSlot' order by s ->> 'timeSlot') from ctx, jsonb_array_elements(doc #> '{analysis,occupancy,slots}') as s where name = 'a_r2'),
  array['Mañana', 'Tarde'],
  'slot rows are named by timeSlot'
);
select is(
  (select (s ->> 'stallCount')::int from ctx, jsonb_array_elements(doc #> '{analysis,occupancy,slots}') as s where name = 'a_r2' and s ->> 'timeSlot' = 'Mañana'),
  30,
  'stalls of the two Mañana markets are summed'
);
select is(
  (select (s ->> 'stallCount')::int from ctx, jsonb_array_elements(doc #> '{analysis,occupancy,slots}') as s where name = 'a_r2' and s ->> 'timeSlot' = 'Tarde'),
  5,
  'the Tarde slot keeps its own stall count'
);
select ok(
  abs(
    (select (s ->> 'areaM2')::numeric from ctx, jsonb_array_elements(doc #> '{analysis,occupancy,slots}') as s where name = 'a_r2' and s ->> 'timeSlot' = 'Mañana')
    - (select (doc ->> 'slotMorning')::numeric from ctx where name = 'expect')
  ) <= 0.01,
  'Mañana slot area is the union of its markets'
);
select ok(
  (select (s ->> 'areaM2')::numeric from ctx, jsonb_array_elements(doc #> '{analysis,occupancy,slots}') as s where name = 'a_r2' and s ->> 'timeSlot' = 'Mañana')
  < (select (doc ->> 'marketA')::numeric + (doc ->> 'marketB')::numeric - 50 from ctx where name = 'expect'),
  'overlapping markets are not double counted'
);
select ok(
  (select (s ->> 'areaM2')::numeric from ctx, jsonb_array_elements(doc #> '{analysis,occupancy,slots}') as s where name = 'a_r2' and s ->> 'timeSlot' = 'Mañana')
  > (select greatest((doc ->> 'marketA')::numeric, (doc ->> 'marketB')::numeric) from ctx where name = 'expect'),
  'the union is larger than either single market'
);
select ok(
  abs(
    (select (s ->> 'areaM2')::numeric from ctx, jsonb_array_elements(doc #> '{analysis,occupancy,slots}') as s where name = 'a_r2' and s ->> 'timeSlot' = 'Tarde')
    - (select (doc ->> 'marketC')::numeric from ctx where name = 'expect')
  ) <= 0.01,
  'Tarde slot area equals its single market'
);
select is(
  (select bool_and((s ->> 'fitByAreaPreliminary')::boolean) from ctx, jsonb_array_elements(doc #> '{analysis,occupancy,slots}') as s where name = 'a_r2'),
  true,
  'every slot marks fitByArea as preliminary'
);
select is(
  (select (s ->> 'fitByArea')::numeric from ctx, jsonb_array_elements(doc #> '{analysis,occupancy,slots}') as s where name = 'a_r2' and s ->> 'timeSlot' = 'Tarde'),
  floor((select (doc ->> 'marketC')::numeric / 2 from ctx where name = 'expect')),
  'fitByArea of a single market is floor(area / moduleM2)'
);
select ok(
  abs(
    (select (doc #>> '{analysis,occupancy,remainingM2}')::numeric from ctx where name = 'a_r2')
    - ((select (doc #>> '{analysis,referenceM2}')::numeric from ctx where name = 'a_r2') - (select (doc ->> 'allMarkets')::numeric from ctx where name = 'expect'))
  ) <= 0.01,
  'remainingM2 = referenceM2 - union of all markets'
);
select ok(
  (select (doc #>> '{analysis,occupancy,crossingLengthM}')::numeric from ctx where name = 'a_r2') > 0,
  'a proposed crossing yields a positive length'
);
select ok(
  abs(
    (select (doc #>> '{analysis,occupancy,crossingLengthM}')::numeric from ctx where name = 'a_r2')
    - (select (doc ->> 'crossingLength')::numeric from ctx where name = 'expect')
  ) <= 0.01,
  'crossingLengthM equals the metric length of the line'
);
select ok(
  (select (doc #>> '{analysis,occupancy,crossingLengthM}')::numeric from ctx where name = 'a_r2') between 20 and 22,
  'the 0.0002 degree crossing is about 21 m long'
);
select is((select doc #>> '{analysis,occupancy,affectedParkingReason}' from ctx where name = 'a_r2'), 'no_parking_inventory', 'parking reason holds for revisions too');
select is((select doc #> '{analysis,occupancy,affectedParking}' from ctx where name = 'a_r2'), 'null'::jsonb, 'affectedParking stays null for revisions');
select is(
  (select doc -> 'analysis' from ctx where name = 'a_p2_anon'),
  (select doc -> 'analysis' from ctx where name = 'a_r2'),
  'anon publication analysis equals the owner revision analysis (all kinds)'
);

-- 15. Cost with the pinned catalog v1
select is((select doc #>> '{cost,catalogVersionId}' from ctx where name = 'a_r2'), '8f5a6417-0000-4000-8000-0000000000c1', 'cost pins catalog v1');
select is((select doc #>> '{cost,currency}' from ctx where name = 'a_r2'), 'MXN', 'cost currency is MXN');
select is((select doc #>> '{cost,label}' from ctx where name = 'a_r2'), 'fully_illustrative', 'every priced line is an assumption: fully_illustrative');
select is((select (doc #>> '{cost,partial}')::boolean from ctx where name = 'a_r2'), false, 'v1 prices all four kinds: not partial');
select is((select doc #> '{cost,unknownConcepts}' from ctx where name = 'a_r2'), '[]'::jsonb, 'no unknown concepts under v1');
select is((select jsonb_array_length(doc #> '{cost,lines}') from ctx where name = 'a_r2'), 4, 'one cost line per kind (markets aggregated)');
select is(
  (select array_agg(l ->> 'concept' order by l ->> 'concept') from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2'),
  array['proposed_crossing', 'shade_canopy', 'shade_tree', 'temporary_market'],
  'cost lines cover the four kinds'
);
select is((select doc #>> '{cost,priceDate}' from ctx where name = 'a_r2'), '2026-11-22', 'priceDate comes from the catalog');
select is((select doc #>> '{cost,source}' from ctx where name = 'a_r2'), 'Illustrative evaluation prices, not a supplier quote', 'source comes from the catalog');
select ok((select doc #>> '{cost,rounding}' from ctx where name = 'a_r2') ilike '%half-up%', 'the rounding rule is stated');
select is(
  (select bool_and(l ->> 'status' = 'priced' and l ->> 'action' = 'add' and (l ->> 'isAssumption')::boolean and l ->> 'assumptionOwner' is not null and l ->> 'assumptionDate' is not null)
     from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2'),
  true,
  'every line is priced, action add, and carries its assumption owner and date'
);
select is(
  (select (l ->> 'quantity')::numeric from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2' and l ->> 'concept' = 'shade_tree'),
  1::numeric, 'tree quantity is 1 unit'
);
select is(
  (select (l ->> 'amountLowCents')::bigint from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2' and l ->> 'concept' = 'shade_tree'),
  450000::bigint, 'tree low amount is the unit price'
);
select is(
  (select (l ->> 'amountHighCents')::bigint from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2' and l ->> 'concept' = 'shade_tree'),
  1200000::bigint, 'tree high amount is the unit price'
);
select ok(
  abs(
    (select (l ->> 'quantity')::numeric from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2' and l ->> 'concept' = 'shade_canopy')
    - (select (doc ->> 'canopyR2')::numeric from ctx where name = 'expect')
  ) <= 0.01,
  'canopy quantity is the polygon area in m2'
);
select is(
  (select (l ->> 'quantity')::numeric from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2' and l ->> 'concept' = 'temporary_market'),
  35::numeric, 'market quantity sums stallCount across features and slots (10 + 20 + 5)'
);
select is(
  (select (l ->> 'amountLowCents')::bigint from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2' and l ->> 'concept' = 'temporary_market'),
  525000::bigint, 'market low amount = 35 x 15000'
);
select is(
  (select (l ->> 'amountHighCents')::bigint from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2' and l ->> 'concept' = 'temporary_market'),
  1400000::bigint, 'market high amount = 35 x 40000'
);
select ok(
  abs(
    (select (l ->> 'quantity')::numeric from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2' and l ->> 'concept' = 'proposed_crossing')
    - (select (doc ->> 'crossingLength')::numeric * 4 from ctx where name = 'expect')
  ) <= 0.01,
  'crossing quantity is length x widthM'
);
select is(
  (select bool_and((l ->> 'amountLowCents')::bigint = round((l ->> 'quantity')::numeric * (case l ->> 'concept' when 'shade_tree' then 450000 when 'shade_canopy' then 180000 when 'temporary_market' then 15000 else 90000 end)))
     from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2'),
  true,
  'each low amount is round(quantity x catalog low price)'
);
select is(
  (select bool_and((l ->> 'amountHighCents')::bigint = round((l ->> 'quantity')::numeric * (case l ->> 'concept' when 'shade_tree' then 1200000 when 'shade_canopy' then 350000 when 'temporary_market' then 40000 else 160000 end)))
     from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2'),
  true,
  'each high amount is round(quantity x catalog high price)'
);
select is(
  (select (doc #>> '{cost,totalLowCents}')::bigint from ctx where name = 'a_r2'),
  (select sum((l ->> 'amountLowCents')::bigint)::bigint from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2'),
  'totalLowCents is the sum of the rounded lines'
);
select is(
  (select (doc #>> '{cost,totalHighCents}')::bigint from ctx where name = 'a_r2'),
  (select sum((l ->> 'amountHighCents')::bigint)::bigint from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_r2'),
  'totalHighCents is the sum of the rounded lines'
);
select ok(
  (select (doc #>> '{cost,totalLowCents}')::bigint <= (doc #>> '{cost,totalHighCents}')::bigint from ctx where name = 'a_r2'),
  'low total never exceeds high total'
);
select is(
  (select (doc #>> '{cost,totalLowCents}')::bigint from ctx where name = 'a_p1_anon'),
  (select round(round((doc ->> 'canopyR1')::numeric, 2) * 180000)::bigint from ctx where name = 'expect'),
  'single-canopy total low is round(round(area, 2) x 180000)'
);
select is(
  (select (doc #>> '{cost,totalHighCents}')::bigint from ctx where name = 'a_p1_anon'),
  (select round(round((doc ->> 'canopyR1')::numeric, 2) * 350000)::bigint from ctx where name = 'expect'),
  'single-canopy total high is round(round(area, 2) x 350000)'
);

-- 16. Visibility matrix
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.get_snapshot_analysis('revision:' || (select id from ctx where name = 'r1'))$$,
  'P0002', 'snapshot_not_found', 'another user cannot analyze a private revision'
);
select lives_ok(
  $$select public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p1'))$$,
  'another authenticated user can analyze a visible publication'
);
select lives_ok(
  $$select public.get_snapshot_analysis('baseline:' || (select id from ctx where name = 'baseline'))$$,
  'any authenticated user can analyze a published-site baseline'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.get_snapshot_analysis('revision:' || (select id from ctx where name = 'r1'))$$,
  'P0002', 'snapshot_not_found', 'anon cannot analyze a revision ref'
);
select throws_ok(
  $$select public.get_snapshot_analysis('revision:' || (select id from ctx where name = 'r2'))$$,
  'P0002', 'snapshot_not_found', 'anon cannot analyze a revision ref even for a published revision'
);
select throws_ok(
  $$select public.get_snapshot_analysis('publication:00000000-0000-4000-8000-000000000000')$$,
  'P0002', 'snapshot_not_found', 'an unknown publication is snapshot_not_found'
);
select throws_ok(
  $$select public.get_snapshot_analysis('baseline:00000000-0000-4000-8000-000000000000')$$,
  'P0002', 'snapshot_not_found', 'an unknown baseline is snapshot_not_found'
);
select throws_ok(
  $$select public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'baseline'))$$,
  'P0002', 'snapshot_not_found', 'a baseline id under the publication prefix is snapshot_not_found'
);

-- malformed refs
select throws_ok($$select public.get_snapshot_analysis(null)$$, '22023', 'invalid_snapshot_ref', 'null ref is invalid_snapshot_ref');
select throws_ok($$select public.get_snapshot_analysis('')$$, '22023', 'invalid_snapshot_ref', 'empty ref is invalid_snapshot_ref');
select throws_ok($$select public.get_snapshot_analysis('garbage')$$, '22023', 'invalid_snapshot_ref', 'a ref without a colon is invalid_snapshot_ref');
select throws_ok($$select public.get_snapshot_analysis('publication:')$$, '22023', 'invalid_snapshot_ref', 'a ref without an id is invalid_snapshot_ref');
select throws_ok($$select public.get_snapshot_analysis('publication:not-a-uuid')$$, '22023', 'invalid_snapshot_ref', 'a non-uuid id is invalid_snapshot_ref');
select throws_ok($$select public.get_snapshot_analysis('branch:00000000-0000-4000-8000-000000000000')$$, '22023', 'invalid_snapshot_ref', 'an unknown prefix is invalid_snapshot_ref');
select throws_ok($$select public.get_snapshot_analysis('PUBLICATION:00000000-0000-4000-8000-000000000000')$$, '22023', 'invalid_snapshot_ref', 'the prefix is case sensitive');
select throws_ok($$select public.get_snapshot_analysis(':00000000-0000-4000-8000-000000000000')$$, '22023', 'invalid_snapshot_ref', 'an empty prefix is invalid_snapshot_ref');

-- scenario slug validation
select throws_ok(
  $$select public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p1'), 'no-such-scenario')$$,
  '22023', 'invalid_scenario', 'an unknown scenario slug is invalid_scenario'
);
select throws_ok(
  $$select public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p1'), '')$$,
  '22023', 'invalid_scenario', 'an empty scenario slug is invalid_scenario (it does not fall back to the default)'
);
select lives_ok(
  $$select public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p1'), 'equinox-1600')$$,
  'a known slug works for anon'
);

-- hidden publication
reset role;
update public.publications set moderation_state = 'hidden' where id = (select id from ctx where name = 'p1');
set local role anon;
select throws_ok(
  $$select public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p1'))$$,
  'P0002', 'snapshot_not_found', 'a hidden publication is snapshot_not_found for anon'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p1'))$$,
  'P0002', 'snapshot_not_found', 'a hidden publication is snapshot_not_found even for its author'
);
select lives_ok(
  $$select public.get_snapshot_analysis('revision:' || (select id from ctx where name = 'r1'))$$,
  'the author can still analyze the revision of a hidden publication through the revision ref'
);
reset role;
update public.publications set moderation_state = 'visible' where id = (select id from ctx where name = 'p1');

-- unpublished site
update public.sites set published = false where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99';
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.get_snapshot_analysis('baseline:' || (select id from ctx where name = 'baseline'))$$,
  'P0002', 'snapshot_not_found', 'a baseline of an unpublished site is snapshot_not_found'
);
select throws_ok(
  $$select public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p1'))$$,
  'P0002', 'snapshot_not_found', 'a visible publication on an unpublished site is snapshot_not_found'
);
reset role;
update public.sites set published = true where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99';

-- soft-deleted branch
update public.branches set is_deleted = true where id = (select id from ctx where name = 'b4');
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.get_snapshot_analysis('revision:' || (select (doc ->> 'revisionId') from ctx where name = 'b4'))$$,
  'P0002', 'snapshot_not_found', 'the owner cannot analyze a revision of a soft-deleted branch'
);
reset role;
update public.branches set is_deleted = false where id = (select id from ctx where name = 'b4');

-- 17. Partial catalog pinned by effective_from = now(): unpriced and unknown concepts
insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
values ('93000000-0000-4000-8000-0000000000c2', '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'MXN', 'v2-partial', now(), 'pgTAP partial catalog', '2026-11-23', true, 'pgTAP', repeat('e', 64));
insert into public.catalog_items (catalog_version_id, code, kind, unit, quantity_formula, price_low_cents, price_high_cents, is_assumption, assumption_owner, assumption_date)
values
  ('93000000-0000-4000-8000-0000000000c2', 'v2-tree', 'shade_tree', 'u', '1 per tree', 1000, 2500, true, 'pgTAP', '2026-11-23'),
  ('93000000-0000-4000-8000-0000000000c2', 'v2-canopy', 'shade_canopy', 'm2', 'polygon area in m2', null, null, false, null, null);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
insert into ctx (name, id, doc) select 'a_p2_v2', null, public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p2'));
insert into ctx (name, id, doc) select 'a_p1_v2', null, public.get_snapshot_analysis('publication:' || (select id from ctx where name = 'p1'));
reset role;

select is((select doc #>> '{cost,catalogVersionId}' from ctx where name = 'a_p2_v2'), '93000000-0000-4000-8000-0000000000c2', 'a revision created at the new effective_from pins the new catalog');
select is((select (doc #>> '{cost,partial}')::boolean from ctx where name = 'a_p2_v2'), true, 'missing and null-priced concepts make the cost partial');
select is(
  (select array_agg(c order by c) from ctx, jsonb_array_elements_text(doc #> '{cost,unknownConcepts}') as c where name = 'a_p2_v2'),
  array['proposed_crossing', 'shade_canopy', 'temporary_market'],
  'unknownConcepts lists the null-priced and the missing kinds'
);
select is(
  (select l ->> 'status' from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_p2_v2' and l ->> 'concept' = 'shade_tree'),
  'priced', 'the priced kind stays priced'
);
select is(
  (select (l ->> 'amountLowCents')::bigint from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_p2_v2' and l ->> 'concept' = 'shade_tree'),
  1000::bigint, 'tree low amount follows the new catalog'
);
select is(
  (select l ->> 'status' from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_p2_v2' and l ->> 'concept' = 'shade_canopy'),
  'unpriced', 'a null-priced item is unpriced'
);
select is(
  (select l -> 'amountLowCents' from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_p2_v2' and l ->> 'concept' = 'shade_canopy'),
  'null'::jsonb, 'an unpriced line has a null amount, never zero'
);
select is(
  (select l ->> 'code' from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_p2_v2' and l ->> 'concept' = 'shade_canopy'),
  'v2-canopy', 'a null-priced item keeps its catalog code'
);
select is(
  (select l ->> 'status' from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_p2_v2' and l ->> 'concept' = 'temporary_market'),
  'unpriced', 'a kind without a catalog item is unpriced'
);
select is(
  (select l -> 'code' from ctx, jsonb_array_elements(doc #> '{cost,lines}') as l where name = 'a_p2_v2' and l ->> 'concept' = 'temporary_market'),
  'null'::jsonb, 'a kind without a catalog item has a null code'
);
select is((select (doc #>> '{cost,totalLowCents}')::bigint from ctx where name = 'a_p2_v2'), 1000::bigint, 'the total only sums priced lines (low)');
select is((select (doc #>> '{cost,totalHighCents}')::bigint from ctx where name = 'a_p2_v2'), 2500::bigint, 'the total only sums priced lines (high)');
select is((select doc #>> '{cost,label}' from ctx where name = 'a_p2_v2'), 'fully_illustrative', 'the label considers priced lines only');
select is((select doc #>> '{cost,priceDate}' from ctx where name = 'a_p2_v2'), '2026-11-23', 'priceDate follows the pinned catalog');
select is(
  (select (doc #>> '{cost,partial}')::boolean from ctx where name = 'a_p1_v2'), true,
  'a canopy-only revision is partial under the catalog whose canopy item is unpriced'
);
select is(
  (select doc #> '{cost,unknownConcepts}' from ctx where name = 'a_p1_v2'), '["shade_canopy"]'::jsonb,
  'unknownConcepts lists exactly the unpriced canopy'
);
select is(
  (select (doc #>> '{cost,totalLowCents}')::bigint from ctx where name = 'a_p1_v2'), 0::bigint,
  'a fully unpriced revision totals 0 but is flagged partial'
);
select is(
  (select doc ->> 'refKind' from ctx where name = 'a_p1_v2'), 'publication', 'sanity: stored result is the publication result'
);

select * from finish();
rollback;
