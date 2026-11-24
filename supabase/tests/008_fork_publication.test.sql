begin;

select plan(92);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- 1. Signature, security and grants
select has_function('public', 'fork_publication', array['uuid', 'text', 'text', 'text'], 'fork_publication(uuid,text,text,text) exists');
select function_returns('public', 'fork_publication', array['uuid', 'text', 'text', 'text'], 'jsonb', 'fork_publication returns jsonb');
select is_definer('public', 'fork_publication', array['uuid', 'text', 'text', 'text'], 'fork_publication is security definer');
select ok(
  coalesce((select p.proconfig @> array['search_path=""'] from pg_proc as p where p.oid = 'public.fork_publication(uuid,text,text,text)'::regprocedure), false),
  'fork_publication has search_path set to empty in proconfig'
);
select is(has_function_privilege('anon', 'public.fork_publication(uuid,text,text,text)', 'EXECUTE'), false, 'anon cannot execute fork_publication');
select is(has_function_privilege('public', 'public.fork_publication(uuid,text,text,text)', 'EXECUTE'), false, 'public cannot execute fork_publication');
select is(has_function_privilege('authenticated', 'public.fork_publication(uuid,text,text,text)', 'EXECUTE'), true, 'authenticated can execute fork_publication');
select has_column('public', 'branches', 'source_publication_id', 'branches.source_publication_id exists');
select is(
  (select c.is_nullable from information_schema.columns as c
    where c.table_schema = 'public' and c.table_name = 'branches' and c.column_name = 'source_publication_id'),
  'YES',
  'branches.source_publication_id is nullable'
);
select is(
  (select count(*) from pg_constraint
    where conrelid = 'public.branches'::regclass and contype = 'f'
      and confrelid = 'public.publications'::regclass),
  2::bigint,
  'branches has two foreign keys to publications (column and composite)'
);
select ok(
  (select bool_and(c.confdeltype = 'r') from pg_constraint as c
    where c.conrelid = 'public.branches'::regclass and c.contype = 'f'
      and c.confrelid = 'public.publications'::regclass),
  'every branches -> publications foreign key is ON DELETE RESTRICT'
);
select is(
  (select count(*) from pg_constraint
    where conrelid = 'public.branches'::regclass and contype = 'f'
      and conname = 'branches_source_publication_revision_fk'),
  1::bigint,
  'the composite (source_publication_id, source_revision_id) foreign key exists'
);
select is(
  has_column_privilege('authenticated', 'public.branches', 'source_publication_id', 'UPDATE'),
  false,
  'authenticated cannot update branches.source_publication_id'
);

-- Setup
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  ('92000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('92000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('92000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);

insert into ctx (name, id, doc)
select 'b1', (r ->> 'branchId')::uuid, r
from (
  select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Fork source', 'fork-src-branch-1', repeat('a', 64)) as r
) s;

insert into ctx (name, id, doc)
select 'r1', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'b1'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'b1'),
    'Add canopy and tree',
    '[{"id":"92000000-0000-4000-8000-000000000011","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}},
      {"id":"92000000-0000-4000-8000-000000000012","kind":"shade_tree","properties":{"label":"Tree","canopyDiameterM":6,"heightM":8},"geometry":{"type":"Point","coordinates":[-98.198151,19.043654]}}]'::jsonb,
    'fork-src-save-key-1',
    repeat('1', 64)
  ) as r
) s;

insert into ctx (name, id, doc)
select 'p1', (r ->> 'publicationId')::uuid, r
from (
  select public.publish_revision(
    (select id from ctx where name = 'r1'),
    'Fork source canopy', 'Shade for the plaza', 'fork-src-pub-key-1', repeat('2', 64)
  ) as r
) s;

