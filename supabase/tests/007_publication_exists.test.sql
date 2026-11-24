begin;

select plan(14);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- 1. Signature and security properties
select has_function('public', 'public_publication_exists', array['uuid'], 'public_publication_exists(uuid) exists');
select function_returns('public', 'public_publication_exists', array['uuid'], 'boolean', 'public_publication_exists returns boolean');
select is_definer('public', 'public_publication_exists', array['uuid'], 'public_publication_exists is security definer');
select is(
  (select p.provolatile::text from pg_proc as p where p.oid = 'public.public_publication_exists(uuid)'::regprocedure),
  's',
  'public_publication_exists is stable'
);
select ok(
  coalesce((select p.proconfig @> array['search_path=""'] from pg_proc as p where p.oid = 'public.public_publication_exists(uuid)'::regprocedure), false),
  'public_publication_exists has search_path set to empty in proconfig'
);

-- 2. Privileges
select is(has_function_privilege('anon', 'public.public_publication_exists(uuid)', 'EXECUTE'), true, 'anon can execute public_publication_exists');
select is(has_function_privilege('authenticated', 'public.public_publication_exists(uuid)', 'EXECUTE'), true, 'authenticated can execute public_publication_exists');
select is(has_function_privilege('public', 'public.public_publication_exists(uuid)', 'EXECUTE'), false, 'public cannot execute public_publication_exists');

-- Setup: one visible publication
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);

insert into ctx (name, id, doc)
select 'b1', (r ->> 'branchId')::uuid, r
from (
  select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Exists test', 'exists-branch-key-1', repeat('a', 64)) as r
) s;

insert into ctx (name, id, doc)
select 'r1', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'b1'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'b1'),
    'Add canopy',
    '[{"id":"91000000-0000-4000-8000-000000000011","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'exists-save-key-1',
    repeat('1', 64)
  ) as r
) s;

insert into ctx (name, id, doc)
select 'p1', (r ->> 'publicationId')::uuid, r
from (
  select public.publish_revision(
    (select id from ctx where name = 'r1'),
    'Exists canopy', 'Shade for the plaza', 'exists-pub-key-1', repeat('2', 64)
  ) as r
) s;

-- 3. Visible publication
select is(
  public.public_publication_exists((select id from ctx where name = 'p1')),
  true,
  'authenticated: a visible publication exists'
);

set local role anon;

select is(
  public.public_publication_exists((select id from ctx where name = 'p1')),
  true,
  'anon: a visible publication exists'
);

-- 4. Missing and null ids
select is(
  public.public_publication_exists('91000000-0000-4000-8000-0000000000aa'),
  false,
  'a missing id returns false'
);
select is(
  public.public_publication_exists(null),
  false,
  'a null id returns false'
);

-- 5. Hidden publication (enum publication_moderation_state allows 'visible' and 'hidden')
reset role;
update public.publications set moderation_state = 'hidden' where id = (select id from ctx where name = 'p1');
set local role anon;

select is(
  public.public_publication_exists((select id from ctx where name = 'p1')),
  false,
  'anon: a hidden publication returns false'
);
select is(
  public.get_public_publication((select id from ctx where name = 'p1')),
  null::jsonb,
  'get_public_publication returns null for the same hidden id (consistent)'
);

reset role;
select * from finish();
rollback;
