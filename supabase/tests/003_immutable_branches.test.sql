begin;

select plan(19);

select has_table('public', 'revisions', 'revisions table exists');
select has_table('public', 'revision_features', 'revision_features table exists');
select has_table('public', 'publications', 'publications table exists');
select has_table('public', 'mutation_requests', 'idempotency ledger exists');

select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.revisions'::regclass), true, 'revisions has RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.revision_features'::regclass), true, 'revision features has RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.publications'::regclass), true, 'publications has RLS');
select is((select relrowsecurity from pg_catalog.pg_class where oid = 'public.mutation_requests'::regclass), true, 'idempotency ledger has RLS');

select is(
  has_function_privilege('anon', 'public.create_branch(uuid,text,text,text)', 'EXECUTE'),
  false,
  'anonymous visitors cannot create branches'
);
select is(
  has_function_privilege('authenticated', 'public.create_branch(uuid,text,text,text)', 'EXECUTE'),
  true,
  'authenticated participants can call branch creation'
);

insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.create_branch(
    '8f5a6417-5f6d-4f02-a50c-76d97167db99',
    'Shade alternative',
    'branch-key-0001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  'owner creates a private branch atomically'
);

select is((select count(*) from public.branches), 1::bigint, 'owner sees the created branch');
select is((select count(*) from public.revisions), 1::bigint, 'branch starts with one immutable revision');

select lives_ok(
  $$select public.create_branch(
    '8f5a6417-5f6d-4f02-a50c-76d97167db99',
    'Shade alternative',
    'branch-key-0001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  'same idempotency key and payload returns the prior result'
);
select is((select count(*) from public.branches), 1::bigint, 'idempotent replay does not add a branch');

select throws_ok(
  $$select public.create_branch(
    '8f5a6417-5f6d-4f02-a50c-76d97167db99',
    'Different title',
    'branch-key-0001',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )$$,
  'FT001',
  'idempotency_key_reused',
  'changed payload with the same key is rejected'
);

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.branches), 0::bigint, 'another participant cannot discover the branch');

reset role;

select throws_ok(
  $$update public.revisions set message = 'changed'$$,
  '55000',
  'immutable_revision',
  'historical revisions reject updates'
);

select throws_ok(
  $$insert into public.revision_features (revision_id, site_id, feature_id, kind, properties, geometry)
    select id, site_id, '40000000-0000-4000-8000-000000000001', 'shade_tree', '{}',
      extensions.st_setsrid(extensions.st_point(-100, 20), 4326)
    from public.revisions limit 1$$,
  '23514',
  'feature_outside_site',
  'database rejects feature geometry outside the site boundary'
);

select * from finish();
rollback;