-- A later private save on the source branch must not leak into the fork.
insert into ctx (name, id, doc)
select 'r2', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'b1'),
    (select id from ctx where name = 'r1'),
    'Private change',
    '[{"id":"92000000-0000-4000-8000-000000000013","kind":"shade_tree","properties":{"label":"Private tree","canopyDiameterM":5,"heightM":6},"geometry":{"type":"Point","coordinates":[-98.19815,19.04365]}}]'::jsonb,
    'fork-src-save-key-2',
    repeat('3', 64)
  ) as r
) s;

reset role;
insert into ctx (name, id, doc)
select 'before', null, jsonb_build_object(
  'revisions', (select count(*) from public.revisions where branch_id = (select id from ctx where name = 'b1')),
  'features_r1', (select count(*) from public.revision_features where revision_id = (select id from ctx where name = 'r1')),
  'features_r2', (select count(*) from public.revision_features where revision_id = (select id from ctx where name = 'r2')),
  'publications', (select count(*) from public.publications),
  'head', (select current_revision_id from public.branches where id = (select id from ctx where name = 'b1')),
  'branches', (select count(*) from public.branches)
);

-- 2. Fork by another user
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);

insert into ctx (name, id, doc)
select 'f1', (r ->> 'branchId')::uuid, r
from (
  select public.fork_publication(
    (select id from ctx where name = 'p1'), 'My alternative', 'fork-key-0001', repeat('c', 64)
  ) as r
) s;

select is(
  (select array_agg(k order by k) from jsonb_object_keys((select doc from ctx where name = 'f1')) as k),
  (select array_agg(k order by k) from unnest(array['branchId','revisionId','siteId','baselineId','baselineIsActive','title','sourcePublicationId','featureCount']) as k),
  'fork returns exactly the documented keys'
);
select is((select doc ->> 'title' from ctx where name = 'f1'), 'My alternative', 'fork returns the title');
select is((select (doc ->> 'featureCount')::int from ctx where name = 'f1'), 2, 'featureCount is 2 (published snapshot, not the later private save)');
select is((select (doc ->> 'sourcePublicationId')::uuid from ctx where name = 'f1'), (select id from ctx where name = 'p1'), 'sourcePublicationId matches the source');
select is((select (doc ->> 'baselineIsActive')::boolean from ctx where name = 'f1'), true, 'baselineIsActive is true for an active baseline');
select is((select (doc ->> 'siteId')::uuid from ctx where name = 'f1'), '8f5a6417-5f6d-4f02-a50c-76d97167db99'::uuid, 'siteId is the source site');

reset role;

