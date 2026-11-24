begin;

select plan(33);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to authenticated;

-- 1. Privileges
select is(has_function_privilege('anon', 'public.publish_revision(uuid,text,text,text,text)', 'EXECUTE'), false, 'anon cannot execute publish_revision');
select is(has_function_privilege('authenticated', 'public.publish_revision(uuid,text,text,text,text)', 'EXECUTE'), true, 'authenticated can execute publish_revision');
select is(has_function_privilege('anon', 'public.get_public_publication(uuid)', 'EXECUTE'), true, 'anon can execute get_public_publication');
select is(has_function_privilege('authenticated', 'public.get_public_publication(uuid)', 'EXECUTE'), true, 'authenticated can execute get_public_publication');

insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  ('90000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('90000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$insert into public.publications (id, revision_id, branch_id, public_label, public_summary, public_author_alias, published_by)
    values (
      '90000000-0000-4000-8000-0000000000f1',
      '90000000-0000-4000-8000-0000000000f2',
      '90000000-0000-4000-8000-0000000000f3',
      'Direct', 'Direct insert', 'participant-x', '90000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null, 'authenticated cannot insert directly into publications'
);

-- Setup: two branches for user 1 (B1 gets content, B2 is soft-deleted later)
insert into ctx (name, id, doc)
select 'b1', (r ->> 'branchId')::uuid, r
from (
  select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Publication test 1', 'pub-branch-key-1', repeat('a', 64)) as r
) s;

insert into ctx (name, id, doc)
select 'b2', (r ->> 'branchId')::uuid, r
from (
  select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Publication test 2', 'pub-branch-key-2', repeat('b', 64)) as r
) s;

-- 2. Not found cases
-- (a) another participant's revision
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.publish_revision(
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'b1'),
    'Intruder', 'Not mine', 'pub-key-other-1', repeat('c', 64)
  )$$,
  'P0002', 'revision_not_found', 'publishing another participant''s revision is not found'
);
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

-- (b) nonexistent revision
select throws_ok(
  $$select public.publish_revision(
    '90000000-0000-4000-8000-0000000000aa', 'Ghost', 'Does not exist', 'pub-key-ghost-1', repeat('d', 64)
  )$$,
  'P0002', 'revision_not_found', 'publishing a nonexistent revision is not found'
);

-- (c) soft-deleted branch
reset role;
update public.branches set is_deleted = true where id = (select id from ctx where name = 'b2');
set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.publish_revision(
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'b2'),
    'Deleted', 'Branch is deleted', 'pub-key-deleted-1', repeat('e', 64)
  )$$,
  'P0002', 'revision_not_found', 'publishing a revision of a soft-deleted branch is not found'
);

-- 3. Empty initial revision
select throws_ok(
  $$select public.publish_revision(
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'b1'),
    'Empty', 'Nothing here', 'pub-key-empty-1', repeat('f', 64)
  )$$,
  'FT422', 'empty_revision', 'the empty initial revision cannot be published'
);

-- 4. Publish R1, then save a private R2
insert into ctx (name, id, doc)
select 'r1', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'b1'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'b1'),
    'Add canopy',
    '[{"id":"90000000-0000-4000-8000-000000000011","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'pub-save-key-1',
    repeat('1', 64)
  ) as r
) s;

insert into ctx (name, id, doc)
select 'p1', (r ->> 'publicationId')::uuid, r
from (
  select public.publish_revision(
    (select id from ctx where name = 'r1'),
    'Public canopy', 'Shade for the plaza', 'pub-key-p1-0001', repeat('2', 64)
  ) as r
) s;

select isnt((select id from ctx where name = 'p1'), null::uuid, 'publishing R1 returns a publicationId');

insert into ctx (name, id, doc)
select 'r2', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'b1'),
    (select id from ctx where name = 'r1'),
    'Private change',
    '[{"id":"90000000-0000-4000-8000-000000000012","kind":"shade_canopy","properties":{"label":"Canopy 2","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'pub-save-key-2',
    repeat('3', 64)
  ) as r
) s;

select is(
  jsonb_array_length(public.get_public_publication((select id from ctx where name = 'p1')) -> 'features'),
  1,
  'publication still has exactly 1 feature after a later private save'
);
select is(
  public.get_public_publication((select id from ctx where name = 'p1')) -> 'features' -> 0 -> 'properties' ->> 'label',
  'Canopy',
  'publication keeps the R1 feature, not the R2 one'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_public_publication((select id from ctx where name = 'p1'))) as k),
  (select array_agg(k order by k) from unnest(array['publicationId','label','summary','authorAlias','publishedAt','siteId','baselineId','scenario','features']) as k),
  'public publication exposes exactly the allowed keys'
);
select ok(
  public.get_public_publication((select id from ctx where name = 'p1')) ->> 'authorAlias' like 'participant-%',
  'authorAlias starts with participant-'
);

