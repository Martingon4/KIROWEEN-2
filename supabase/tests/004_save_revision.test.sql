begin;

select plan(29);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to authenticated;

-- 1. Execution privileges
select is(has_function_privilege('anon', 'public.save_revision(uuid,uuid,text,jsonb,text,text)', 'EXECUTE'), false, 'anon cannot execute save_revision');
select is(has_function_privilege('anon', 'public.get_branch_head(uuid)', 'EXECUTE'), false, 'anon cannot execute get_branch_head');
select is(has_function_privilege('authenticated', 'public.save_revision(uuid,uuid,text,jsonb,text,text)', 'EXECUTE'), true, 'authenticated can execute save_revision');
select is(has_function_privilege('authenticated', 'public.get_branch_head(uuid)', 'EXECUTE'), true, 'authenticated can execute get_branch_head');

insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('70000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);

-- Setup: branch owned by user 1; ctx 'branch' holds branch id and initial head.
insert into ctx (name, id, doc)
select 'branch', (r ->> 'branchId')::uuid, r
from (
  select public.create_branch(
    '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Save revision test', 'branch-key-0004', repeat('a', 64)
  ) as r
) s;

-- 2. Valid save with one canopy
insert into ctx (name, id, doc)
select 'save1', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'branch'),
    'Add canopy',
    '[{"id":"71000000-0000-4000-8000-000000000001","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'save-key-0001',
    repeat('b', 64)
  ) as r
) s;

select isnt((select id from ctx where name = 'save1'), (select (doc ->> 'revisionId')::uuid from ctx where name = 'branch'), 'save returns a new revision id');
select is((select (doc ->> 'parentRevisionId')::uuid from ctx where name = 'save1'), (select (doc ->> 'revisionId')::uuid from ctx where name = 'branch'), 'parentRevisionId is the initial head');
select is((select (doc ->> 'featureCount')::int from ctx where name = 'save1'), 1, 'featureCount is 1');
select is((select current_revision_id from public.branches where id = (select id from ctx where name = 'branch')), (select id from ctx where name = 'save1'), 'branch head advanced to the new revision');
select is(jsonb_array_length(public.get_branch_head((select id from ctx where name = 'branch')) -> 'features'), 1, 'get_branch_head returns 1 feature');
select is(public.get_branch_head((select id from ctx where name = 'branch')) -> 'features' -> 0 -> 'geometry' ->> 'type', 'Polygon', 'feature geometry is a Polygon');

-- 3. Replay
insert into ctx (name, id, doc)
select 'replay', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'branch'),
    'Add canopy',
    '[{"id":"71000000-0000-4000-8000-000000000001","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'save-key-0001',
    repeat('b', 64)
  ) as r
) s;

select is((select id from ctx where name = 'replay'), (select id from ctx where name = 'save1'), 'replay returns the same revision id');
select is((select count(*) from public.revisions where branch_id = (select id from ctx where name = 'branch')), 2::bigint, 'replay creates no extra revision');

-- 4. Same key, different hash
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'branch'),
    'Add canopy', '[]'::jsonb, 'save-key-0001', repeat('c', 64)
  )$$,
  'FT001', 'idempotency_key_reused', 'same key with another hash is rejected'
);

-- 5. Stale head
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'branch'),
    'Stale', '[]'::jsonb, 'save-key-0002', repeat('d', 64)
  )$$,
  'FT409', 'stale_head', 'outdated expected head is a conflict'
);

-- 6. Other participant
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select id from ctx where name = 'save1'),
    'Intruder', '[]'::jsonb, 'save-key-0003', repeat('e', 64)
  )$$,
  'P0002', 'branch_not_found', 'another participant cannot save into a foreign branch'
);
select is(public.get_branch_head((select id from ctx where name = 'branch')), null::jsonb, 'get_branch_head of a foreign branch is null');
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);

-- 7. Atomicity: second feature lies outside the site
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select id from ctx where name = 'save1'),
    'Outside', 
    '[{"id":"71000000-0000-4000-8000-000000000011","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}},
      {"id":"71000000-0000-4000-8000-000000000012","kind":"shade_tree","properties":{"label":"Tree","canopyDiameterM":6,"heightM":8},"geometry":{"type":"Point","coordinates":[-100,20]}}]'::jsonb,
    'save-key-0004', repeat('f', 64)
  )$$,
  '23514', 'feature_outside_site', 'feature outside the site is rejected'
);
select is((select count(*) from public.revisions where branch_id = (select id from ctx where name = 'branch')), 2::bigint, 'failed save leaves no new revision');
select is((select current_revision_id from public.branches where id = (select id from ctx where name = 'branch')), (select id from ctx where name = 'save1'), 'failed save leaves the head unchanged');