-- Branch and revision rows
select is(
  (select owner_id from public.branches where id = (select id from ctx where name = 'f1')),
  '92000000-0000-4000-8000-000000000002'::uuid,
  'fork branch is owned by the forking user'
);
select is(
  (select source_publication_id from public.branches where id = (select id from ctx where name = 'f1')),
  (select id from ctx where name = 'p1'),
  'branch.source_publication_id is the publication'
);
select is(
  (select source_revision_id from public.branches where id = (select id from ctx where name = 'f1')),
  (select id from ctx where name = 'r1'),
  'branch.source_revision_id is the published revision (R1), not the later head (R2)'
);
select is(
  (select current_revision_id from public.branches where id = (select id from ctx where name = 'f1')),
  (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1'),
  'branch head is the new revision'
);
select is(
  (select title from public.branches where id = (select id from ctx where name = 'f1')),
  'My alternative',
  'branch title is stored'
);
select is(
  (select baseline_id from public.branches where id = (select id from ctx where name = 'f1')),
  (select baseline_id from public.revisions where id = (select id from ctx where name = 'r1')),
  'branch baseline is the source revision baseline'
);
select is(
  (select parent_revision_id from public.revisions where id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')),
  (select id from ctx where name = 'r1'),
  'first fork revision has the published revision as parent'
);
select is(
  (select author_id from public.revisions where id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')),
  '92000000-0000-4000-8000-000000000002'::uuid,
  'first fork revision author is the forking user'
);
select is(
  (select message from public.revisions where id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')),
  'Forked from publication',
  'first fork revision message is "Forked from publication"'
);
select is(
  (select merge_parent_revision_id from public.revisions where id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')),
  null::uuid,
  'first fork revision has no merge parent'
);
select is(
  (select baseline_id from public.revisions where id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')),
  (select baseline_id from public.revisions where id = (select id from ctx where name = 'r1')),
  'first fork revision baseline matches the source'
);

-- Exact copy of the snapshot
select is(
  (select count(*) from (
    select feature_id, kind, properties, extensions.st_asbinary(geometry) from public.revision_features where revision_id = (select id from ctx where name = 'r1')
    except
    select feature_id, kind, properties, extensions.st_asbinary(geometry) from public.revision_features where revision_id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')
  ) as d),
  0::bigint,
  'every source feature (id, kind, properties, WKB geometry) exists identically in the fork'
);
select is(
  (select count(*) from (
    select feature_id, kind, properties, extensions.st_asbinary(geometry) from public.revision_features where revision_id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')
    except
    select feature_id, kind, properties, extensions.st_asbinary(geometry) from public.revision_features where revision_id = (select id from ctx where name = 'r1')
  ) as d),
  0::bigint,
  'the fork has no feature that the source snapshot lacks'
);
select is(
  (select count(*) from public.revision_features where revision_id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')),
  2::bigint,
  'fork stores exactly 2 feature rows'
);
select ok(
  (select bool_and(extensions.st_equals(a.geometry, b.geometry))
    from public.revision_features as a
    join public.revision_features as b on a.feature_id = b.feature_id
    where a.revision_id = (select id from ctx where name = 'r1')
      and b.revision_id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')),
  'ST_Equals holds for every copied geometry'
);
select is(
  (select count(*) from public.revision_features
    where revision_id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1')
      and feature_id = '92000000-0000-4000-8000-000000000013'),
  0::bigint,
  'the later private feature of the source branch is not copied'
);

-- Source unchanged
select is((select count(*) from public.revisions where branch_id = (select id from ctx where name = 'b1')), (select (doc ->> 'revisions')::bigint from ctx where name = 'before'), 'source branch revision count unchanged');
select is((select count(*) from public.revision_features where revision_id = (select id from ctx where name = 'r1')), (select (doc ->> 'features_r1')::bigint from ctx where name = 'before'), 'source R1 feature count unchanged');
select is((select count(*) from public.revision_features where revision_id = (select id from ctx where name = 'r2')), (select (doc ->> 'features_r2')::bigint from ctx where name = 'before'), 'source R2 feature count unchanged');
select is((select count(*) from public.publications), (select (doc ->> 'publications')::bigint from ctx where name = 'before'), 'fork creates no publication');
select is((select current_revision_id from public.branches where id = (select id from ctx where name = 'b1')), (select (doc ->> 'head')::uuid from ctx where name = 'before'), 'source branch head unchanged');
select is((select count(*) from public.branches), (select (doc ->> 'branches')::bigint from ctx where name = 'before') + 1, 'exactly one branch was added');

-- 3. Branch head provenance and visibility
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);

select is(
  public.get_branch_head((select id from ctx where name = 'f1')) ->> 'sourcePublicationId',
  (select id::text from ctx where name = 'p1'),
  'get_branch_head exposes sourcePublicationId for the fork'
);
select is(
  (public.get_branch_head((select id from ctx where name = 'f1')) ->> 'sourceVisible')::boolean,
  true,
  'get_branch_head sourceVisible is true while the publication is visible'
);
select is(
  jsonb_array_length(public.get_branch_head((select id from ctx where name = 'f1')) -> 'features'),
  2,
  'get_branch_head returns the 2 forked features'
);
select is(
  public.get_public_publication((select id from ctx where name = 'p1')) -> 'revisionId',
  null::jsonb,
  'get_public_publication does not expose revisionId'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_public_publication((select id from ctx where name = 'p1'))) as k),
  (select array_agg(k order by k) from unnest(array['publicationId','label','summary','authorAlias','publishedAt','siteId','baselineId','scenario','features']) as k),
  'get_public_publication still exposes exactly the allowed keys'
);

-- Another user cannot see the fork
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.branches where id = (select id from ctx where name = 'f1')), 0::bigint, 'another user cannot read the fork through the branches table');
select is(public.get_branch_head((select id from ctx where name = 'f1')), null::jsonb, 'another user gets null from get_branch_head for the fork');

-- 4. Idempotency
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
select is(
  public.fork_publication((select id from ctx where name = 'p1'), 'My alternative', 'fork-key-0001', repeat('c', 64)),
  (select doc from ctx where name = 'f1'),
  'replay with same key and hash returns the identical json'
);
reset role;
select is((select count(*) from public.branches), (select (doc ->> 'branches')::bigint from ctx where name = 'before') + 1, 'replay creates no extra branch');
select is(
  (select count(*) from public.revisions where branch_id = (select id from ctx where name = 'f1')),
  1::bigint,
  'replay creates no extra revision'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), 'Different title', 'fork-key-0001', repeat('d', 64))$$,
  'FT001', 'idempotency_key_reused', 'same key with a different payload hash is FT001'
);

-- Same namespace as create_branch
select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Plain branch', 'shared-key-0001', repeat('e', 64));
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), 'Plain branch', 'shared-key-0001', repeat('f', 64))$$,
  'FT001', 'idempotency_key_reused', 'a key already used by create_branch is FT001 for fork_publication'
);
select is(
  public.fork_publication((select id from ctx where name = 'p1'), 'Shared', 'shared-key-0002', repeat('9', 64)) ->> 'title',
  'Shared',
  'a fresh key works after the namespace checks'
);
select throws_ok(
  $$select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Plain', 'shared-key-0002', repeat('8', 64))$$,
  'FT001', 'idempotency_key_reused', 'a key used by fork_publication is FT001 for create_branch'
);

