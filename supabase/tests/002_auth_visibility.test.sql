begin;

select plan(12);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'site_roles', 'site_roles table exists');
select has_table('public', 'branches', 'branches table exists');

select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.profiles'::regclass),
  true,
  'profiles has RLS enabled'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.site_roles'::regclass),
  true,
  'site_roles has RLS enabled'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.branches'::regclass),
  true,
  'branches has RLS enabled'
);

select is(
  has_function_privilege('anon', 'public.assign_site_role(uuid,uuid,public.site_role)', 'EXECUTE'),
  false,
  'anonymous users cannot assign site roles'
);
select is(
  has_function_privilege('service_role', 'public.assign_site_role(uuid,uuid,public.site_role)', 'EXECUTE'),
  true,
  'service role can call the operator assignment function'
);

insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

select is(
  (
    select count(*)
    from public.profiles
    where id in (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002'
    )
  ),
  2::bigint,
  'auth trigger creates private profiles'
);

insert into public.branches (id, site_id, baseline_id, owner_id, title)
values (
  '20000000-0000-4000-8000-000000000001',
  '8f5a6417-5f6d-4f02-a50c-76d97167db99',
  'c6548481-726d-453f-a70e-f56db772277d',
  '10000000-0000-4000-8000-000000000001',
  'Private shade draft'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is((select count(*) from public.branches), 1::bigint, 'owner can read their private branch');
select is((select count(*) from public.profiles), 1::bigint, 'participant can read only their own profile');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.branches), 0::bigint, 'another participant cannot discover a private branch');

select * from finish();
rollback;
