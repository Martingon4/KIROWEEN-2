begin;

select plan(4);

insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values ('80000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

create temporary table ctx (branch_id uuid, head_id uuid);
grant all on ctx to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '80000000-0000-4000-8000-000000000001', true);

insert into ctx
select (b ->> 'branchId')::uuid, (b ->> 'revisionId')::uuid
from public.create_branch(
  '8f5a6417-5f6d-4f02-a50c-76d97167db99',
  'Hardening probe',
  'hardening-branch-01',
  repeat('d', 64)
) as b;

select throws_ok(
  $$select public.save_revision(
    (select branch_id from ctx), (select head_id from ctx), 'Untrimmed label',
    '[{"id":"81000000-0000-4000-8000-000000000001","kind":"shade_canopy",
       "properties":{"label":"  Canopy  ","heightM":4.5},
       "geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}}]'::jsonb,
    'hardening-save-01', repeat('e', 64))$$,
  'FT422',
  'invalid_feature_properties',
  'direct RPC calls cannot store an untrimmed label'
);

select throws_ok(
  $$select public.save_revision(
    (select branch_id from ctx), (select head_id from ctx), 'Collapsing polygon',
    '[{"id":"81000000-0000-4000-8000-000000000002","kind":"shade_canopy",
       "properties":{"label":"Tiny","heightM":4.5},
       "geometry":{"type":"Polygon","coordinates":[[[-98.19815,19.04365],[-98.1981501,19.04365],[-98.1981501,19.0436501],[-98.19815,19.0436501],[-98.19815,19.04365]]]}}]'::jsonb,
    'hardening-save-02', repeat('f', 64))$$,
  'FT422',
  'invalid_geometry',
  'a polygon that collapses when rounded to six decimals is invalid, not a server error'
);

select is(
  (select current_revision_id from public.branches where id = (select branch_id from ctx)),
  (select head_id from ctx),
  'rejected saves leave the branch head unchanged'
);

reset role;
update public.branches set is_deleted = true where id = (select branch_id from ctx);
set local role authenticated;
select set_config('request.jwt.claim.sub', '80000000-0000-4000-8000-000000000001', true);

select is(
  public.get_branch_head((select branch_id from ctx)),
  null,
  'a deleted branch head is not readable even by its owner'
);

select * from finish();
rollback;