-- 5. Validation (never a 500)
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), '', 'fork-val-0001', repeat('c', 64))$$,
  '22023', 'invalid_branch_request', 'empty title is 22023'
);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), '   ', 'fork-val-0002', repeat('c', 64))$$,
  '22023', 'invalid_branch_request', 'blank title is 22023'
);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), ' padded ', 'fork-val-0003', repeat('c', 64))$$,
  '22023', 'invalid_branch_request', 'padded title is 22023'
);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), null, 'fork-val-0004', repeat('c', 64))$$,
  '22023', 'invalid_branch_request', 'null title is 22023'
);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), repeat('x', 101), 'fork-val-0005', repeat('c', 64))$$,
  '22023', 'invalid_branch_request', '101-character title is 22023'
);
select throws_ok(
  $$select public.fork_publication(null, 'Title', 'fork-val-0006', repeat('c', 64))$$,
  '22023', 'invalid_branch_request', 'null publication id is 22023'
);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), 'Title', 'short', repeat('c', 64))$$,
  '22023', 'invalid_branch_request', 'idempotency key shorter than 8 characters is 22023'
);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), 'Title', 'fork-val-0007', 'XYZ')$$,
  '22023', 'invalid_branch_request', 'malformed payload hash is 22023'
);

-- 6. Authentication
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), 'Title', 'fork-noauth-01', repeat('c', 64))$$,
  '28000', 'authentication_required', 'no authenticated user is 28000'
);
set local role anon;
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), 'Title', 'fork-anon-0001', repeat('c', 64))$$,
  '42501', null, 'anon is denied execute (42501)'
);

-- 7. Fork of a fork, and fork of one's own publication
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);

insert into ctx (name, id, doc)
select 'p2', (r ->> 'publicationId')::uuid, r
from (
  select public.publish_revision(
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1'),
    'Fork published', 'Second generation', 'fork-pub-key-0001', repeat('4', 64)
  ) as r
) s;

