begin;

select plan(292);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction). They run as the calling role.
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
create function public.t_doc(p text) returns jsonb language sql stable as $$ select doc from ctx where name = p $$;
create function public.t_uid(p text) returns text language sql immutable as
$$ select '95000000-0000-4000-8000-' || lpad(p, 12, '0') $$;
create function public.t_rect(x1 numeric, y1 numeric, x2 numeric, y2 numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(jsonb_build_array(
    jsonb_build_array(x1, y1), jsonb_build_array(x2, y1), jsonb_build_array(x2, y2),
    jsonb_build_array(x1, y2), jsonb_build_array(x1, y1))))
$$;
create function public.t_pt(x numeric, y numeric) returns jsonb language sql immutable as
$$ select jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(x, y)) $$;
create function public.t_can() returns jsonb language sql immutable as $$ select public.t_rect(-98.19825, 19.04358, -98.19805, 19.04372) $$;
create function public.t_mkt() returns jsonb language sql immutable as $$ select public.t_rect(-98.19820, 19.04360, -98.19800, 19.04370) $$;
create function public.t_mkt_still_overlapping() returns jsonb language sql immutable as $$ select public.t_rect(-98.19822, 19.04360, -98.19802, 19.04370) $$;
create function public.t_mkt_moved() returns jsonb language sql immutable as $$ select public.t_rect(-98.19840, 19.04368, -98.19828, 19.04378) $$;
create function public.t_zone() returns jsonb language sql immutable as $$ select public.t_rect(-98.19800, 19.04345, -98.19790, 19.04355) $$;
create function public.t_zone_inner() returns jsonb language sql immutable as $$ select public.t_rect(-98.19798, 19.04346, -98.19792, 19.04354) $$;
create function public.t_east() returns jsonb language sql immutable as $$ select public.t_rect(-98.19739, 19.04357, -98.19735, 19.04363) $$;
create function public.t_p1() returns jsonb language sql immutable as $$ select public.t_pt(-98.19775, 19.0436) $$;
create function public.t_p2() returns jsonb language sql immutable as $$ select public.t_pt(-98.19770, 19.0436) $$;
create function public.t_canopy(p_id text, p_geom jsonb, p_height numeric default 4.5, p_label text default 'Cubierta')
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'kind', 'shade_canopy',
    'properties', jsonb_build_object('label', p_label, 'heightM', p_height), 'geometry', p_geom)
$$;
create function public.t_market(p_id text, p_geom jsonb, p_slot text default 'Sábados 8-14', p_label text default 'Puestos')
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'kind', 'temporary_market',
    'properties', jsonb_build_object('label', p_label, 'stallCount', 8, 'moduleM2', 6, 'timeSlot', p_slot),
    'geometry', p_geom)
$$;
create function public.t_tree(p_id text, p_geom jsonb, p_label text default 'Arbol')
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'kind', 'shade_tree',
    'properties', jsonb_build_object('label', p_label, 'canopyDiameterM', 6, 'heightM', 8), 'geometry', p_geom)
$$;
create function public.t_branch(p_title text) returns uuid language sql as $$
  select (public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', p_title, gen_random_uuid()::text, repeat('a', 64)) ->> 'branchId')::uuid
$$;
create function public.t_head(p_branch uuid) returns uuid language sql as
$$ select (public.get_branch_head(p_branch) ->> 'revisionId')::uuid $$;
create function public.t_save(p_branch uuid, p_features jsonb) returns uuid language sql as $$
  select (public.save_revision(p_branch, public.t_head(p_branch), 'Save', p_features, gen_random_uuid()::text, repeat('b', 64)) ->> 'revisionId')::uuid
$$;
create function public.t_pub(p_rev uuid) returns uuid language sql as $$
  select (public.publish_revision(p_rev, 'Etiqueta', 'Resumen', gen_random_uuid()::text, repeat('c', 64)) ->> 'publicationId')::uuid
$$;
create function public.t_fork(p_pub uuid) returns jsonb language sql as
$$ select public.fork_publication(p_pub, 'Fork', gen_random_uuid()::text, repeat('d', 64)) $$;
create function public.t_prev(p_branch uuid, p_pub uuid, p_res jsonb default '[]'::jsonb) returns jsonb language sql as
$$ select public.merge_preview(p_branch, p_pub, p_res) $$;
create function public.t_merge(p_branch uuid, p_pub uuid, p_res jsonb default '[]'::jsonb) returns jsonb language sql as $$
  select public.merge_commit(p_branch, p_pub, public.t_head(p_branch), 'Merge', p_res, gen_random_uuid()::text, repeat('e', 64))
$$;
create function public.t_rm(p_conflict text, p_feature text) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('conflictId', p_conflict, 'action', 'remove', 'featureId', p_feature))
$$;
create function public.t_act(p_conflict text, p_action text) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('conflictId', p_conflict, 'action', p_action))
$$;
create function public.t_redraw(p_conflict text, p_feature jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('conflictId', p_conflict, 'action', 'redraw', 'feature', p_feature))
$$;
create function public.t_nfeat(p_branch uuid) returns integer language sql as
$$ select jsonb_array_length(public.get_branch_head(p_branch) -> 'features') $$;

-- 1. Grants and security shape
select is(has_function_privilege('authenticated', 'public.merge_preview(uuid,uuid,jsonb)', 'EXECUTE'), true, 'authenticated can execute merge_preview');
select is(has_function_privilege('anon', 'public.merge_preview(uuid,uuid,jsonb)', 'EXECUTE'), false, 'anon cannot execute merge_preview');
select is(has_function_privilege('public', 'public.merge_preview(uuid,uuid,jsonb)', 'EXECUTE'), false, 'public cannot execute merge_preview');
select is(has_function_privilege('authenticated', 'public.merge_commit(uuid,uuid,uuid,text,jsonb,text,text)', 'EXECUTE'), true, 'authenticated can execute merge_commit');
select is(has_function_privilege('anon', 'public.merge_commit(uuid,uuid,uuid,text,jsonb,text,text)', 'EXECUTE'), false, 'anon cannot execute merge_commit');
select is(has_function_privilege('public', 'public.merge_commit(uuid,uuid,uuid,text,jsonb,text,text)', 'EXECUTE'), false, 'public cannot execute merge_commit');
select is_definer('public', 'merge_preview', array['uuid', 'uuid', 'jsonb'], 'merge_preview is security definer');
select is_definer('public', 'merge_commit', array['uuid', 'uuid', 'uuid', 'text', 'jsonb', 'text', 'text'], 'merge_commit is security definer');
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc as p where p.oid = 'public.merge_preview(uuid,uuid,jsonb)'::regprocedure),
  'merge_preview pins an empty search_path'
);
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc as p where p.oid = 'public.merge_commit(uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure),
  'merge_commit pins an empty search_path'
);
select is(
  (select count(*)::int from pg_proc as p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('merge_compute', 'merge_context', 'merge_find_ancestor', 'normalize_feature_input', 'merge_same_feature', 'merge_exclusive_pair', 'merge_preview', 'merge_commit')
     and coalesce(p.proconfig @> array['search_path=""'], false)),
  8,
  'all eight merge functions pin an empty search_path'
);

select is(has_function_privilege('anon', 'public.merge_compute(uuid,uuid,uuid,uuid,extensions.geometry,jsonb,boolean)', 'EXECUTE'), false, 'anon cannot execute merge_compute');
select is(has_function_privilege('authenticated', 'public.merge_compute(uuid,uuid,uuid,uuid,extensions.geometry,jsonb,boolean)', 'EXECUTE'), false, 'authenticated cannot execute merge_compute');
select is(has_function_privilege('public', 'public.merge_compute(uuid,uuid,uuid,uuid,extensions.geometry,jsonb,boolean)', 'EXECUTE'), false, 'public cannot execute merge_compute');
select is(has_function_privilege('anon', 'public.merge_context(uuid,uuid,boolean)', 'EXECUTE'), false, 'anon cannot execute merge_context');
select is(has_function_privilege('authenticated', 'public.merge_context(uuid,uuid,boolean)', 'EXECUTE'), false, 'authenticated cannot execute merge_context');
select is(has_function_privilege('public', 'public.merge_context(uuid,uuid,boolean)', 'EXECUTE'), false, 'public cannot execute merge_context');
select is(has_function_privilege('anon', 'public.merge_find_ancestor(uuid,uuid)', 'EXECUTE'), false, 'anon cannot execute merge_find_ancestor');
select is(has_function_privilege('authenticated', 'public.merge_find_ancestor(uuid,uuid)', 'EXECUTE'), false, 'authenticated cannot execute merge_find_ancestor');
select is(has_function_privilege('public', 'public.merge_find_ancestor(uuid,uuid)', 'EXECUTE'), false, 'public cannot execute merge_find_ancestor');
select is(has_function_privilege('anon', 'public.normalize_feature_input(jsonb,extensions.geometry)', 'EXECUTE'), false, 'anon cannot execute normalize_feature_input');
select is(has_function_privilege('authenticated', 'public.normalize_feature_input(jsonb,extensions.geometry)', 'EXECUTE'), false, 'authenticated cannot execute normalize_feature_input');
select is(has_function_privilege('public', 'public.normalize_feature_input(jsonb,extensions.geometry)', 'EXECUTE'), false, 'public cannot execute normalize_feature_input');
select is(has_function_privilege('anon', 'public.merge_same_feature(public.intervention_kind,jsonb,extensions.geometry,public.intervention_kind,jsonb,extensions.geometry)', 'EXECUTE'), false, 'anon cannot execute merge_same_feature');
select is(has_function_privilege('authenticated', 'public.merge_same_feature(public.intervention_kind,jsonb,extensions.geometry,public.intervention_kind,jsonb,extensions.geometry)', 'EXECUTE'), false, 'authenticated cannot execute merge_same_feature');
select is(has_function_privilege('anon', 'public.merge_exclusive_pair(public.intervention_kind,jsonb,public.intervention_kind,jsonb)', 'EXECUTE'), false, 'anon cannot execute merge_exclusive_pair');
select is(has_function_privilege('authenticated', 'public.merge_exclusive_pair(public.intervention_kind,jsonb,public.intervention_kind,jsonb)', 'EXECUTE'), false, 'authenticated cannot execute merge_exclusive_pair');