-- 8. Duplicate ids
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select id from ctx where name = 'save1'),
    'Duplicates',
    '[{"id":"71000000-0000-4000-8000-000000000021","kind":"shade_tree","properties":{"label":"Tree","canopyDiameterM":6,"heightM":8},"geometry":{"type":"Point","coordinates":[-98.19815,19.04365]}},
      {"id":"71000000-0000-4000-8000-000000000021","kind":"shade_tree","properties":{"label":"Tree","canopyDiameterM":6,"heightM":8},"geometry":{"type":"Point","coordinates":[-98.19815,19.04365]}}]'::jsonb,
    'save-key-0005', repeat('1', 64)
  )$$,
  'FT422', 'duplicate_feature_id', 'duplicate feature ids are rejected with FT422'
);

-- 9. Unsupported kind
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select id from ctx where name = 'save1'),
    'Parking',
    '[{"id":"71000000-0000-4000-8000-000000000031","kind":"parking_conversion","properties":{"label":"Parking"},"geometry":{"type":"Point","coordinates":[-98.19815,19.04365]}}]'::jsonb,
    'save-key-0006', repeat('2', 64)
  )$$,
  'FT422', 'kind_not_supported', 'parking_conversion is not supported'
);

-- 10. Properties
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select id from ctx where name = 'save1'),
    'Unknown property',
    '[{"id":"71000000-0000-4000-8000-000000000041","kind":"shade_tree","properties":{"label":"Tree","canopyDiameterM":6,"heightM":8,"color":"red"},"geometry":{"type":"Point","coordinates":[-98.19815,19.04365]}}]'::jsonb,
    'save-key-0007', repeat('3', 64)
  )$$,
  'FT422', 'invalid_feature_properties', 'unknown property is rejected'
);
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select id from ctx where name = 'save1'),
    'Out of range',
    '[{"id":"71000000-0000-4000-8000-000000000042","kind":"shade_canopy","properties":{"label":"Canopy","heightM":20},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'save-key-0008', repeat('4', 64)
  )$$,
  'FT422', 'invalid_feature_properties', 'out-of-range property is rejected'
);

-- 11. Geometry type mismatch
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select id from ctx where name = 'save1'),
    'Wrong geometry',
    '[{"id":"71000000-0000-4000-8000-000000000051","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Point","coordinates":[-98.19815,19.04365]}}]'::jsonb,
    'save-key-0009', repeat('5', 64)
  )$$,
  'FT422', 'invalid_geometry', 'Point for shade_canopy is rejected'
);

-- 12. Bowtie polygon
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select id from ctx where name = 'save1'),
    'Bowtie',
    '[{"id":"71000000-0000-4000-8000-000000000061","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04372],[-98.19805,19.04358],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'save-key-0010', repeat('6', 64)
  )$$,
  'FT422', 'invalid_geometry', 'self-intersecting polygon is rejected'
);

-- 13. Too many features
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'branch'),
    (select id from ctx where name = 'save1'),
    'Too many',
    (select jsonb_agg(jsonb_build_object(
      'id', gen_random_uuid(),
      'kind', 'shade_tree',
      'properties', jsonb_build_object('label', 'Tree', 'canopyDiameterM', 6, 'heightM', 8),
      'geometry', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(-98.19815, 19.04365))
    )) from generate_series(1, 201)),
    'save-key-0011', repeat('7', 64)
  )$$,
  'FT422', 'too_many_features', '201 features are rejected'
);

-- 14. Empty array is a valid empty snapshot
select lives_ok(
  $$insert into ctx (name, id, doc)
    select 'empty', (r ->> 'revisionId')::uuid, r
    from (
      select public.save_revision(
        (select id from ctx where name = 'branch'),
        (select id from ctx where name = 'save1'),
        'Empty snapshot', '[]'::jsonb, 'save-key-0012', repeat('8', 64)
      ) as r
    ) s$$,
  'empty feature array is a valid snapshot'
);
select is(public.get_branch_head((select id from ctx where name = 'branch')) -> 'features', '[]'::jsonb, 'empty snapshot has no features');

-- 15. create_branch key reuse
select throws_ok(
  $$select public.create_branch(
    '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Save revision test', 'branch-key-0004', repeat('9', 64)
  )$$,
  'FT001', 'idempotency_key_reused', 'create_branch with reused key and another hash raises FT001'
);

select * from finish();
rollback;