select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
insert into ctx (name, id, doc)
select 'f2', (r ->> 'branchId')::uuid, r
from (
  select public.fork_publication((select id from ctx where name = 'p2'), 'Fork of a fork', 'fork-key-0002', repeat('5', 64)) as r
) s;
select is((select (doc ->> 'featureCount')::int from ctx where name = 'f2'), 2, 'fork of a fork copies the 2 features');

insert into ctx (name, id, doc)
select 'f3', (r ->> 'branchId')::uuid, r
from (
  select public.fork_publication((select id from ctx where name = 'p1'), 'Fork of my own', 'fork-key-0003', repeat('6', 64)) as r
) s;
select is((select (doc ->> 'featureCount')::int from ctx where name = 'f3'), 2, 'forking one''s own publication works');

reset role;
select is(
  (select source_publication_id from public.branches where id = (select id from ctx where name = 'f2')),
  (select id from ctx where name = 'p2'),
  'fork of a fork points to the second-generation publication'
);
select is(
  (select parent_revision_id from public.revisions where id = (select (doc ->> 'revisionId')::uuid from ctx where name = 'f2')),
  (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1'),
  'fork of a fork has the first fork revision as parent'
);
select is(
  (select owner_id from public.branches where id = (select id from ctx where name = 'f3')),
  '92000000-0000-4000-8000-000000000001'::uuid,
  'own fork belongs to the publisher'
);

-- 8. save_revision on the new head works
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'f1'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'f1'),
    'Edit the fork',
    '[{"id":"92000000-0000-4000-8000-000000000011","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'fork-edit-key-0001',
    repeat('7', 64)
  )$$,
  'save_revision on the forked head works'
);
reset role;
select is(
  (select count(*) from public.revision_features where revision_id = (select id from ctx where name = 'r1')),
  2::bigint,
  'editing the fork leaves the source snapshot intact'
);

-- 8b. Review round 2: constraints, index, js_trim and label validation
reset role;
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.publications'::regclass and conname = 'publications_id_revision_unique' and contype = 'u'),
  'unique constraint publications_id_revision_unique exists'
);
select isnt(to_regclass('public.branches_source_publication_idx'), null, 'index branches_source_publication_idx exists');
select is(
  (select p.provolatile from pg_proc as p where p.oid = 'public.js_trim(text)'::regprocedure),
  'i'::"char",
  'js_trim is immutable'
);
select is(has_function_privilege('authenticated', 'public.js_trim(text)', 'EXECUTE'), false, 'authenticated cannot execute js_trim');
select is(
  public.js_trim(chr(160) || chr(9) || 'x' || chr(65279) || chr(8232)),
  'x',
  'js_trim strips NBSP, tab, BOM and line separator from the edges'
);
select throws_ok(
  $$update public.branches
    set source_revision_id = (select id from ctx where name = 'r2')
    where id = (select id from ctx where name = 'f3')$$,
  '23503', null, 'composite FK rejects a source_publication_id/source_revision_id pair that does not match'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'f1'),
    (select current_revision_id from public.branches where id = (select id from ctx where name = 'f1')),
    'Bad props',
    '[{"id":"92000000-0000-4000-8000-000000000021","kind":"shade_canopy","properties":{"label":"\t","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'fork-trim-key-01',
    repeat('7', 64)
  )$$,
  'FT422', 'invalid_feature_properties', 'save_revision rejects a tab-only label'
);
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'f1'),
    (select current_revision_id from public.branches where id = (select id from ctx where name = 'f1')),
    'Bad props',
    '[{"id":"92000000-0000-4000-8000-000000000021","kind":"shade_canopy","properties":{"label":"\u00a0\u00a0","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'fork-trim-key-02',
    repeat('7', 64)
  )$$,
  'FT422', 'invalid_feature_properties', 'save_revision rejects an NBSP-only label'
);
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'f1'),
    (select current_revision_id from public.branches where id = (select id from ctx where name = 'f1')),
    'Bad props',
    '[{"id":"92000000-0000-4000-8000-000000000021","kind":"shade_canopy","properties":{"label":"\u00a0Sombra\u00a0","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'fork-trim-key-03',
    repeat('7', 64)
  )$$,
  'FT422', 'invalid_feature_properties', 'save_revision rejects an NBSP-padded label'
);
select throws_ok(
  $$select public.save_revision(
    (select id from ctx where name = 'f1'),
    (select current_revision_id from public.branches where id = (select id from ctx where name = 'f1')),
    'Bad props',
    '[{"id":"92000000-0000-4000-8000-000000000022","kind":"temporary_market","properties":{"label":"Market","stallCount":10,"moduleM2":4,"timeSlot":"\u00a0Mañana\u00a0"},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'fork-trim-key-04',
    repeat('7', 64)
  )$$,
  'FT422', 'invalid_feature_properties', 'save_revision rejects a timeSlot padded with NBSP'
);