-- revision_merge_decisions
select is((select c.relrowsecurity from pg_class as c where c.oid = 'public.revision_merge_decisions'::regclass), true, 'revision_merge_decisions has RLS enabled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'revision_merge_decisions'), 1, 'revision_merge_decisions has exactly one policy');
select is(has_any_column_privilege('anon', 'public.revision_merge_decisions', 'SELECT'), false, 'anon has no column select on revision_merge_decisions');
select is(has_table_privilege('anon', 'public.revision_merge_decisions', 'INSERT'), false, 'anon cannot insert revision_merge_decisions');
select is(has_table_privilege('authenticated', 'public.revision_merge_decisions', 'INSERT'), false, 'authenticated cannot insert revision_merge_decisions');
select is(has_table_privilege('authenticated', 'public.revision_merge_decisions', 'UPDATE'), false, 'authenticated cannot update revision_merge_decisions');
select is(has_table_privilege('authenticated', 'public.revision_merge_decisions', 'DELETE'), false, 'authenticated cannot delete revision_merge_decisions');
select is(has_column_privilege('authenticated', 'public.revision_merge_decisions', 'ancestor_revision_id', 'SELECT'), false, 'authenticated cannot select ancestor_revision_id');
select is(has_column_privilege('authenticated', 'public.revision_merge_decisions', 'source_revision_id', 'SELECT'), false, 'authenticated cannot select source_revision_id');
select is(has_column_privilege('authenticated', 'public.revision_merge_decisions', 'source_publication_id', 'SELECT'), true, 'authenticated can select source_publication_id');
select is(has_column_privilege('authenticated', 'public.revision_merge_decisions', 'decisions', 'SELECT'), true, 'authenticated can select decisions');
select has_trigger('public', 'revision_merge_decisions', 'revision_merge_decisions_are_immutable', 'immutable trigger exists');
select has_trigger('public', 'revision_merge_decisions', 'revision_merge_decisions_cannot_be_truncated', 'truncate trigger exists');

-- 2. Pure helpers (as postgres)
select is(public.merge_same_feature(null, null, null, null, null, null), true, 'merge_same_feature: both absent is the same');
select is(public.merge_same_feature('shade_tree', '{"a":1}', extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326), null, null, null), false, 'merge_same_feature: present vs absent differs');
select is(public.merge_same_feature(null, null, null, 'shade_tree', '{"a":1}', extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326)), false, 'merge_same_feature: absent vs present differs');
select is(
  public.merge_same_feature('shade_tree', '{"a":1}', extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326), 'shade_tree', '{"a":1}', extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326)),
  true, 'merge_same_feature: identical features are the same');
select is(
  public.merge_same_feature('shade_tree', '{"a":1}', extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326), 'shade_tree', '{"a":2}', extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326)),
  false, 'merge_same_feature: different properties differ');
select is(
  public.merge_same_feature('shade_tree', '{"a":1}', extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326), 'shade_tree', '{"a":1}', extensions.st_setsrid(extensions.st_makepoint(1, 2), 4326)),
  false, 'merge_same_feature: different geometry differs');
select is(
  public.merge_same_feature('shade_tree', '{"a":1}', extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326), 'shade_canopy', '{"a":1}', extensions.st_setsrid(extensions.st_makepoint(1, 1), 4326)),
  false, 'merge_same_feature: different kind differs');
select is(
  public.merge_same_feature(
    'shade_canopy', '{}',
    extensions.st_setsrid(extensions.st_geomfromtext('POLYGON((0 0,2 0,2 2,0 2,0 0))'), 4326),
    'shade_canopy', '{}',
    extensions.st_setsrid(extensions.st_geomfromtext('POLYGON((2 2,0 2,0 0,2 0,2 2))'), 4326)),
  false, 'merge_same_feature: equality is exact (EWKB), so a rotated ring is a change (migration 20261123070000)');

select is(public.merge_exclusive_pair('shade_canopy', '{}', 'shade_canopy', '{}'), true, 'exclusive: canopy/canopy');
select is(public.merge_exclusive_pair('shade_canopy', '{}', 'temporary_market', '{"timeSlot":"a"}'), true, 'exclusive: canopy/market');
select is(public.merge_exclusive_pair('temporary_market', '{"timeSlot":"a"}', 'shade_canopy', '{}'), true, 'exclusive: market/canopy');
select is(public.merge_exclusive_pair('temporary_market', '{"timeSlot":"a"}', 'temporary_market', '{"timeSlot":"a"}'), true, 'exclusive: market/market same slot');
select is(public.merge_exclusive_pair('temporary_market', '{"timeSlot":"a"}', 'temporary_market', '{"timeSlot":"b"}'), false, 'exclusive: market/market different slot is not exclusive');
select is(public.merge_exclusive_pair('shade_tree', '{}', 'shade_canopy', '{}'), false, 'exclusive: tree/canopy is not exclusive');
select is(public.merge_exclusive_pair('shade_tree', '{}', 'temporary_market', '{"timeSlot":"a"}'), false, 'exclusive: tree/market is not exclusive');
select is(public.merge_exclusive_pair('proposed_crossing', '{}', 'temporary_market', '{"timeSlot":"a"}'), false, 'exclusive: crossing/market is not exclusive');
select is(public.merge_exclusive_pair('shade_tree', '{}', 'shade_tree', '{}'), false, 'exclusive: tree/tree is not exclusive');