-- 5. Idempotency
select is(
  (public.publish_revision(
    (select id from ctx where name = 'r1'),
    'Public canopy', 'Shade for the plaza', 'pub-key-p1-0001', repeat('2', 64)
  ) ->> 'publicationId')::uuid,
  (select id from ctx where name = 'p1'),
  'replay with same key and hash returns the same publicationId'
);
select is(
  (select count(*) from public.publications where revision_id = (select id from ctx where name = 'r1')),
  1::bigint,
  'replay leaves a single publication row for the revision'
);
select throws_ok(
  $$select public.publish_revision(
    (select id from ctx where name = 'r1'),
    'Public canopy', 'Shade for the plaza', 'pub-key-p1-0001', repeat('4', 64)
  )$$,
  'FT001', 'idempotency_key_reused', 'same key with another hash is rejected'
);
select throws_ok(
  $$select public.publish_revision(
    (select id from ctx where name = 'r1'),
    'Public canopy again', 'Second attempt', 'pub-key-p1-0002', repeat('5', 64)
  )$$,
  'FT409', 'already_published', 'a different key on an already published revision is a conflict'
);

-- 6. Immutability (as postgres, which bypasses privileges so only the triggers are tested)
reset role;

select throws_ok(
  $$update public.publications set public_label = 'Changed' where id = (select id from ctx where name = 'p1')$$,
  '55000', 'immutable_publication', 'UPDATE of public_label is rejected'
);
select throws_ok(
  $$update public.publications set revision_id = (select id from ctx where name = 'r2') where id = (select id from ctx where name = 'p1')$$,
  '55000', 'immutable_publication', 'UPDATE of revision_id is rejected'
);
select throws_ok(
  $$delete from public.publications where id = (select id from ctx where name = 'p1')$$,
  '55000', 'immutable_publication', 'DELETE is rejected'
);
-- throws_ok runs the statement through EXECUTE inside a pgTAP-managed subtransaction,
-- so the TRUNCATE error is caught like any other.
-- Since branches.source_publication_id references publications, PostgreSQL rejects the
-- TRUNCATE with 0A000 (feature_not_supported) before the immutability trigger can fire
-- (55000). Either way the table cannot be truncated; the FK now fires first.
select throws_ok(
  $$truncate table public.publications$$,
  '0A000', null, 'TRUNCATE is rejected (FK from branches fires before the immutability trigger)'
);
select throws_ok(
  $$truncate table public.publications cascade$$,
  '55000', 'immutable_publication', 'TRUNCATE CASCADE still hits the immutability trigger'
);
select has_trigger('public', 'publications', 'publications_cannot_be_truncated', 'truncate trigger exists');
select lives_ok(
  $$update public.publications set moderation_state = 'hidden' where id = (select id from ctx where name = 'p1')$$,
  'moderation_state can be updated to hidden'
);
select is(
  public.get_public_publication((select id from ctx where name = 'p1')),
  null::jsonb,
  'a hidden publication returns null'
);
select is(
  public.get_public_publication(gen_random_uuid()),
  null::jsonb,
  'an unknown publication id returns null'
);

-- 7. Validation (rejections must not write mutation_requests)
insert into ctx (name, id, doc)
select 'before', null, jsonb_build_object('n', count(*))
from public.mutation_requests
where actor_id = '90000000-0000-4000-8000-000000000001' and operation = 'publish_revision';

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.publish_revision((select id from ctx where name = 'r2'), '  x  ', 'Summary', 'pub-key-val-0001', repeat('6', 64))$$,
  '22023', 'invalid_publication_request', 'untrimmed label is rejected'
);
select throws_ok(
  $$select public.publish_revision((select id from ctx where name = 'r2'), repeat('x', 101), 'Summary', 'pub-key-val-0002', repeat('6', 64))$$,
  '22023', 'invalid_publication_request', '101-character label is rejected'
);
select throws_ok(
  $$select public.publish_revision((select id from ctx where name = 'r2'), null, 'Summary', 'pub-key-val-0003', repeat('6', 64))$$,
  '22023', 'invalid_publication_request', 'null label is rejected'
);
select throws_ok(
  $$select public.publish_revision((select id from ctx where name = 'r2'), 'Label', repeat('s', 1001), 'pub-key-val-0004', repeat('6', 64))$$,
  '22023', 'invalid_publication_request', '1001-character summary is rejected'
);

reset role;
select is(
  (select count(*) from public.mutation_requests
    where actor_id = '90000000-0000-4000-8000-000000000001' and operation = 'publish_revision'),
  (select (doc ->> 'n')::bigint from ctx where name = 'before'),
  'validation rejections write no publish_revision mutation_requests rows'
);

-- 8. Review fix: unexpected unique violations are re-raised, not turned into FT409 with null detail
select matches(
  pg_get_functiondef('public.publish_revision(uuid,text,text,text,text)'::regprocedure),
  'if existing_id is null then\s+raise;\s+end if;',
  'publish_revision re-raises unexpected unique violations when no publication exists'
);

select * from finish();
rollback;