reset role;

-- 9. Source branch soft-deleted: the publication outlives it
update public.branches set is_deleted = true where id = (select id from ctx where name = 'b1');
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
select is(
  public.fork_publication((select id from ctx where name = 'p1'), 'Fork after source delete', 'fork-key-0004', repeat('a', 64)) ->> 'featureCount',
  '2',
  'forking works when the source branch is soft-deleted'
);

-- 10. Inactive baseline
reset role;
update public.site_baselines set is_active = false where id = (select baseline_id from public.revisions where id = (select id from ctx where name = 'r1'));
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
select is(
  (public.fork_publication((select id from ctx where name = 'p1'), 'Fork on old baseline', 'fork-key-0005', repeat('b', 64)) ->> 'baselineIsActive')::boolean,
  false,
  'forking with an inactive baseline works and reports baselineIsActive=false'
);
reset role;
update public.site_baselines set is_active = true where id = (select baseline_id from public.revisions where id = (select id from ctx where name = 'r1'));

-- 11. Hidden publication and unpublished site
update public.publications set moderation_state = 'hidden' where id = (select id from ctx where name = 'p1');
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), 'Hidden fork', 'fork-key-0006', repeat('1', 64))$$,
  'P0002', 'publication_not_found', 'a hidden publication is publication_not_found'
);
select throws_ok(
  $$select public.fork_publication('92000000-0000-4000-8000-0000000000aa', 'Ghost fork', 'fork-key-0007', repeat('1', 64))$$,
  'P0002', 'publication_not_found', 'an unknown publication is publication_not_found'
);
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
select is(
  (public.get_branch_head((select id from ctx where name = 'f1')) ->> 'sourceVisible')::boolean,
  false,
  'get_branch_head sourceVisible is false once the publication is hidden'
);
select is(
  public.get_branch_head((select id from ctx where name = 'f1')) ->> 'sourcePublicationId',
  (select id::text from ctx where name = 'p1'),
  'get_branch_head still reports sourcePublicationId after hiding'
);

reset role;
update public.publications set moderation_state = 'visible' where id = (select id from ctx where name = 'p1');
update public.sites set published = false where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99';
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.fork_publication((select id from ctx where name = 'p1'), 'Unpublished site fork', 'fork-key-0008', repeat('2', 64))$$,
  'P0002', 'publication_not_found', 'a visible publication on an unpublished site is publication_not_found'
);
select is(public.get_public_publication((select id from ctx where name = 'p1')), null::jsonb, 'get_public_publication is null for an unpublished site');
select is(public.public_publication_exists((select id from ctx where name = 'p1')), false, 'public_publication_exists is false for an unpublished site');

set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Unpublished site branch', 'create-unpub-0001', repeat('3', 64))$$,
  'P0002', 'site_not_found', 'create_branch on an unpublished site is site_not_found'
);

reset role;
update public.sites set published = true where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99';
select * from finish();
rollback;