-- 3. Setup: three users
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  ('95000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('95000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('95000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

set local role authenticated;

-- User B (…02) publishes the source revisions.
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);

insert into ctx select 'bB', public.t_branch('Market B'), null;
insert into ctx select 'rB', public.t_save(public.t_id('bB'), jsonb_build_array(public.t_market(public.t_uid('b1'), public.t_mkt()))), null;
insert into ctx select 'pB', public.t_pub(public.t_id('rB')), null;

insert into ctx select 'bT', public.t_branch('Tree T'), null;
insert into ctx select 'rT', public.t_save(public.t_id('bT'), jsonb_build_array(public.t_tree(public.t_uid('01'), public.t_p1()))), null;
insert into ctx select 'pT', public.t_pub(public.t_id('rT')), null;

-- Source whose own two features overlap (both from the source side)
insert into ctx select 'bS', public.t_branch('Overlap source'), null;
insert into ctx select 'rS', public.t_save(public.t_id('bS'), jsonb_build_array(
  public.t_canopy(public.t_uid('51'), public.t_zone()), public.t_market(public.t_uid('52'), public.t_zone()))), null;
insert into ctx select 'pS', public.t_pub(public.t_id('rS')), null;

-- Source market in the zone for the time-slot cases
insert into ctx select 'bM', public.t_branch('Zone market'), null;
insert into ctx select 'rM', public.t_save(public.t_id('bM'), jsonb_build_array(public.t_market(public.t_uid('71'), public.t_zone(), 'Mañana'))), null;
insert into ctx select 'pM', public.t_pub(public.t_id('rM')), null;

-- Chain for same change on both sides: d2 at p1, later moved to p2
insert into ctx select 'bO', public.t_branch('Chain O'), null;
insert into ctx select 'rO1', public.t_save(public.t_id('bO'), jsonb_build_array(public.t_tree(public.t_uid('d2'), public.t_p1()))), null;
insert into ctx select 'pO1', public.t_pub(public.t_id('rO1')), null;
insert into ctx select 'rO2', public.t_save(public.t_id('bO'), jsonb_build_array(public.t_tree(public.t_uid('d2'), public.t_p2()))), null;
insert into ctx select 'pO2', public.t_pub(public.t_id('rO2')), null;

-- Chain for edit/edit: e1 label Base, later Theirs
insert into ctx select 'bE', public.t_branch('Chain E'), null;
insert into ctx select 'rE1', public.t_save(public.t_id('bE'), jsonb_build_array(public.t_tree(public.t_uid('e1'), public.t_p1(), 'Base'))), null;
insert into ctx select 'pE1', public.t_pub(public.t_id('rE1')), null;
insert into ctx select 'rE2', public.t_save(public.t_id('bE'), jsonb_build_array(public.t_tree(public.t_uid('e1'), public.t_p1(), 'Theirs'))), null;
insert into ctx select 'pE2', public.t_pub(public.t_id('rE2')), null;

-- Chain for edit/delete: g1 and g2; then g1 edited; then g1 deleted
insert into ctx select 'bG', public.t_branch('Chain G'), null;
insert into ctx select 'rG1', public.t_save(public.t_id('bG'), jsonb_build_array(
  public.t_tree(public.t_uid('91'), public.t_p1(), 'Base'), public.t_tree(public.t_uid('92'), public.t_p2(), 'Otro'))), null;
insert into ctx select 'pG1', public.t_pub(public.t_id('rG1')), null;
insert into ctx select 'rG2', public.t_save(public.t_id('bG'), jsonb_build_array(
  public.t_tree(public.t_uid('91'), public.t_p1(), 'Theirs'), public.t_tree(public.t_uid('92'), public.t_p2(), 'Otro'))), null;
insert into ctx select 'pG2', public.t_pub(public.t_id('rG2')), null;
insert into ctx select 'rG3', public.t_save(public.t_id('bG'), jsonb_build_array(public.t_tree(public.t_uid('92'), public.t_p2(), 'Otro'))), null;
insert into ctx select 'pG3', public.t_pub(public.t_id('rG3')), null;

-- User A (…01): target branches.
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

insert into ctx select 'bA1', public.t_branch('Shade A1'), null;
insert into ctx select 'rA1', public.t_save(public.t_id('bA1'), jsonb_build_array(public.t_canopy(public.t_uid('c1'), public.t_can()))), null;
insert into ctx select 'bA2', public.t_branch('Shade A2'), null;
insert into ctx select 'rA2', public.t_save(public.t_id('bA2'), jsonb_build_array(public.t_canopy(public.t_uid('c1'), public.t_can()))), null;
insert into ctx select 'bA3', public.t_branch('Shade A3'), null;
insert into ctx select 'rA3', public.t_save(public.t_id('bA3'), jsonb_build_array(public.t_canopy(public.t_uid('c1'), public.t_can()))), null;

-- 4. Demo: canopy (A, private) against market (B, published)
reset role;
insert into ctx select 'cnt0', null, jsonb_build_object(
  'revisions', (select count(*) from public.revisions),
  'features', (select count(*) from public.revision_features),
  'decisions', (select count(*) from public.revision_merge_decisions));
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

insert into ctx select 'pv_demo', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'));
select is(public.t_doc('pv_demo') #>> '{ancestor,kind}', 'baseline', 'demo preview: ancestor kind is baseline');
select is(public.t_doc('pv_demo') #> '{ancestor,revisionId}', 'null'::jsonb, 'demo preview: baseline ancestor exposes no revision id');
select is(jsonb_array_length(public.t_doc('pv_demo') -> 'conflicts'), 1, 'demo preview: exactly one conflict');
select is(public.t_doc('pv_demo') #>> '{conflicts,0,type}', 'exclusive_overlap', 'demo preview: conflict type is exclusive_overlap');
select is((public.t_doc('pv_demo') #>> '{conflicts,0,blocking}')::boolean, true, 'demo preview: the conflict is blocking');
select ok(
  (public.t_doc('pv_demo') #> '{conflicts,0,featureIds}') @> jsonb_build_array(public.t_uid('c1'), public.t_uid('b1'))
  and jsonb_array_length(public.t_doc('pv_demo') #> '{conflicts,0,featureIds}') = 2,
  'demo preview: conflict names both feature ids'
);
select ok(
  (public.t_doc('pv_demo') #>> '{conflicts,0,intersectionM2}')::numeric between 174 and 175.5,
  'demo preview: intersection is about 174.67 m2'
);
select is(jsonb_array_length(public.t_doc('pv_demo') -> 'unresolved'), 1, 'demo preview: one unresolved id');
select is(public.t_doc('pv_demo') -> 'unresolved' -> 0, public.t_doc('pv_demo') #> '{conflicts,0,id}', 'demo preview: unresolved id matches the conflict id');
select is((public.t_doc('pv_demo') ->> 'featureCount')::int, 2, 'demo preview: combined set has two features');
select is(public.t_doc('pv_demo') #>> '{source,publicationId}', public.t_id('pB')::text, 'demo preview: source publication id echoed');
select is(
  (select count(*)::int from jsonb_array_elements(public.t_doc('pv_demo') -> 'features') as f where f ? 'wkb'),
  0, 'demo preview: no wkb leaks to the client'
);

-- Invalid resolutions (preview lists them; commit rejects)
insert into ctx select 'pv_unknown', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'),
  public.t_rm('spatial:nope', public.t_uid('c1')));
select ok(public.t_doc('pv_unknown') -> 'invalidResolutions' @> '[{"conflictId":"spatial:nope","reason":"unknown_conflict"}]', 'unknown spatial conflict id is listed as unknown_conflict');
insert into ctx select 'pv_unknown_el', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'),
  public.t_act('element:' || public.t_uid('c1'), 'keep_target'));
select ok(public.t_doc('pv_unknown_el') -> 'invalidResolutions' @> jsonb_build_array(jsonb_build_object('conflictId', 'element:' || public.t_uid('c1'), 'reason', 'unknown_conflict')), 'unknown element conflict id is listed as unknown_conflict');

insert into ctx select 'pv_dup', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'),
  public.t_rm(public.t_doc('pv_demo') #>> '{conflicts,0,id}', public.t_uid('c1'))
  || public.t_rm(public.t_doc('pv_demo') #>> '{conflicts,0,id}', public.t_uid('c1')));
select ok(public.t_doc('pv_dup') -> 'invalidResolutions' @> jsonb_build_array(jsonb_build_object('conflictId', public.t_doc('pv_demo') #>> '{conflicts,0,id}', 'reason', 'duplicate_resolution')), 'duplicate resolution is listed as duplicate_resolution');

insert into ctx select 'pv_malformed', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'),
  public.t_act('x', 'explode'));
select ok(public.t_doc('pv_malformed') -> 'invalidResolutions' @> '[{"conflictId":"x","reason":"malformed_resolution"}]', 'unknown action is listed as malformed_resolution');

select lives_ok(
  $$select public.t_prev(public.t_id('bA1'), public.t_id('pB'), '[{"action":"remove"}]'::jsonb)$$,
  'a resolution without conflictId does not raise from preview'
);
select lives_ok(
  $$select public.t_prev(public.t_id('bA1'), public.t_id('pB'), '[1, "x", null, []]'::jsonb)$$,
  'non-object resolutions do not raise from preview'
);
select throws_ok(
  $$select public.t_prev(public.t_id('bA1'), public.t_id('pB'), '{}'::jsonb)$$,
  '22023', 'invalid_merge_request', 'a non-array resolutions value is 22023'
);

insert into ctx select 'pv_mismatch', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'),
  public.t_redraw(public.t_doc('pv_demo') #>> '{conflicts,0,id}',
    public.t_market(public.t_uid('99'), public.t_mkt_moved())));
select ok(public.t_doc('pv_mismatch') -> 'invalidResolutions' @> jsonb_build_array(jsonb_build_object('conflictId', public.t_doc('pv_demo') #>> '{conflicts,0,id}', 'reason', 'feature_not_in_conflict')), 'redraw of a feature outside the pair is feature_not_in_conflict');
select is(jsonb_array_length(public.t_doc('pv_mismatch') -> 'unresolved'), 1, 'redraw with mismatched id leaves the conflict unresolved');

insert into ctx select 'pv_outside', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'),
  public.t_redraw(public.t_doc('pv_demo') #>> '{conflicts,0,id}',
    public.t_market(public.t_uid('b1'), public.t_rect(-98.0, 19.0, -97.9999, 19.0001))));
select ok(public.t_doc('pv_outside') -> 'invalidResolutions' @> jsonb_build_array(jsonb_build_object('conflictId', public.t_doc('pv_demo') #>> '{conflicts,0,id}', 'reason', 'feature_outside_site')), 'redraw outside the boundary is feature_outside_site');
select is(jsonb_array_length(public.t_doc('pv_outside') -> 'unresolved'), 1, 'redraw outside the boundary leaves the conflict unresolved');

insert into ctx select 'pv_badremove', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'),
  public.t_rm(public.t_doc('pv_demo') #>> '{conflicts,0,id}', public.t_uid('99')));
select ok(public.t_doc('pv_badremove') -> 'invalidResolutions' @> jsonb_build_array(jsonb_build_object('conflictId', public.t_doc('pv_demo') #>> '{conflicts,0,id}', 'reason', 'feature_not_in_conflict')), 'remove of a feature outside the pair is feature_not_in_conflict');

insert into ctx select 'pv_keep', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'),
  public.t_act(public.t_doc('pv_demo') #>> '{conflicts,0,id}', 'keep_target'));
select ok(public.t_doc('pv_keep') -> 'invalidResolutions' @> jsonb_build_array(jsonb_build_object('conflictId', public.t_doc('pv_demo') #>> '{conflicts,0,id}', 'reason', 'action_not_allowed')), 'keep_target on a spatial conflict is action_not_allowed');

insert into ctx select 'pv_still', null, public.t_prev(public.t_id('bA1'), public.t_id('pB'),
  public.t_redraw(public.t_doc('pv_demo') #>> '{conflicts,0,id}',
    public.t_market(public.t_uid('b1'), public.t_mkt_still_overlapping())));
select is(jsonb_array_length(public.t_doc('pv_still') -> 'unresolved'), 1, 'a redraw that still overlaps stays unresolved');
select is(jsonb_array_length(public.t_doc('pv_still') -> 'invalidResolutions'), 0, 'a redraw that still overlaps is not an invalid resolution');

select throws_ok(
  $$select public.t_merge(public.t_id('bA1'), public.t_id('pB'), public.t_redraw(public.t_doc('pv_demo') #>> '{conflicts,0,id}', public.t_market(public.t_uid('b1'), public.t_rect(-98.0, 19.0, -97.9999, 19.0001))))$$,
  'FT422', 'invalid_resolution', 'commit with a redraw outside the boundary is invalid_resolution'
);
select throws_ok(
  $$select public.t_merge(public.t_id('bA1'), public.t_id('pB'), public.t_act('x', 'explode'))$$,
  'FT422', 'invalid_resolution', 'commit with a malformed action is invalid_resolution'
);
select throws_ok(
  $$select public.t_merge(public.t_id('bA1'), public.t_id('pB'), public.t_rm('spatial:nope', public.t_uid('c1')))$$,
  'FT422', 'invalid_resolution', 'commit with an unknown conflict id is invalid_resolution'
);
select throws_ok(
  $$select public.t_merge(public.t_id('bA1'), public.t_id('pB'), public.t_redraw(public.t_doc('pv_demo') #>> '{conflicts,0,id}', public.t_market(public.t_uid('99'), public.t_mkt_moved())))$$,
  'FT422', 'invalid_resolution', 'commit with a redraw of the wrong feature id is invalid_resolution'
);
select throws_ok(
  $$select public.t_merge(public.t_id('bA1'), public.t_id('pB'), public.t_redraw(public.t_doc('pv_demo') #>> '{conflicts,0,id}', public.t_market(public.t_uid('b1'), public.t_mkt_still_overlapping())))$$,
  'FT422', 'unresolved_conflicts', 'commit with a redraw that still overlaps is unresolved_conflicts'
);
select throws_ok(
  $$select public.t_merge(public.t_id('bA1'), public.t_id('pB'))$$,
  'FT422', 'unresolved_conflicts', 'commit without a resolution is unresolved_conflicts'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA1'), public.t_id('pB'), public.t_id('rB'), 'Merge', '[]'::jsonb, 'stale-head-key-1', repeat('e', 64))$$,
  'FT409', 'stale_head', 'commit with the wrong expected head is stale_head'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA1'), public.t_id('pB'), public.t_id('rA1'), ' ', '[]'::jsonb, 'msg-blank-key-1', repeat('e', 64))$$,
  '22023', 'invalid_merge_request', 'a blank message is 22023'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA1'), public.t_id('pB'), public.t_id('rA1'), 'Merge', '{}'::jsonb, 'res-object-key-1', repeat('e', 64))$$,
  '22023', 'invalid_merge_request', 'non-array resolutions on commit is 22023'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA1'), public.t_id('pB'), public.t_id('rA1'), 'Merge', '[]'::jsonb, 'short', repeat('e', 64))$$,
  '22023', 'invalid_merge_request', 'a short idempotency key is 22023'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA1'), public.t_id('pB'), public.t_id('rA1'), 'Merge', '[]'::jsonb, 'bad-hash-key-1', 'XYZ')$$,
  '22023', 'invalid_merge_request', 'a malformed payload hash is 22023'
);

-- Previews and failed commits wrote nothing.
reset role;
select is(
  jsonb_build_object(
    'revisions', (select count(*) from public.revisions),
    'features', (select count(*) from public.revision_features),
    'decisions', (select count(*) from public.revision_merge_decisions)),
  public.t_doc('cnt0'),
  'previews and rejected commits wrote no rows'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

-- Successful commit with a redraw
insert into ctx select 'cm_demo', null, public.t_merge(public.t_id('bA1'), public.t_id('pB'),
  public.t_redraw(public.t_doc('pv_demo') #>> '{conflicts,0,id}', public.t_market(public.t_uid('b1'), public.t_mkt_moved())));
select is((public.t_doc('cm_demo') ->> 'parentRevisionId')::uuid, public.t_id('rA1'), 'merge commit: response parent is the previous head');
select is((public.t_doc('cm_demo') ->> 'featureCount')::int, 2, 'merge commit: two features');
select is((public.t_doc('cm_demo') ->> 'conflictCount')::int, 1, 'merge commit: one conflict recorded');
select is((public.t_doc('cm_demo') ->> 'sourcePublicationId')::uuid, public.t_id('pB'), 'merge commit: source publication echoed');
select is(public.t_doc('cm_demo') ->> 'ancestorKind', 'baseline', 'merge commit: ancestor kind baseline');
select is(public.t_head(public.t_id('bA1')), (public.t_doc('cm_demo') ->> 'revisionId')::uuid, 'merge commit: branch head moved to the merge revision');
select is(public.t_nfeat(public.t_id('bA1')), 2, 'merge commit: head has two features');
select is(public.get_branch_head(public.t_id('bA1')) ->> 'mergeSourcePublicationId', public.t_id('pB')::text, 'get_branch_head exposes mergeSourcePublicationId');
select is((public.get_branch_head(public.t_id('bA1')) ->> 'mergeSourceVisible')::boolean, true, 'get_branch_head mergeSourceVisible is true while visible');
select is(public.get_branch_head(public.t_id('bA3')) -> 'mergeSourcePublicationId', 'null'::jsonb, 'unmerged branch has a null mergeSourcePublicationId');
select is(public.get_branch_head(public.t_id('bA3')) -> 'mergeSourceVisible', 'null'::jsonb, 'unmerged branch has a null mergeSourceVisible');

select is(
  (select d.source_publication_id from public.revision_merge_decisions as d where d.revision_id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid),
  public.t_id('pB'), 'owner reads the decision row (source_publication_id)'
);
select is(
  (select d.decisions #>> '{resolutions,0,action}' from public.revision_merge_decisions as d where d.revision_id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid),
  'redraw', 'decision row records the redraw action'
);
select throws_ok(
  $$select ancestor_revision_id from public.revision_merge_decisions$$,
  '42501', null, 'authenticated cannot read ancestor_revision_id'
);
select throws_ok(
  $$select source_revision_id from public.revision_merge_decisions$$,
  '42501', null, 'authenticated cannot read source_revision_id'
);
select throws_ok(
  $$select * from public.revision_merge_decisions$$,
  '42501', null, 'select * on revision_merge_decisions is denied by column privileges'
);
select throws_ok(
  $$insert into public.revision_merge_decisions (revision_id, source_publication_id, source_revision_id, ancestor_kind, engine_version, decisions)
    values (public.t_id('rA1'), public.t_id('pB'), public.t_id('rB'), 'baseline', 'x', '{}')$$,
  '42501', null, 'authenticated cannot insert decision rows'
);

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);
select is((select count(*)::int from public.revision_merge_decisions), 0, 'another user sees no decision rows');
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

reset role;
select is((select r.parent_revision_id from public.revisions as r where r.id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid), public.t_id('rA1'), 'merge revision parent is the target head');
select is((select r.merge_parent_revision_id from public.revisions as r where r.id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid), public.t_id('rB'), 'merge revision merge_parent is the source revision');
select is((select count(*)::int from public.revision_features as f where f.revision_id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid), 2, 'merge revision has two features');
select is(
  (select round(extensions.st_xmin(f.geometry)::numeric, 6) from public.revision_features as f
   where f.revision_id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid and f.feature_id = public.t_uid('b1')::uuid),
  -98.198400::numeric, 'the redrawn market geometry was committed'
);
select is(
  (select d.ancestor_kind from public.revision_merge_decisions as d where d.revision_id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid),
  'baseline', 'decision row ancestor_kind is baseline'
);
select is(
  (select d.ancestor_revision_id from public.revision_merge_decisions as d where d.revision_id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid),
  null::uuid, 'baseline merge stores no ancestor revision'
);
select is(
  (select d.source_revision_id from public.revision_merge_decisions as d where d.revision_id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid),
  public.t_id('rB'), 'decision row stores the source revision'
);
select is(
  (select d.decisions #>> '{conflicts,0,type}' from public.revision_merge_decisions as d where d.revision_id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid),
  'exclusive_overlap', 'decision row records the conflict type'
);
select throws_ok(
  $$update public.revision_merge_decisions set engine_version = 'tampered'$$,
  '55000', 'immutable_curated_data', 'decision rows cannot be updated'
);
select throws_ok(
  $$delete from public.revision_merge_decisions$$,
  '55000', 'immutable_curated_data', 'decision rows cannot be deleted'
);
select throws_ok(
  $$truncate public.revision_merge_decisions$$,
  '55000', 'immutable_curated_data', 'decision rows cannot be truncated'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

-- Re-merge is refused
select throws_ok(
  $$select public.t_prev(public.t_id('bA1'), public.t_id('pB'))$$,
  'FT422', 'already_merged', 'preview of an already merged source is already_merged'
);
select throws_ok(
  $$select public.t_merge(public.t_id('bA1'), public.t_id('pB'))$$,
  'FT422', 'already_merged', 'commit of an already merged source is already_merged'
);

-- 5. Resolution by remove, with idempotent replay
insert into ctx select 'pv_rm', null, public.t_prev(public.t_id('bA2'), public.t_id('pB'));
insert into ctx select 'hA2', public.t_head(public.t_id('bA2')), null;
insert into ctx select 'cm_rm', null, public.merge_commit(public.t_id('bA2'), public.t_id('pB'), public.t_id('hA2'), 'Merge remove',
  public.t_rm(public.t_doc('pv_rm') #>> '{conflicts,0,id}', public.t_uid('c1')), 'merge-replay-0001', repeat('f', 64));
select is((public.t_doc('cm_rm') ->> 'featureCount')::int, 1, 'remove resolution: merged revision has one feature');
select is(public.get_branch_head(public.t_id('bA2')) #>> '{features,0,id}', public.t_uid('b1'), 'remove resolution: the market remains');
select is(jsonb_array_length(public.get_branch_head(public.t_id('bA2')) -> 'features'), 1, 'remove resolution: canopy is gone from the head');

reset role;
insert into ctx select 'rev_count_a2', null, to_jsonb((select count(*) from public.revisions where branch_id = public.t_id('bA2')));
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select is(
  public.merge_commit(public.t_id('bA2'), public.t_id('pB'), public.t_id('hA2'), 'Merge remove',
    public.t_rm(public.t_doc('pv_rm') #>> '{conflicts,0,id}', public.t_uid('c1')), 'merge-replay-0001', repeat('f', 64)),
  public.t_doc('cm_rm'),
  'replay with the same key and hash returns the identical json'
);
reset role;
select is(
  to_jsonb((select count(*) from public.revisions where branch_id = public.t_id('bA2'))),
  public.t_doc('rev_count_a2'),
  'replay creates no extra revision'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA2'), public.t_id('pB'), public.t_id('hA2'), 'Merge remove', '[]'::jsonb, 'merge-replay-0001', repeat('9', 64))$$,
  'FT001', 'idempotency_key_reused', 'same key with a different hash is FT001'
);

-- 6. Disjoint changes: source adds a tree, target adds a far canopy
insert into ctx select 'bA4', public.t_branch('Disjoint A'), null;
insert into ctx select 'rA4', public.t_save(public.t_id('bA4'), jsonb_build_array(public.t_canopy(public.t_uid('ce'), public.t_east()))), null;
insert into ctx select 'pv_disjoint', null, public.t_prev(public.t_id('bA4'), public.t_id('pT'));
select is(jsonb_array_length(public.t_doc('pv_disjoint') -> 'conflicts'), 0, 'disjoint: no conflicts');
select is(jsonb_array_length(public.t_doc('pv_disjoint') -> 'unresolved'), 0, 'disjoint: nothing unresolved');
select is(jsonb_array_length(public.t_doc('pv_disjoint') -> 'warnings'), 0, 'disjoint: no warnings');
select is((public.t_doc('pv_disjoint') ->> 'featureCount')::int, 2, 'disjoint: both features kept in preview');
insert into ctx select 'cm_disjoint', null, public.t_merge(public.t_id('bA4'), public.t_id('pT'));
select is((public.t_doc('cm_disjoint') ->> 'featureCount')::int, 2, 'disjoint: commit keeps both features');
select is(public.t_nfeat(public.t_id('bA4')), 2, 'disjoint: head holds both features');

-- 7. Same change on both sides (fork + later publication of the original)
insert into ctx select 'fO', (public.t_fork(public.t_id('pO1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFO', public.t_save(public.t_id('fO'), jsonb_build_array(public.t_tree(public.t_uid('d2'), public.t_p2()))), null;
insert into ctx select 'pv_both', null, public.t_prev(public.t_id('fO'), public.t_id('pO2'));
select is(jsonb_array_length(public.t_doc('pv_both') -> 'conflicts'), 0, 'same change on both sides: no conflict');
select is(jsonb_array_length(public.t_doc('pv_both') -> 'unresolved'), 0, 'same change on both sides: nothing unresolved');
select ok(public.t_doc('pv_both') -> 'operations' @> jsonb_build_array(jsonb_build_object('featureId', public.t_uid('d2'), 'decision', 'both')), 'same change on both sides: decision is both');
select is(public.t_doc('pv_both') #>> '{features,0,provenance}', 'both', 'same change on both sides: provenance is both');
select is(public.t_doc('pv_both') #>> '{ancestor,kind}', 'publication', 'forked ancestor is a visible publication');
select is(public.t_doc('pv_both') #>> '{ancestor,publicationId}', public.t_id('pO1')::text, 'forked ancestor exposes the publication id');
select is((public.t_doc('pv_both') ->> 'featureCount')::int, 1, 'same change on both sides: one feature');
insert into ctx select 'cm_both', null, public.t_merge(public.t_id('fO'), public.t_id('pO2'));
select is((public.t_doc('cm_both') ->> 'featureCount')::int, 1, 'same change on both sides: commit keeps one feature');
select is((public.t_doc('cm_both') ->> 'parentRevisionId')::uuid, public.t_id('rFO'), 'same change on both sides: parent is the fork head');

-- Own-revision ancestor: A forks its own publication, then publishes a later revision.
insert into ctx select 'bX', public.t_branch('Own chain'), null;
insert into ctx select 'rX1', public.t_save(public.t_id('bX'), jsonb_build_array(public.t_tree(public.t_uid('f1'), public.t_p1(), 'Uno'))), null;
insert into ctx select 'pX1', public.t_pub(public.t_id('rX1')), null;
insert into ctx select 'fX', (public.t_fork(public.t_id('pX1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rX2', public.t_save(public.t_id('bX'), jsonb_build_array(public.t_tree(public.t_uid('f1'), public.t_p1(), 'Dos'))), null;
insert into ctx select 'pX2', public.t_pub(public.t_id('rX2')), null;
insert into ctx select 'pv_own', null, public.t_prev(public.t_id('fX'), public.t_id('pX2'));
select is(public.t_doc('pv_own') #>> '{ancestor,kind}', 'own_revision', 'own ancestor: kind is own_revision');
select is(public.t_doc('pv_own') #>> '{ancestor,revisionId}', public.t_id('rX1')::text, 'own ancestor: revision id exposed');
select is(jsonb_array_length(public.t_doc('pv_own') -> 'conflicts'), 0, 'own ancestor: source-only change has no conflict');
insert into ctx select 'cm_own', null, public.t_merge(public.t_id('fX'), public.t_id('pX2'));
select is(public.get_branch_head(public.t_id('fX')) #>> '{features,0,properties,label}', 'Dos', 'own ancestor: source-only change is taken');

-- 8. Edit/edit
insert into ctx select 'fE1', (public.t_fork(public.t_id('pE1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFE1', public.t_save(public.t_id('fE1'), jsonb_build_array(public.t_tree(public.t_uid('e1'), public.t_p1(), 'Mine'))), null;
insert into ctx select 'fE2', (public.t_fork(public.t_id('pE1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFE2', public.t_save(public.t_id('fE2'), jsonb_build_array(public.t_tree(public.t_uid('e1'), public.t_p1(), 'Mine'))), null;
insert into ctx select 'fE3', (public.t_fork(public.t_id('pE1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFE3', public.t_save(public.t_id('fE3'), jsonb_build_array(public.t_tree(public.t_uid('e1'), public.t_p1(), 'Mine'))), null;

insert into ctx select 'pv_ee', null, public.t_prev(public.t_id('fE1'), public.t_id('pE2'));
select is(public.t_doc('pv_ee') #>> '{conflicts,0,type}', 'edit_edit', 'edit/edit: conflict type');
select is(public.t_doc('pv_ee') #>> '{conflicts,0,id}', 'element:' || public.t_uid('e1'), 'edit/edit: conflict id is element:<featureId>');
select is(public.t_doc('pv_ee') #>> '{conflicts,0,target,properties,label}', 'Mine', 'edit/edit: target side shown');
select is(public.t_doc('pv_ee') #>> '{conflicts,0,source,properties,label}', 'Theirs', 'edit/edit: source side shown');
select is(public.t_doc('pv_ee') #>> '{conflicts,0,ancestor,properties,label}', 'Base', 'edit/edit: visible ancestor side shown');
select is(jsonb_array_length(public.t_doc('pv_ee') -> 'unresolved'), 1, 'edit/edit: unresolved without a resolution');
select throws_ok(
  $$select public.t_merge(public.t_id('fE1'), public.t_id('pE2'))$$,
  'FT422', 'unresolved_conflicts', 'edit/edit: commit without resolution is unresolved_conflicts'
);
insert into ctx select 'pv_ee_mm', null, public.t_prev(public.t_id('fE1'), public.t_id('pE2'),
  public.t_redraw('element:' || public.t_uid('e1'), public.t_tree(public.t_uid('99'), public.t_p1(), 'Merged')));
select ok(public.t_doc('pv_ee_mm') -> 'invalidResolutions' @> jsonb_build_array(jsonb_build_object('conflictId', 'element:' || public.t_uid('e1'), 'reason', 'redraw_id_mismatch')), 'edit/edit: redraw with another feature id is redraw_id_mismatch');
select is(jsonb_array_length(public.t_doc('pv_ee_mm') -> 'unresolved'), 1, 'edit/edit: redraw id mismatch stays unresolved');
insert into ctx select 'pv_ee_out', null, public.t_prev(public.t_id('fE1'), public.t_id('pE2'),
  public.t_redraw('element:' || public.t_uid('e1'), public.t_tree(public.t_uid('e1'), public.t_pt(-98.0, 19.0), 'Merged')));
select ok(public.t_doc('pv_ee_out') -> 'invalidResolutions' @> jsonb_build_array(jsonb_build_object('conflictId', 'element:' || public.t_uid('e1'), 'reason', 'feature_outside_site')), 'edit/edit: redraw outside the boundary is feature_outside_site');

insert into ctx select 'cm_ee_t', null, public.t_merge(public.t_id('fE1'), public.t_id('pE2'), public.t_act('element:' || public.t_uid('e1'), 'keep_target'));
select is(public.get_branch_head(public.t_id('fE1')) #>> '{features,0,properties,label}', 'Mine', 'edit/edit: keep_target keeps the target properties');
insert into ctx select 'cm_ee_s', null, public.t_merge(public.t_id('fE2'), public.t_id('pE2'), public.t_act('element:' || public.t_uid('e1'), 'keep_source'));
select is(public.get_branch_head(public.t_id('fE2')) #>> '{features,0,properties,label}', 'Theirs', 'edit/edit: keep_source takes the source properties');
insert into ctx select 'cm_ee_r', null, public.t_merge(public.t_id('fE3'), public.t_id('pE2'),
  public.t_redraw('element:' || public.t_uid('e1'), public.t_tree(public.t_uid('e1'), public.t_p1(), 'Merged')));
select is(public.get_branch_head(public.t_id('fE3')) #>> '{features,0,properties,label}', 'Merged', 'edit/edit: redraw commits the redrawn properties');
select is(jsonb_array_length(public.get_branch_head(public.t_id('fE3')) -> 'features'), 1, 'edit/edit: still one feature after redraw');

-- 9. Edit/delete, in both directions
insert into ctx select 'fG1', (public.t_fork(public.t_id('pG1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFG1', public.t_save(public.t_id('fG1'), jsonb_build_array(public.t_tree(public.t_uid('92'), public.t_p2(), 'Otro'))), null;
insert into ctx select 'pv_ed', null, public.t_prev(public.t_id('fG1'), public.t_id('pG2'));
select is(public.t_doc('pv_ed') #>> '{conflicts,0,type}', 'edit_delete', 'target deletes, source edits: edit_delete');
select is(public.t_doc('pv_ed') #> '{conflicts,0,target}', 'null'::jsonb, 'target deletes, source edits: target side is null');
select is(public.t_doc('pv_ed') #>> '{conflicts,0,source,properties,label}', 'Theirs', 'target deletes, source edits: source side shown');
select is(public.t_doc('pv_ed') #>> '{conflicts,0,id}', 'element:' || public.t_uid('91'), 'target deletes, source edits: conflict id');
select throws_ok(
  $$select public.t_merge(public.t_id('fG1'), public.t_id('pG2'))$$,
  'FT422', 'unresolved_conflicts', 'edit/delete: commit without resolution is unresolved_conflicts'
);
insert into ctx select 'cm_ed', null, public.t_merge(public.t_id('fG1'), public.t_id('pG2'), public.t_act('element:' || public.t_uid('91'), 'keep_target'));
select is(public.t_nfeat(public.t_id('fG1')), 1, 'edit/delete: keep_target keeps the deletion');
select is(public.get_branch_head(public.t_id('fG1')) #>> '{features,0,id}', public.t_uid('92'), 'edit/delete: the untouched feature remains');

insert into ctx select 'fG2', (public.t_fork(public.t_id('pG1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFG2', public.t_save(public.t_id('fG2'), jsonb_build_array(
  public.t_tree(public.t_uid('91'), public.t_p1(), 'Mine'), public.t_tree(public.t_uid('92'), public.t_p2(), 'Otro'))), null;
insert into ctx select 'pv_de', null, public.t_prev(public.t_id('fG2'), public.t_id('pG3'));
select is(public.t_doc('pv_de') #>> '{conflicts,0,type}', 'edit_delete', 'target edits, source deletes: edit_delete');
select is(public.t_doc('pv_de') #> '{conflicts,0,source}', 'null'::jsonb, 'target edits, source deletes: source side is null');
select is(public.t_doc('pv_de') #>> '{conflicts,0,target,properties,label}', 'Mine', 'target edits, source deletes: target side shown');
insert into ctx select 'cm_de', null, public.t_merge(public.t_id('fG2'), public.t_id('pG3'), public.t_act('element:' || public.t_uid('91'), 'keep_source'));
select is(public.t_nfeat(public.t_id('fG2')), 1, 'edit/delete: keep_source accepts the deletion');
insert into ctx select 'fG3', (public.t_fork(public.t_id('pG1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFG3', public.t_save(public.t_id('fG3'), jsonb_build_array(
  public.t_tree(public.t_uid('91'), public.t_p1(), 'Mine'), public.t_tree(public.t_uid('92'), public.t_p2(), 'Otro'))), null;
insert into ctx select 'cm_de2', null, public.t_merge(public.t_id('fG3'), public.t_id('pG3'), public.t_act('element:' || public.t_uid('91'), 'keep_target'));
select is(public.get_branch_head(public.t_id('fG3')) #>> '{features,0,properties,label}', 'Mine', 'edit/delete: keep_target keeps the target edit');
insert into ctx select 'fG4', (public.t_fork(public.t_id('pG1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFG4', public.t_save(public.t_id('fG4'), jsonb_build_array(
  public.t_tree(public.t_uid('91'), public.t_p1(), 'Mine'), public.t_tree(public.t_uid('92'), public.t_p2(), 'Otro'))), null;
insert into ctx select 'cm_de3', null, public.t_merge(public.t_id('fG4'), public.t_id('pG3'), public.t_act('element:' || public.t_uid('91'), 'remove'));
select is(public.t_nfeat(public.t_id('fG4')), 1, 'edit/delete: remove drops the feature');

-- 10. Spatial conflicts across different ids whose features came from one side only
insert into ctx select 'bW', public.t_branch('Both from target'), null;
insert into ctx select 'rW', public.t_save(public.t_id('bW'), jsonb_build_array(
  public.t_canopy(public.t_uid('61'), public.t_zone()), public.t_market(public.t_uid('62'), public.t_zone()))), null;
insert into ctx select 'pv_wt', null, public.t_prev(public.t_id('bW'), public.t_id('pT'));
select is(jsonb_array_length(public.t_doc('pv_wt') -> 'warnings'), 1, 'both from target: overlap is a warning');
select is((public.t_doc('pv_wt') #>> '{warnings,0,blocking}')::boolean, false, 'both from target: warning is not blocking');
select is(jsonb_array_length(public.t_doc('pv_wt') -> 'unresolved'), 0, 'both from target: nothing unresolved');
insert into ctx select 'cm_wt', null, public.t_merge(public.t_id('bW'), public.t_id('pT'));
select is((public.t_doc('cm_wt') ->> 'featureCount')::int, 3, 'both from target: commit succeeds with three features');

insert into ctx select 'bW2', public.t_branch('Both from source target'), null;
insert into ctx select 'rW2', public.t_save(public.t_id('bW2'), jsonb_build_array(public.t_tree(public.t_uid('63'), public.t_p1()))), null;
insert into ctx select 'pv_ws', null, public.t_prev(public.t_id('bW2'), public.t_id('pS'));
select is(jsonb_array_length(public.t_doc('pv_ws') -> 'warnings'), 1, 'both from source: overlap is a warning');
select is(jsonb_array_length(public.t_doc('pv_ws') -> 'unresolved'), 0, 'both from source: nothing unresolved');

-- Market against market: time slot decides
insert into ctx select 'bK1', public.t_branch('Slot different'), null;
insert into ctx select 'rK1', public.t_save(public.t_id('bK1'), jsonb_build_array(public.t_market(public.t_uid('72'), public.t_zone_inner(), 'Tarde'))), null;
insert into ctx select 'bK2', public.t_branch('Slot same'), null;
insert into ctx select 'rK2', public.t_save(public.t_id('bK2'), jsonb_build_array(public.t_market(public.t_uid('72'), public.t_zone_inner(), 'Mañana'))), null;
insert into ctx select 'pv_slot_diff', null, public.t_prev(public.t_id('bK1'), public.t_id('pM'));
select is(jsonb_array_length(public.t_doc('pv_slot_diff') -> 'conflicts'), 0, 'markets in different time slots: no conflict');
select is(jsonb_array_length(public.t_doc('pv_slot_diff') -> 'unresolved'), 0, 'markets in different time slots: nothing unresolved');
insert into ctx select 'pv_slot_same', null, public.t_prev(public.t_id('bK2'), public.t_id('pM'));
select is(jsonb_array_length(public.t_doc('pv_slot_same') -> 'conflicts'), 1, 'markets in the same time slot: one conflict');
select is((public.t_doc('pv_slot_same') #>> '{conflicts,0,blocking}')::boolean, true, 'markets in the same time slot: blocking');
select is(public.t_doc('pv_slot_same') #>> '{conflicts,0,timeSlot}', 'Mañana', 'markets in the same time slot: slot reported');
select is(jsonb_array_length(public.t_doc('pv_slot_same') -> 'unresolved'), 1, 'markets in the same time slot: unresolved');
insert into ctx select 'cm_slot_diff', null, public.t_merge(public.t_id('bK1'), public.t_id('pM'));
select is((public.t_doc('cm_slot_diff') ->> 'featureCount')::int, 2, 'markets in different time slots: commit keeps both');

-- 11. nothing_to_merge
insert into ctx select 'bN', public.t_branch('Nothing'), null;
insert into ctx select 'rN1', public.t_save(public.t_id('bN'), jsonb_build_array(public.t_tree(public.t_uid('a1'), public.t_p1()))), null;
insert into ctx select 'pN1', public.t_pub(public.t_id('rN1')), null;
insert into ctx select 'rN2', public.t_save(public.t_id('bN'), jsonb_build_array(public.t_tree(public.t_uid('a1'), public.t_p2()))), null;
insert into ctx select 'pN2', public.t_pub(public.t_id('rN2')), null;
select throws_ok(
  $$select public.t_prev(public.t_id('bN'), public.t_id('pN2'))$$,
  'FT422', 'nothing_to_merge', 'preview of the branch own head publication is nothing_to_merge'
);
select throws_ok(
  $$select public.t_merge(public.t_id('bN'), public.t_id('pN2'))$$,
  'FT422', 'nothing_to_merge', 'commit of the branch own head publication is nothing_to_merge'
);
select throws_ok(
  $$select public.t_prev(public.t_id('bN'), public.t_id('pN1'))$$,
  'FT422', 'nothing_to_merge', 'preview of an earlier own publication is nothing_to_merge'
);
select throws_ok(
  $$select public.t_merge(public.t_id('bN'), public.t_id('pN1'))$$,
  'FT422', 'nothing_to_merge', 'commit of an earlier own publication is nothing_to_merge'
);

-- 12. merge_find_ancestor (as postgres)
reset role;
select is(
  public.merge_find_ancestor(public.t_id('rN2'), public.t_id('rN1')),
  '{"status":"nothing_to_merge"}'::jsonb,
  'merge_find_ancestor: source inside the target chain is nothing_to_merge'
);
select is(
  public.merge_find_ancestor(public.t_id('rN2'), public.t_id('rN2')),
  '{"status":"nothing_to_merge"}'::jsonb,
  'merge_find_ancestor: identical revisions are nothing_to_merge'
);
select is(
  public.merge_find_ancestor((select current_revision_id from public.branches where id = public.t_id('fE1') ), public.t_id('rE2')) ->> 'status',
  'ok', 'merge_find_ancestor: a fork and a later publication share an ancestor'
);
select is(
  (select e.initial from (select (public.merge_find_ancestor(
      (select r.parent_revision_id from public.revisions as r where r.id = public.t_id('rFE1')), public.t_id('rE2')) ->> 'ancestorId')::uuid as initial) as e),
  public.t_id('rE1'),
  'merge_find_ancestor: nearest common ancestor is the forked revision'
);
select is(
  public.merge_find_ancestor(public.t_id('rA3'), public.t_id('rB')),
  '{"status":"ok","ancestorId":null}'::jsonb,
  'merge_find_ancestor: two independent branches have the baseline (null) ancestor'
);

-- 13. Access: other user's branch, no authentication, anon
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.merge_preview(public.t_id('bA3'), public.t_id('pT'))$$,
  'P0002', 'branch_not_found', 'preview on another user''s branch is branch_not_found'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA3'), public.t_id('pT'), public.t_id('rA3'), 'Merge', '[]'::jsonb, 'other-user-key-1', repeat('e', 64))$$,
  'P0002', 'branch_not_found', 'commit on another user''s branch is branch_not_found'
);
select throws_ok(
  $$select public.merge_preview('95000000-0000-4000-8000-0000000000aa', public.t_id('pT'))$$,
  'P0002', 'branch_not_found', 'preview on an unknown branch is branch_not_found'
);
select throws_ok(
  $$select public.merge_preview(public.t_id('bA3'), '95000000-0000-4000-8000-0000000000aa')$$,
  'P0002', 'publication_not_found', 'preview of an unknown publication is publication_not_found'
);
select throws_ok(
  $$select public.merge_preview(null, public.t_id('pT'))$$,
  '22023', 'invalid_merge_request', 'preview with a null branch is 22023'
);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.merge_preview(public.t_id('bA3'), public.t_id('pT'))$$,
  '28000', 'authentication_required', 'preview without a user is 28000'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA3'), public.t_id('pT'), public.t_id('rA3'), 'Merge', '[]'::jsonb, 'no-auth-key-001', repeat('e', 64))$$,
  '28000', 'authentication_required', 'commit without a user is 28000'
);
reset role;
set local role anon;
select throws_ok(
  $$select public.merge_preview(public.t_id('bA3'), public.t_id('pT'))$$,
  '42501', null, 'anon is denied merge_preview (42501)'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA3'), public.t_id('pT'), public.t_id('rA3'), 'Merge', '[]'::jsonb, 'anon-key-00001', repeat('e', 64))$$,
  '42501', null, 'anon is denied merge_commit (42501)'
);
reset role;

-- 14. Hidden source: before and after merging
update public.publications set moderation_state = 'hidden' where id = public.t_id('pB');
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.t_prev(public.t_id('bA3'), public.t_id('pB'))$$,
  'P0002', 'publication_not_found', 'preview of a hidden publication is publication_not_found'
);
select throws_ok(
  $$select public.t_merge(public.t_id('bA3'), public.t_id('pB'))$$,
  'P0002', 'publication_not_found', 'commit of a hidden publication is publication_not_found'
);
select is((public.get_branch_head(public.t_id('bA1')) ->> 'mergeSourceVisible')::boolean, false, 'merged branch: mergeSourceVisible is false once the source is hidden');
select is(public.get_branch_head(public.t_id('bA1')) ->> 'mergeSourcePublicationId', public.t_id('pB')::text, 'merged branch: mergeSourcePublicationId is kept after hiding');
select is(public.t_nfeat(public.t_id('bA1')), 2, 'merged branch: features unchanged after the source is hidden');
select is(public.t_nfeat(public.t_id('bA2')), 1, 'second merged branch: features unchanged after the source is hidden');
reset role;
select is((select count(*)::int from public.revision_features as f where f.revision_id = (public.t_doc('cm_demo') ->> 'revisionId')::uuid), 2, 'merged revision keeps its two feature rows after hiding the source');

-- 15. normalize_feature_input parity with save_revision
insert into ctx select 'pf_tab', null, public.t_canopy(public.t_uid('c2'), public.t_can(), 4.5, E'\t');
insert into ctx select 'pf_nbsp', null, public.t_canopy(public.t_uid('c2'), public.t_can(), 4.5, chr(160) || 'Cubierta' || chr(160));
insert into ctx select 'pf_parking', null, jsonb_build_object('id', public.t_uid('c2'), 'kind', 'parking_conversion', 'properties', '{}'::jsonb, 'geometry', public.t_can());
insert into ctx select 'pf_bowtie', null, public.t_canopy(public.t_uid('c2'), jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(jsonb_build_array(
  jsonb_build_array(-98.19800, 19.04345), jsonb_build_array(-98.19790, 19.04355), jsonb_build_array(-98.19790, 19.04345),
  jsonb_build_array(-98.19800, 19.04355), jsonb_build_array(-98.19800, 19.04345)))));
insert into ctx select 'pf_many', null, public.t_canopy(public.t_uid('c2'), jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array((
  select jsonb_agg(jsonb_build_array(round((-98.1980 + 0.00003 * cos(2 * pi() * i / 101))::numeric, 6), round((19.0436 + 0.00002 * sin(2 * pi() * i / 101))::numeric, 6)) order by i)
  from generate_series(0, 101) as g(i)))));
insert into ctx select 'pf_kind', null, jsonb_build_object('id', public.t_uid('c2'), 'kind', 'bogus', 'properties', '{}'::jsonb, 'geometry', public.t_can());
insert into ctx select 'pf_id', null, jsonb_build_object('id', 'nope', 'kind', 'shade_canopy', 'properties', '{}'::jsonb, 'geometry', public.t_can());
insert into ctx select 'pf_ok', null, public.t_canopy(public.t_uid('c2'), public.t_can());
insert into ctx select 'pf_outside', null, public.t_canopy(public.t_uid('c2'), public.t_rect(-98.0, 19.0, -97.9999, 19.0001));

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
insert into ctx select 'bPar', public.t_branch('Parity'), null;
select throws_ok($$select public.save_revision(public.t_id('bPar'), public.t_head(public.t_id('bPar')), 'x', jsonb_build_array(public.t_doc('pf_tab')), 'parity-key-001', repeat('b', 64))$$, 'FT422', 'invalid_feature_properties', 'save_revision rejects a tab-only label');
select throws_ok($$select public.save_revision(public.t_id('bPar'), public.t_head(public.t_id('bPar')), 'x', jsonb_build_array(public.t_doc('pf_nbsp')), 'parity-key-002', repeat('b', 64))$$, 'FT422', 'invalid_feature_properties', 'save_revision rejects an NBSP-padded label');
select throws_ok($$select public.save_revision(public.t_id('bPar'), public.t_head(public.t_id('bPar')), 'x', jsonb_build_array(public.t_doc('pf_parking')), 'parity-key-003', repeat('b', 64))$$, 'FT422', 'kind_not_supported', 'save_revision rejects parking_conversion');
select throws_ok($$select public.save_revision(public.t_id('bPar'), public.t_head(public.t_id('bPar')), 'x', jsonb_build_array(public.t_doc('pf_bowtie')), 'parity-key-004', repeat('b', 64))$$, 'FT422', 'invalid_geometry', 'save_revision rejects a self-intersecting polygon');
select throws_ok($$select public.save_revision(public.t_id('bPar'), public.t_head(public.t_id('bPar')), 'x', jsonb_build_array(public.t_doc('pf_many')), 'parity-key-005', repeat('b', 64))$$, 'FT422', 'too_many_vertices', 'save_revision rejects more than 100 vertices');
select throws_ok($$select public.save_revision(public.t_id('bPar'), public.t_head(public.t_id('bPar')), 'x', jsonb_build_array(public.t_doc('pf_kind')), 'parity-key-006', repeat('b', 64))$$, 'FT422', 'invalid_feature_kind', 'save_revision rejects an unknown kind');
select throws_ok($$select public.save_revision(public.t_id('bPar'), public.t_head(public.t_id('bPar')), 'x', jsonb_build_array(public.t_doc('pf_id')), 'parity-key-007', repeat('b', 64))$$, 'FT422', 'invalid_feature', 'save_revision rejects a non-uuid id');
reset role;

select throws_ok($$select * from public.normalize_feature_input(public.t_doc('pf_tab'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active))$$, 'FT422', 'invalid_feature_properties', 'normalize_feature_input rejects a tab-only label with the same message');
select throws_ok($$select * from public.normalize_feature_input(public.t_doc('pf_nbsp'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active))$$, 'FT422', 'invalid_feature_properties', 'normalize_feature_input rejects an NBSP-padded label with the same message');
select throws_ok($$select * from public.normalize_feature_input(public.t_doc('pf_parking'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active))$$, 'FT422', 'kind_not_supported', 'normalize_feature_input rejects parking_conversion with the same message');
select throws_ok($$select * from public.normalize_feature_input(public.t_doc('pf_bowtie'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active))$$, 'FT422', 'invalid_geometry', 'normalize_feature_input rejects a self-intersecting polygon with the same message');
select throws_ok($$select * from public.normalize_feature_input(public.t_doc('pf_many'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active))$$, 'FT422', 'too_many_vertices', 'normalize_feature_input rejects more than 100 vertices with the same message');
select throws_ok($$select * from public.normalize_feature_input(public.t_doc('pf_kind'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active))$$, 'FT422', 'invalid_feature_kind', 'normalize_feature_input rejects an unknown kind with the same message');
select throws_ok($$select * from public.normalize_feature_input(public.t_doc('pf_id'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active))$$, 'FT422', 'invalid_feature', 'normalize_feature_input rejects a non-uuid id with the same message');
select throws_ok($$select * from public.normalize_feature_input('null'::jsonb, (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active))$$, 'FT422', 'invalid_feature', 'normalize_feature_input rejects a JSON null');
select throws_ok($$select * from public.normalize_feature_input(public.t_doc('pf_outside'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active))$$, 'FT422', 'feature_outside_site', 'normalize_feature_input rejects a feature outside the site');
select is(
  (select n.kind::text from public.normalize_feature_input(public.t_doc('pf_ok'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active)) as n),
  'shade_canopy', 'normalize_feature_input accepts a valid canopy'
);
select is(
  (select n.feature_id from public.normalize_feature_input(public.t_doc('pf_ok'), (select boundary from public.site_baselines where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active)) as n),
  public.t_uid('c2')::uuid, 'normalize_feature_input returns the feature id'
);

-- 16. Regression cases for migration 20261123070000_merge_review_fixes
create function public.t_hasc(p_doc jsonb, p_id text) returns boolean language sql immutable as
$$ select exists (select 1 from jsonb_array_elements(p_doc -> 'conflicts') as c where c ->> 'id' = p_id) $$;

set local role authenticated;

-- Users: 02 publishes the sources, 01 owns the targets.
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);

-- Case 1 source: market M1 (slot X) over the canopy area
insert into ctx select 'bR2', public.t_branch('R source'), null;
insert into ctx select 'rR2', public.t_save(public.t_id('bR2'), jsonb_build_array(public.t_market(public.t_uid('b101'), public.t_mkt(), 'X'))), null;
insert into ctx select 'pR', public.t_pub(public.t_id('rR2')), null;

-- Case 2 source chain: shared ancestor publication has canopy C; later publication adds market M over it
insert into ctx select 'bU', public.t_branch('U chain'), null;
insert into ctx select 'rU1', public.t_save(public.t_id('bU'), jsonb_build_array(public.t_canopy(public.t_uid('c301'), public.t_can()))), null;
insert into ctx select 'pU1', public.t_pub(public.t_id('rU1')), null;
insert into ctx select 'rU2', public.t_save(public.t_id('bU'), jsonb_build_array(
  public.t_canopy(public.t_uid('c301'), public.t_can()), public.t_market(public.t_uid('d301'), public.t_mkt()))), null;
insert into ctx select 'pU2', public.t_pub(public.t_id('rU2')), null;

-- Case 4 source: private ancestor rQ1 (never published), source publication rQ2
insert into ctx select 'bQ', public.t_branch('Q private chain'), null;
insert into ctx select 'rQ1', public.t_save(public.t_id('bQ'), jsonb_build_array(
  public.t_tree(public.t_uid('f101'), public.t_p1(), 'Base'), public.t_tree(public.t_uid('f102'), public.t_p2(), 'Base'))), null;
insert into ctx select 'rQ2', public.t_save(public.t_id('bQ'), jsonb_build_array(public.t_tree(public.t_uid('f102'), public.t_p2(), 'Theirs'))), null;
insert into ctx select 'pQ2', public.t_pub(public.t_id('rQ2')), null;

-- Case 6 source chain
insert into ctx select 'bV', public.t_branch('V chain'), null;
insert into ctx select 'rV1', public.t_save(public.t_id('bV'), jsonb_build_array(
  public.t_canopy(public.t_uid('c601'), public.t_can()), public.t_canopy(public.t_uid('c602'), public.t_zone()))), null;
insert into ctx select 'pV1', public.t_pub(public.t_id('rV1')), null;
insert into ctx select 'rV2', public.t_save(public.t_id('bV'), jsonb_build_array(
  public.t_canopy(public.t_uid('c601'), public.t_can()), public.t_canopy(public.t_uid('c602'), public.t_zone()),
  public.t_tree(public.t_uid('e601'), public.t_p1()))), null;
insert into ctx select 'pV2', public.t_pub(public.t_id('rV2')), null;

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

-- Case 1 target: canopy C1 plus an unrelated market M2 (same slot X) elsewhere
insert into ctx select 'bR1', public.t_branch('R target'), null;
insert into ctx select 'rR1', public.t_save(public.t_id('bR1'), jsonb_build_array(
  public.t_canopy(public.t_uid('c101'), public.t_can()),
  public.t_market(public.t_uid('a202'), public.t_mkt_moved(), 'X'))), null;
-- Case 2 targets (forks of the shared publication)
insert into ctx select 'fU', (public.t_fork(public.t_id('pU1')) ->> 'branchId')::uuid, null;
insert into ctx select 'fU2', (public.t_fork(public.t_id('pU1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFU2', public.t_save(public.t_id('fU2'), jsonb_build_array(
  public.t_canopy(public.t_uid('c301'), public.t_can()),
  public.t_canopy(public.t_uid('c302'), public.t_rect(-98.19824, 19.04359, -98.19806, 19.04371)))), null;
-- Case 3 target: two overlapping canopies, both target-only
insert into ctx select 'bTW', public.t_branch('Two target canopies'), null;
insert into ctx select 'rTW', public.t_save(public.t_id('bTW'), jsonb_build_array(
  public.t_canopy(public.t_uid('c701'), public.t_zone()), public.t_canopy(public.t_uid('c702'), public.t_zone_inner()))), null;
-- Case 4 target branch (its chain is built directly below)
insert into ctx select 'bQT', public.t_branch('Q target'), null;
-- Case 5 target
insert into ctx select 'bH', public.t_branch('Head race'), null;
insert into ctx select 'rH', public.t_save(public.t_id('bH'), jsonb_build_array(public.t_canopy(public.t_uid('c501'), public.t_east()))), null;
-- Case 6 target: same canopies, reversed ring and rotated ring
insert into ctx select 'fV', (public.t_fork(public.t_id('pV1')) ->> 'branchId')::uuid, null;
insert into ctx select 'rFV', public.t_save(public.t_id('fV'), jsonb_build_array(
  public.t_canopy(public.t_uid('c601'), jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(jsonb_build_array(
    jsonb_build_array(-98.19825, 19.04358), jsonb_build_array(-98.19825, 19.04372), jsonb_build_array(-98.19805, 19.04372),
    jsonb_build_array(-98.19805, 19.04358), jsonb_build_array(-98.19825, 19.04358))))),
  public.t_canopy(public.t_uid('c602'), jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(jsonb_build_array(
    jsonb_build_array(-98.19790, 19.04345), jsonb_build_array(-98.19790, 19.04355), jsonb_build_array(-98.19800, 19.04355),
    jsonb_build_array(-98.19800, 19.04345), jsonb_build_array(-98.19790, 19.04345))))))), null;

-- Case 4 target chain built directly: head revision whose parent is the private rQ1
reset role;
insert into ctx select 'rQT1', gen_random_uuid(), null;
insert into public.revisions (id, branch_id, site_id, baseline_id, parent_revision_id, message, author_id)
select public.t_id('rQT1'), b.id, b.site_id, b.baseline_id, public.t_id('rQ1'), 'Fixture: child of a private revision', b.owner_id
from public.branches as b where b.id = public.t_id('bQT');
insert into public.revision_features (revision_id, site_id, feature_id, kind, properties, geometry)
select public.t_id('rQT1'), r.site_id, public.t_uid('f102')::uuid, 'shade_tree',
       jsonb_build_object('label', 'Mine', 'canopyDiameterM', 6, 'heightM', 8),
       extensions.st_setsrid(extensions.st_geomfromgeojson(public.t_p2()::text), 4326)
from public.revisions as r where r.id = public.t_id('rQT1');
update public.branches set current_revision_id = public.t_id('rQT1') where id = public.t_id('bQT');

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

-- Case 1: a redraw introduces a new blocking conflict, resolved in a second round
insert into ctx select 'pv_r0', null, public.t_prev(public.t_id('bR1'), public.t_id('pR'));
select is(jsonb_array_length(public.t_doc('pv_r0') -> 'conflicts'), 1, 'redraw-introduced: initial preview has one blocking conflict');
select is(public.t_doc('pv_r0') #>> '{conflicts,0,id}', 'spatial:' || public.t_uid('b101') || ':' || public.t_uid('c101'), 'redraw-introduced: initial conflict is C1/M1');
select is((public.t_doc('pv_r0') #>> '{conflicts,0,blocking}')::boolean, true, 'redraw-introduced: initial conflict is blocking');
select is(jsonb_array_length(public.t_doc('pv_r0') -> 'unresolved'), 1, 'redraw-introduced: initial conflict is unresolved');
select is(jsonb_array_length(public.t_doc('pv_r0') -> 'warnings'), 0, 'redraw-introduced: M2 does not overlap anything before the redraw');

insert into ctx select 'pv_r1', null, public.t_prev(public.t_id('bR1'), public.t_id('pR'),
  public.t_redraw('spatial:' || public.t_uid('b101') || ':' || public.t_uid('c101'),
    public.t_market(public.t_uid('b101'), public.t_mkt_moved(), 'X')));
select is(jsonb_array_length(public.t_doc('pv_r1') -> 'conflicts'), 2, 'redraw-introduced: conflicts lists the original and the new conflict');
select ok(public.t_hasc(public.t_doc('pv_r1'), 'spatial:' || public.t_uid('a202') || ':' || public.t_uid('b101')), 'redraw-introduced: new conflict M1/M2 is in conflicts');
select ok(public.t_hasc(public.t_doc('pv_r1'), 'spatial:' || public.t_uid('b101') || ':' || public.t_uid('c101')), 'redraw-introduced: original C1/M1 stays in conflicts');
select is(public.t_doc('pv_r1') -> 'unresolved', jsonb_build_array('spatial:' || public.t_uid('a202') || ':' || public.t_uid('b101')), 'redraw-introduced: only the new conflict is unresolved');
select ok(not (public.t_doc('pv_r1') -> 'unresolved' ? ('spatial:' || public.t_uid('b101') || ':' || public.t_uid('c101'))), 'redraw-introduced: original conflict is not unresolved');
select is(public.t_doc('pv_r1') -> 'invalidResolutions', '[]'::jsonb, 'redraw-introduced: first resolution is valid');
select throws_ok(
  $$select public.t_merge(public.t_id('bR1'), public.t_id('pR'), public.t_redraw('spatial:' || public.t_uid('b101') || ':' || public.t_uid('c101'), public.t_market(public.t_uid('b101'), public.t_mkt_moved(), 'X')))$$,
  'FT422', 'unresolved_conflicts', 'redraw-introduced: commit with only the first resolution is unresolved_conflicts'
);

insert into ctx select 'pv_r2', null, public.t_prev(public.t_id('bR1'), public.t_id('pR'),
  public.t_redraw('spatial:' || public.t_uid('b101') || ':' || public.t_uid('c101'), public.t_market(public.t_uid('b101'), public.t_mkt_moved(), 'X'))
  || public.t_rm('spatial:' || public.t_uid('a202') || ':' || public.t_uid('b101'), public.t_uid('a202')));
select is(public.t_doc('pv_r2') -> 'unresolved', '[]'::jsonb, 'redraw-introduced: second resolution leaves nothing unresolved');
select is(public.t_doc('pv_r2') -> 'invalidResolutions', '[]'::jsonb, 'redraw-introduced: no invalid resolutions after the second resolution');
select is(jsonb_array_length(public.t_doc('pv_r2') -> 'conflicts'), 2, 'redraw-introduced: both conflicts are still reported');
select is((public.t_doc('pv_r2') ->> 'featureCount')::int, 2, 'redraw-introduced: M2 removed leaves canopy and redrawn market');

insert into ctx select 'cm_r', null, public.t_merge(public.t_id('bR1'), public.t_id('pR'),
  public.t_redraw('spatial:' || public.t_uid('b101') || ':' || public.t_uid('c101'), public.t_market(public.t_uid('b101'), public.t_mkt_moved(), 'X'))
  || public.t_rm('spatial:' || public.t_uid('a202') || ':' || public.t_uid('b101'), public.t_uid('a202')));
select is((public.t_doc('cm_r') ->> 'featureCount')::int, 2, 'redraw-introduced: commit with both resolutions succeeds');
select is((public.t_doc('cm_r') ->> 'conflictCount')::int, 2, 'redraw-introduced: commit records both conflicts');

-- Alternative second resolution: redraw M1 elsewhere instead of removing M2
insert into ctx select 'bR3', public.t_branch('R target 2'), null;
insert into ctx select 'rR3', public.t_save(public.t_id('bR3'), jsonb_build_array(
  public.t_canopy(public.t_uid('c101'), public.t_can()),
  public.t_market(public.t_uid('a202'), public.t_mkt_moved(), 'X'))), null;
insert into ctx select 'pv_r3', null, public.t_prev(public.t_id('bR3'), public.t_id('pR'),
  public.t_redraw('spatial:' || public.t_uid('b101') || ':' || public.t_uid('c101'), public.t_market(public.t_uid('b101'), public.t_mkt_moved(), 'X'))
  || public.t_redraw('spatial:' || public.t_uid('a202') || ':' || public.t_uid('b101'), public.t_market(public.t_uid('b101'), public.t_rect(-98.19760, 19.04362, -98.19750, 19.04368), 'X')));
select is(public.t_doc('pv_r3') -> 'unresolved', '[]'::jsonb, 'redraw-introduced: redrawing M1 elsewhere also resolves it');
select is(public.t_doc('pv_r3') -> 'invalidResolutions', '[]'::jsonb, 'redraw-introduced: redrawing M1 elsewhere has no invalid resolutions');
select is((public.t_doc('pv_r3') ->> 'featureCount')::int, 3, 'redraw-introduced: redrawing M1 elsewhere keeps all three features');

-- Case 2: blocking rule
insert into ctx select 'pv_u', null, public.t_prev(public.t_id('fU'), public.t_id('pU2'));
select is(public.t_doc('pv_u') #>> '{ancestor,kind}', 'publication', 'unchanged-vs-source: ancestor is the shared publication');
select is(jsonb_array_length(public.t_doc('pv_u') -> 'conflicts'), 0, 'unchanged-vs-source: C/M is not in conflicts');
select is(jsonb_array_length(public.t_doc('pv_u') -> 'unresolved'), 0, 'unchanged-vs-source: C/M is not unresolved');
select is(jsonb_array_length(public.t_doc('pv_u') -> 'warnings'), 1, 'unchanged-vs-source: C/M is a warning');
select is(public.t_doc('pv_u') #>> '{warnings,0,id}', 'spatial:' || public.t_uid('c301') || ':' || public.t_uid('d301'), 'unchanged-vs-source: the warning is the C/M pair');
select is((public.t_doc('pv_u') #>> '{warnings,0,blocking}')::boolean, false, 'unchanged-vs-source: the warning is not blocking');
insert into ctx select 'cm_u', null, public.t_merge(public.t_id('fU'), public.t_id('pU2'));
select is((public.t_doc('cm_u') ->> 'featureCount')::int, 2, 'unchanged-vs-source: commit succeeds without resolutions');

insert into ctx select 'pv_u2', null, public.t_prev(public.t_id('fU2'), public.t_id('pU2'));
select is(jsonb_array_length(public.t_doc('pv_u2') -> 'conflicts'), 1, 'target-added canopy vs source-added market: exactly one conflict');
select is(public.t_doc('pv_u2') #>> '{conflicts,0,id}', 'spatial:' || public.t_uid('c302') || ':' || public.t_uid('d301'), 'target-added canopy vs source-added market: the pair blocks');
select is((public.t_doc('pv_u2') #>> '{conflicts,0,blocking}')::boolean, true, 'target-added canopy vs source-added market: blocking');
select is(jsonb_array_length(public.t_doc('pv_u2') -> 'warnings'), 2, 'target-added canopy vs source-added market: the two same-side pairs are warnings');

-- Case 3: non-blocking overlaps are warnings only
insert into ctx select 'pv_tw', null, public.t_prev(public.t_id('bTW'), public.t_id('pT'));
select is(jsonb_array_length(public.t_doc('pv_tw') -> 'conflicts'), 0, 'target-only overlap: not in conflicts');
select is(jsonb_array_length(public.t_doc('pv_tw') -> 'unresolved'), 0, 'target-only overlap: not unresolved');
select is(jsonb_array_length(public.t_doc('pv_tw') -> 'warnings'), 1, 'target-only overlap: listed in warnings');
select is(public.t_doc('pv_tw') #>> '{warnings,0,id}', 'spatial:' || public.t_uid('c701') || ':' || public.t_uid('c702'), 'target-only overlap: the warning is the canopy pair');

-- Case 4: private ancestor
insert into ctx select 'pv_q', null, public.t_prev(public.t_id('bQT'), public.t_id('pQ2'));
select is(public.t_doc('pv_q') #>> '{ancestor,kind}', 'private_revision', 'private ancestor: kind is private_revision');
select is(public.t_doc('pv_q') #> '{ancestor,revisionId}', 'null'::jsonb, 'private ancestor: revision id is not exposed');
select is(public.t_doc('pv_q') #> '{ancestor,publicationId}', 'null'::jsonb, 'private ancestor: no publication id');
select is(
  (select count(*)::int from jsonb_array_elements(public.t_doc('pv_q') -> 'operations') as o where o ->> 'featureId' = public.t_uid('f101')),
  0, 'private ancestor: feature deleted on both sides is not in operations'
);
select is(public.t_doc('pv_q') #>> '{conflicts,0,id}', 'element:' || public.t_uid('f102'), 'private ancestor: the edit/edit conflict is still reported');
select is(public.t_doc('pv_q') #> '{conflicts,0,ancestor}', 'null'::jsonb, 'private ancestor: conflict ancestor is null');
select is(public.t_doc('pv_q') #>> '{conflicts,0,target,properties,label}', 'Mine', 'private ancestor: target side still shown');
select is(public.t_doc('pv_q') #>> '{conflicts,0,source,properties,label}', 'Theirs', 'private ancestor: source side still shown');

-- Case 5: stale head takes precedence over already_merged
insert into ctx select 'h5', public.t_head(public.t_id('bH')), null;
insert into ctx select 'cm_h', null, public.merge_commit(public.t_id('bH'), public.t_id('pT'), public.t_id('h5'), 'Merge first', '[]'::jsonb, 'stale-first-key-1', repeat('e', 64));
select is((public.t_doc('cm_h') ->> 'featureCount')::int, 2, 'stale head: first merge succeeds');
select throws_ok(
  $$select public.merge_commit(public.t_id('bH'), public.t_id('pT'), public.t_id('h5'), 'Merge again', '[]'::jsonb, 'stale-second-key-2', repeat('e', 64))$$,
  'FT409', 'stale_head', 'stale head: a new key with the old expected head is stale_head, not already_merged'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bH'), public.t_id('pT'), public.t_head(public.t_id('bH')), 'Merge again', '[]'::jsonb, 'stale-third-key-3', repeat('e', 64))$$,
  'FT422', 'already_merged', 'stale head: a new key with the current head is already_merged'
);
select is(
  public.merge_commit(public.t_id('bH'), public.t_id('pT'), public.t_id('h5'), 'Merge first', '[]'::jsonb, 'stale-first-key-1', repeat('e', 64)),
  public.t_doc('cm_h'), 'stale head: replay of the first key still returns the stored response'
);

-- Case 6: exact equality. Reversed or rotated rings are target changes.
insert into ctx select 'pv_v', null, public.t_prev(public.t_id('fV'), public.t_id('pV2'));
select ok(public.t_doc('pv_v') -> 'operations' @> jsonb_build_array(jsonb_build_object('featureId', public.t_uid('c601'), 'decision', 'target')), 'exact equality: reversed ring is a target change');
select ok(public.t_doc('pv_v') -> 'operations' @> jsonb_build_array(jsonb_build_object('featureId', public.t_uid('c602'), 'decision', 'target')), 'exact equality: rotated ring is a target change');
select is(jsonb_array_length(public.t_doc('pv_v') -> 'conflicts'), 0, 'exact equality: no conflict from the ring change');
insert into ctx select 'cm_v', null, public.t_merge(public.t_id('fV'), public.t_id('pV2'));
select is((public.t_doc('cm_v') ->> 'featureCount')::int, 3, 'exact equality: commit keeps both canopies and the source tree');
reset role;
select is(
  (select extensions.st_asewkb(m.geometry) from public.revision_features as m where m.revision_id = (public.t_doc('cm_v') ->> 'revisionId')::uuid and m.feature_id = public.t_uid('c601')::uuid),
  (select extensions.st_asewkb(t.geometry) from public.revision_features as t where t.revision_id = public.t_id('rFV') and t.feature_id = public.t_uid('c601')::uuid),
  'exact equality: the merged reversed ring is the target EWKB, not the ancestor one'
);
select is(
  (select extensions.st_asewkb(m.geometry) from public.revision_features as m where m.revision_id = (public.t_doc('cm_v') ->> 'revisionId')::uuid and m.feature_id = public.t_uid('c602')::uuid),
  (select extensions.st_asewkb(t.geometry) from public.revision_features as t where t.revision_id = public.t_id('rFV') and t.feature_id = public.t_uid('c602')::uuid),
  'exact equality: the merged rotated ring is the target EWKB, not the ancestor one'
);

-- Case 7: resolutions larger than 512 KiB
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.merge_preview(public.t_id('bA3'), public.t_id('pT'), jsonb_build_array(jsonb_build_object('conflictId', repeat('x', 600000), 'action', 'remove')))$$,
  '22023', 'invalid_merge_request', 'merge_preview rejects resolutions over 512 KiB'
);
select lives_ok(
  $$select public.merge_preview(public.t_id('bA3'), public.t_id('pT'), jsonb_build_array(jsonb_build_object('conflictId', repeat('x', 500000), 'action', 'remove')))$$,
  'merge_preview accepts resolutions just under 512 KiB'
);
select throws_ok(
  $$select public.merge_commit(public.t_id('bA3'), public.t_id('pT'), public.t_id('rA3'), 'Merge', jsonb_build_array(jsonb_build_object('conflictId', repeat('x', 600000), 'action', 'remove')), 'big-res-key-001', repeat('e', 64))$$,
  '22023', 'invalid_merge_request', 'merge_commit rejects resolutions over 512 KiB'
);
reset role;

select * from finish();
rollback;
