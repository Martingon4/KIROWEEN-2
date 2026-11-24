begin;

select plan(10);

select has_extension('postgis', 'PostGIS is installed');
select has_table('public', 'sites', 'sites table exists');
select has_table('public', 'site_baselines', 'site_baselines table exists');
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.sites'::regclass),
  true,
  'sites has RLS enabled'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.site_baselines'::regclass),
  true,
  'site_baselines has RLS enabled'
);
select has_function('public', 'list_public_sites', array[]::text[], 'public projection function exists');

set local role anon;

select is(
  (select count(*) from public.list_public_sites()),
  1::bigint,
  'anonymous visitors receive the published pilot through the projection'
);

select is(
  (select slug from public.list_public_sites()),
  'zocalo-puebla',
  'public projection contains the expected slug'
);

select throws_ok(
  'select * from public.sites',
  '42501',
  'permission denied for table sites',
  'anonymous visitors cannot query the source table directly'
);

select throws_ok(
  'select * from public.site_baselines',
  '42501',
  'permission denied for table site_baselines',
  'anonymous visitors cannot query baseline rows directly'
);

select * from finish();
rollback;
