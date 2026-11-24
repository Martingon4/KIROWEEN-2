begin;

select plan(113);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- 1. Grants and volatility
select is(has_function_privilege('anon', 'public.compare_revisions(text,text,text)', 'EXECUTE'), true, 'anon can execute compare_revisions');
select is(has_function_privilege('authenticated', 'public.compare_revisions(text,text,text)', 'EXECUTE'), true, 'authenticated can execute compare_revisions');
select is(has_function_privilege('public', 'public.compare_revisions(text,text,text)', 'EXECUTE'), false, 'public pseudo-role cannot execute compare_revisions');
select is((select p.provolatile::text from pg_proc as p where p.oid = 'public.compare_revisions(text,text,text)'::regprocedure), 's', 'compare_revisions is STABLE');
select is_definer('public', 'compare_revisions', array['text', 'text', 'text'], 'compare_revisions is security definer');
select function_returns('public', 'compare_revisions', array['text', 'text', 'text'], 'jsonb', 'compare_revisions returns jsonb');
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc as p where p.oid = 'public.compare_revisions(text,text,text)'::regprocedure),
  'compare_revisions pins an empty search_path'
);

-- 2. Setup: users, two published revisions of one branch, a third unpublished branch
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  ('94000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('94000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

insert into ctx (name, id, doc)
select 'baseline', id, null from public.site_baselines
where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active;

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

insert into ctx (name, id, doc)
select 'bA', (r ->> 'branchId')::uuid, r
from (select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Compare A', 'cmp-branch-key-1', repeat('a', 64)) as r) s;

-- Revision A: F1 canopy, F2 tree, F3 market (removed later), F5 crossing (stays equal)
insert into ctx (name, id, doc)
select 'rA', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'bA'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'bA'),
    'Revision A',
    '[{"id":"94000000-0000-4000-8000-0000000000f1","kind":"shade_canopy","properties":{"label":"Canopy","heightM":4.5},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}},
      {"id":"94000000-0000-4000-8000-0000000000f2","kind":"shade_tree","properties":{"label":"Tree","canopyDiameterM":6,"heightM":8},"geometry":{"type":"Point","coordinates":[-98.19775,19.0436]}},
      {"id":"94000000-0000-4000-8000-0000000000f3","kind":"temporary_market","properties":{"label":"Market A","stallCount":10,"moduleM2":4,"timeSlot":"Mañana"},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04375],[-98.19805,19.04375],[-98.19805,19.04385],[-98.19825,19.04385],[-98.19825,19.04375]]]}},
      {"id":"94000000-0000-4000-8000-0000000000f5","kind":"proposed_crossing","properties":{"label":"Crossing","widthM":4},"geometry":{"type":"LineString","coordinates":[[-98.19825,19.0436],[-98.19805,19.0436]]}}]'::jsonb,
    'cmp-save-key-001', repeat('1', 64)) as r
) s;
insert into ctx (name, id, doc)
select 'pA', (r ->> 'publicationId')::uuid, r
from (select public.publish_revision((select id from ctx where name = 'rA'), 'Pub A', 'First version', 'cmp-pub-key-0001', repeat('2', 64)) as r) s;

-- Revision B (same branch): F1 only heightM changes; F2 only geometry changes;
-- F3 removed; F4 added; F5 unchanged.
insert into ctx (name, id, doc)
select 'rB', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'bA'),
    (select id from ctx where name = 'rA'),
    'Revision B',
    '[{"id":"94000000-0000-4000-8000-0000000000f1","kind":"shade_canopy","properties":{"label":"Canopy","heightM":6},"geometry":{"type":"Polygon","coordinates":[[[-98.19825,19.04358],[-98.19805,19.04358],[-98.19805,19.04372],[-98.19825,19.04372],[-98.19825,19.04358]]]}},
      {"id":"94000000-0000-4000-8000-0000000000f2","kind":"shade_tree","properties":{"label":"Tree","canopyDiameterM":6,"heightM":8},"geometry":{"type":"Point","coordinates":[-98.19770,19.0436]}},
      {"id":"94000000-0000-4000-8000-0000000000f4","kind":"temporary_market","properties":{"label":"Market C","stallCount":5,"moduleM2":2,"timeSlot":"Tarde"},"geometry":{"type":"Polygon","coordinates":[[[-98.19800,19.04345],[-98.19790,19.04345],[-98.19790,19.04355],[-98.19800,19.04355],[-98.19800,19.04345]]]}},
      {"id":"94000000-0000-4000-8000-0000000000f5","kind":"proposed_crossing","properties":{"label":"Crossing","widthM":4},"geometry":{"type":"LineString","coordinates":[[-98.19825,19.0436],[-98.19805,19.0436]]}}]'::jsonb,
    'cmp-save-key-002', repeat('3', 64)) as r
) s;
insert into ctx (name, id, doc)
select 'pB', (r ->> 'publicationId')::uuid, r
from (select public.publish_revision((select id from ctx where name = 'rB'), 'Pub B', 'Second version', 'cmp-pub-key-0002', repeat('4', 64)) as r) s;

-- Branch C: canopy near the east tip so the two scenarios give different shade
insert into ctx (name, id, doc)
select 'bC', (r ->> 'branchId')::uuid, r
from (select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Edge canopy', 'cmp-branch-key-3', repeat('c', 64)) as r) s;
insert into ctx (name, id, doc)
select 'rC', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'bC'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'bC'),
    'Edge canopy',
    '[{"id":"94000000-0000-4000-8000-0000000000c1","kind":"shade_canopy","properties":{"label":"Edge canopy","heightM":6},"geometry":{"type":"Polygon","coordinates":[[[-98.19739,19.04357],[-98.19735,19.04357],[-98.19735,19.04363],[-98.19739,19.04363],[-98.19739,19.04357]]]}}]'::jsonb,
    'cmp-save-key-003', repeat('5', 64)) as r
) s;

-- Another participant with one own revision
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
insert into ctx (name, id, doc)
select 'bU2', (r ->> 'branchId')::uuid, r
from (select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', 'Other user branch', 'cmp-branch-key-4', repeat('d', 64)) as r) s;
insert into ctx (name, id, doc)
select 'rU2', (r ->> 'revisionId')::uuid, r
from (
  select public.save_revision(
    (select id from ctx where name = 'bU2'),
    (select (doc ->> 'revisionId')::uuid from ctx where name = 'bU2'),
    'Other revision',
    '[{"id":"94000000-0000-4000-8000-0000000000d1","kind":"shade_tree","properties":{"label":"Tree","canopyDiameterM":6,"heightM":8},"geometry":{"type":"Point","coordinates":[-98.19775,19.0436]}}]'::jsonb,
    'cmp-save-key-004', repeat('6', 64)) as r
) s;

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
reset role;

-- Row counts before any compare call (measured as postgres; the tables deny anon)
insert into ctx (name, id, doc)
select 'counts_before', null, jsonb_build_object(
  'revisions', (select count(*) from public.revisions),
  'features', (select count(*) from public.revision_features),
  'publications', (select count(*) from public.publications));

-- 3. Compare calls (authenticated, user 1)
set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

insert into ctx (name, id, doc) select 'self', null, public.compare_revisions('publication:' || (select id from ctx where name = 'pA'), 'publication:' || (select id from ctx where name = 'pA'));
insert into ctx (name, id, doc) select 'base_pub', null, public.compare_revisions('baseline:' || (select id from ctx where name = 'baseline'), 'publication:' || (select id from ctx where name = 'pA'));
insert into ctx (name, id, doc) select 'mod', null, public.compare_revisions('publication:' || (select id from ctx where name = 'pA'), 'publication:' || (select id from ctx where name = 'pB'));
insert into ctx (name, id, doc) select 'mod_rev', null, public.compare_revisions('publication:' || (select id from ctx where name = 'pB'), 'publication:' || (select id from ctx where name = 'pA'));
insert into ctx (name, id, doc) select 'own_rev', null, public.compare_revisions('revision:' || (select id from ctx where name = 'rA'), 'baseline:' || (select id from ctx where name = 'baseline'));
insert into ctx (name, id, doc) select 'sc1000', null, public.compare_revisions('baseline:' || (select id from ctx where name = 'baseline'), 'revision:' || (select id from ctx where name = 'rC'), 'equinox-1000');
insert into ctx (name, id, doc) select 'sc1600', null, public.compare_revisions('baseline:' || (select id from ctx where name = 'baseline'), 'revision:' || (select id from ctx where name = 'rC'), 'equinox-1600');
reset role;

-- 4. Self-comparison of a publication
select is((select doc #>> '{counts,equal}' from ctx where name = 'self')::int, 4, 'self: counts.equal equals the feature count');
select is(
  (select (doc -> 'counts') - 'equal' from ctx where name = 'self'),
  '{"added":0,"removed":0,"modified":0}'::jsonb,
  'self: added, removed and modified are all 0'
);
select is((select doc -> 'features' from ctx where name = 'self'), '[]'::jsonb, 'self: features[] is empty (equal rows are omitted)');
select is(
  (select count(*) from ctx c, jsonb_each_text(c.doc -> 'metricDeltas') as e where c.name = 'self' and e.value::numeric = 0),
  4::bigint, 'self: all four metricDeltas are 0'
);
select is(
  (select count(*) from ctx c, jsonb_object_keys(c.doc -> 'metricDeltas') where c.name = 'self'),
  4::bigint, 'self: metricDeltas has exactly four keys'
);
select is((select doc -> 'costDelta' from ctx where name = 'self'), '{"totalLowCents":0,"totalHighCents":0}'::jsonb, 'self: costDelta is {0,0}');
select is((select doc -> 'catalogCompatible' from ctx where name = 'self'), 'true'::jsonb, 'self: catalogCompatible is true');
select is((select doc #>> '{left,refKind}' from ctx where name = 'self'), 'publication', 'self: left refKind is publication');
select is((select doc #>> '{left,label}' from ctx where name = 'self'), 'Pub A', 'self: left label is the public label');
select is((select doc #>> '{scenario,slug}' from ctx where name = 'self'), 'equinox-1000', 'self: the default scenario is used when none is given');
select is((select doc ->> 'engineVersion' from ctx where name = 'self'), 'ft-analysis@1', 'self: engineVersion is reported');
select is((select doc ->> 'siteId' from ctx where name = 'self'), '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'self: siteId is the pilot site');
select is((select doc ->> 'baselineId' from ctx where name = 'self'), (select id::text from ctx where name = 'baseline'), 'self: baselineId is the active baseline');
select ok((select (doc #>> '{left,cost,totalLowCents}')::bigint > 0 from ctx where name = 'self'), 'self: the fixture revision has a positive priced cost (deltas are not trivially 0)');

-- 5. Baseline versus publication
select is((select doc #>> '{counts,added}' from ctx where name = 'base_pub')::int, 4, 'baseline vs publication: counts.added equals the feature count');
select is(
  (select (doc -> 'counts') - 'added' from ctx where name = 'base_pub'),
  '{"equal":0,"removed":0,"modified":0}'::jsonb,
  'baseline vs publication: equal, removed and modified are 0'
);
select is((select jsonb_array_length(doc -> 'features') from ctx where name = 'base_pub'), 4, 'baseline vs publication: features[] lists every added feature');
select is(
  (select count(*) from ctx c, jsonb_array_elements(c.doc -> 'features') f
    where c.name = 'base_pub' and f ->> 'class' = 'added' and f -> 'left' = 'null'::jsonb and f -> 'right' <> 'null'::jsonb),
  4::bigint, 'baseline vs publication: every added row has left null and right populated'
);
select is(
  (select count(*) from ctx c, jsonb_array_elements(c.doc -> 'features') f
    where c.name = 'base_pub' and f -> 'geometryChanged' = 'null'::jsonb),
  4::bigint, 'baseline vs publication: geometryChanged is null for added rows'
);
select is(
  (select doc -> 'costDelta' from ctx where name = 'base_pub'),
  (select jsonb_build_object('totalLowCents', doc #> '{right,cost,totalLowCents}', 'totalHighCents', doc #> '{right,cost,totalHighCents}') from ctx where name = 'base_pub'),
  'baseline vs publication: costDelta equals the right totals'
);
select is((select doc -> 'catalogCompatible' from ctx where name = 'base_pub'), 'true'::jsonb, 'baseline vs publication: compatible because the baseline has zero cost lines');
select is((select doc #>> '{left,label}' from ctx where name = 'base_pub'), 'baseline', 'baseline vs publication: left label is baseline');
select is((select doc #>> '{left,refKind}' from ctx where name = 'base_pub'), 'baseline', 'baseline vs publication: left refKind is baseline');
select is((select doc #>> '{right,label}' from ctx where name = 'base_pub'), 'Pub A', 'baseline vs publication: right label is the public label');
select is((select jsonb_array_length(doc #> '{left,cost,lines}') from ctx where name = 'base_pub'), 0, 'baseline vs publication: the baseline has no cost lines');
select is(
  (select doc #>> '{metricDeltas,shadeM2}' from ctx where name = 'base_pub')::numeric,
  (select round((doc #>> '{right,analysis,shade,m2}')::numeric - (doc #>> '{left,analysis,shade,m2}')::numeric, 2) from ctx where name = 'base_pub'),
  'baseline vs publication: shadeM2 delta is right minus left'
);

-- 6. Modified, removed and added rows
select is((select doc -> 'counts' from ctx where name = 'mod'), '{"equal":1,"added":1,"removed":1,"modified":2}'::jsonb, 'mod: counts are 1 equal, 1 added, 1 removed, 2 modified');
select is((select jsonb_array_length(doc -> 'features') from ctx where name = 'mod'), 4, 'mod: features[] holds only the four non-equal rows');
select is(
  (select count(*) from ctx c, jsonb_array_elements(c.doc -> 'features') f where c.name = 'mod' and f ->> 'id' = '94000000-0000-4000-8000-0000000000f5'),
  0::bigint, 'mod: the unchanged crossing is not listed'
);
select is(
  (select array_agg(f ->> 'id' order by ord) from ctx c, jsonb_array_elements(c.doc -> 'features') with ordinality as t(f, ord) where c.name = 'mod'),
  array['94000000-0000-4000-8000-0000000000f1', '94000000-0000-4000-8000-0000000000f2', '94000000-0000-4000-8000-0000000000f3', '94000000-0000-4000-8000-0000000000f4'],
  'mod: features are ordered by id'
);

create temp table f1 as select f from ctx c, jsonb_array_elements(c.doc -> 'features') f where c.name = 'mod' and f ->> 'id' = '94000000-0000-4000-8000-0000000000f1';
create temp table f2 as select f from ctx c, jsonb_array_elements(c.doc -> 'features') f where c.name = 'mod' and f ->> 'id' = '94000000-0000-4000-8000-0000000000f2';
create temp table f3 as select f from ctx c, jsonb_array_elements(c.doc -> 'features') f where c.name = 'mod' and f ->> 'id' = '94000000-0000-4000-8000-0000000000f3';
create temp table f4 as select f from ctx c, jsonb_array_elements(c.doc -> 'features') f where c.name = 'mod' and f ->> 'id' = '94000000-0000-4000-8000-0000000000f4';

-- (a) only heightM changed
select is((select f ->> 'class' from f1), 'modified', 'mod F1 (heightM only): class is modified');
select is((select f -> 'propertiesChanged' from f1), 'true'::jsonb, 'mod F1: propertiesChanged is true');
select is((select f -> 'geometryChanged' from f1), 'false'::jsonb, 'mod F1: geometryChanged is false');
select is((select f -> 'kindChanged' from f1), 'false'::jsonb, 'mod F1: kindChanged is false');
select is((select f -> 'changedKeys' from f1), '["heightM"]'::jsonb, 'mod F1: changedKeys is ["heightM"]');
select is((select f #>> '{left,properties,heightM}' from f1), '4.5', 'mod F1: left heightM is 4.5');
select is((select f #>> '{right,properties,heightM}' from f1), '6', 'mod F1: right heightM is 6');
-- (b) only geometry changed
select is((select f ->> 'class' from f2), 'modified', 'mod F2 (geometry only): class is modified');
select is((select f -> 'geometryChanged' from f2), 'true'::jsonb, 'mod F2: geometryChanged is true');
select is((select f -> 'propertiesChanged' from f2), 'false'::jsonb, 'mod F2: propertiesChanged is false');
select is((select f -> 'changedKeys' from f2), '[]'::jsonb, 'mod F2: changedKeys is []');
select isnt((select f #> '{left,geometry}' from f2), (select f #> '{right,geometry}' from f2), 'mod F2: left and right geometries differ');
-- removed
select is((select f ->> 'class' from f3), 'removed', 'mod F3: class is removed');
select is((select f -> 'right' from f3), 'null'::jsonb, 'mod F3: right is null');
select is((select f #>> '{left,kind}' from f3), 'temporary_market', 'mod F3: left carries the removed kind');
select is((select f -> 'geometryChanged' from f3), 'null'::jsonb, 'mod F3: geometryChanged is null');
-- added
select is((select f ->> 'class' from f4), 'added', 'mod F4: class is added');
select is((select f -> 'left' from f4), 'null'::jsonb, 'mod F4: left is null');
select is((select f #>> '{right,kind}' from f4), 'temporary_market', 'mod F4: right carries the added kind');
-- swapping sides swaps added and removed
select is((select doc -> 'counts' from ctx where name = 'mod_rev'), '{"equal":1,"added":1,"removed":1,"modified":2}'::jsonb, 'mod reversed: counts keep the same shape');
select is(
  (select f ->> 'class' from ctx c, jsonb_array_elements(c.doc -> 'features') f where c.name = 'mod_rev' and f ->> 'id' = '94000000-0000-4000-8000-0000000000f3'),
  'added', 'mod reversed: F3 becomes added'
);
select is(
  (select f ->> 'class' from ctx c, jsonb_array_elements(c.doc -> 'features') f where c.name = 'mod_rev' and f ->> 'id' = '94000000-0000-4000-8000-0000000000f4'),
  'removed', 'mod reversed: F4 becomes removed'
);
select is((select doc -> 'catalogCompatible' from ctx where name = 'mod'), 'true'::jsonb, 'mod: both publications pin the same catalog');
select is(
  (select doc -> 'costDelta' from ctx where name = 'mod'),
  (select jsonb_build_object(
      'totalLowCents', (doc #>> '{right,cost,totalLowCents}')::bigint - (doc #>> '{left,cost,totalLowCents}')::bigint,
      'totalHighCents', (doc #>> '{right,cost,totalHighCents}')::bigint - (doc #>> '{left,cost,totalHighCents}')::bigint)
    from ctx where name = 'mod'),
  'mod: costDelta is right minus left'
);

-- 7. Own revision refs
select is((select doc #>> '{left,label}' from ctx where name = 'own_rev'), 'Compare A', 'own revision: label is the branch title');
select is((select doc #>> '{left,refKind}' from ctx where name = 'own_rev'), 'revision', 'own revision: refKind is revision');
select is((select doc #>> '{right,label}' from ctx where name = 'own_rev'), 'baseline', 'own revision vs baseline: right label is baseline');
select is((select doc #>> '{counts,removed}' from ctx where name = 'own_rev')::int, 4, 'own revision vs baseline: every feature is removed');

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select throws_ok(
  format($$select public.compare_revisions('revision:%s', 'revision:%s')$$, (select id from ctx where name = 'rA'), (select id from ctx where name = 'rU2')),
  'P0002', 'snapshot_not_found', 'another user''s revision as right ref is not found'
);
select throws_ok(
  format($$select public.compare_revisions('revision:%s', 'revision:%s')$$, (select id from ctx where name = 'rU2'), (select id from ctx where name = 'rA')),
  'P0002', 'snapshot_not_found', 'another user''s revision as left ref is not found'
);
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
select lives_ok(
  format($$select public.compare_revisions('revision:%s', 'baseline:%s')$$, (select id from ctx where name = 'rU2'), (select id from ctx where name = 'baseline')),
  'the owner can compare their own revision'
);
select throws_ok(
  format($$select public.compare_revisions('revision:%s', 'baseline:%s')$$, (select id from ctx where name = 'rA'), (select id from ctx where name = 'baseline')),
  'P0002', 'snapshot_not_found', 'user 2 cannot compare user 1''s revision'
);
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
reset role;

-- 8. Anonymous access and moderation
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
insert into ctx (name, id, doc) select 'anon_pubs', null, public.compare_revisions('publication:' || (select id from ctx where name = 'pA'), 'publication:' || (select id from ctx where name = 'pB'));
insert into ctx (name, id, doc) select 'anon_base', null, public.compare_revisions('baseline:' || (select id from ctx where name = 'baseline'), 'publication:' || (select id from ctx where name = 'pB'));
select throws_ok(
  format($$select public.compare_revisions('revision:%s', 'baseline:%s')$$, (select id from ctx where name = 'rA'), (select id from ctx where name = 'baseline')),
  'P0002', 'snapshot_not_found', 'anon cannot resolve a revision ref'
);
reset role;
select is((select doc -> 'counts' from ctx where name = 'anon_pubs'), '{"equal":1,"added":1,"removed":1,"modified":2}'::jsonb, 'anon compares two publications successfully');
select is((select doc -> 'features' from ctx where name = 'anon_pubs'), (select doc -> 'features' from ctx where name = 'mod'), 'anon and authenticated get the same feature diff');
select is((select doc #>> '{right,label}' from ctx where name = 'anon_base'), 'Pub B', 'anon baseline vs publication: right label is the public label');
select is((select doc #>> '{counts,added}' from ctx where name = 'anon_base')::int, 4, 'anon baseline vs publication: counts.added is 4');

-- 9. Malformed refs and unknown scenario
set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.compare_revisions('x', 'x')$$, '22023', 'invalid_snapshot_ref', 'ref "x" is invalid');
select throws_ok($$select public.compare_revisions('publication:not-a-uuid', 'publication:not-a-uuid')$$, '22023', 'invalid_snapshot_ref', 'ref with a non-uuid id is invalid');
select throws_ok(
  format($$select public.compare_revisions('publication:%s:junk', 'publication:%s')$$, (select id from ctx where name = 'pA'), (select id from ctx where name = 'pA')),
  '22023', 'invalid_snapshot_ref', 'a left ref with trailing junk is invalid'
);
select throws_ok(
  format($$select public.compare_revisions('publication:%s', 'publication:%s:junk')$$, (select id from ctx where name = 'pA'), (select id from ctx where name = 'pA')),
  '22023', 'invalid_snapshot_ref', 'a right ref with trailing junk is invalid'
);
select throws_ok(
  format($$select public.compare_revisions('foo:%s', 'publication:%s')$$, (select id from ctx where name = 'pA'), (select id from ctx where name = 'pA')),
  '22023', 'invalid_snapshot_ref', 'an unknown ref prefix is invalid'
);
select throws_ok($$select public.compare_revisions(null, null)$$, '22023', 'invalid_snapshot_ref', 'null refs are invalid');
select throws_ok(
  format($$select public.compare_revisions('publication:%s', 'publication:%s', 'no-such-scenario')$$, (select id from ctx where name = 'pA'), (select id from ctx where name = 'pA')),
  '22023', 'invalid_scenario', 'an unknown scenario slug is rejected'
);
select throws_ok(
  format($$select public.compare_revisions('publication:%s', 'publication:%s', '')$$, (select id from ctx where name = 'pA'), (select id from ctx where name = 'pA')),
  '22023', 'invalid_scenario', 'an empty scenario slug is rejected'
);
select throws_ok(
  $$select public.compare_revisions('publication:00000000-0000-4000-8000-000000000000', 'publication:00000000-0000-4000-8000-000000000000')$$,
  'P0002', 'snapshot_not_found', 'a well-formed but unknown publication is not found'
);
reset role;

-- 10. Scenario changes the shade result
select is((select doc #>> '{scenario,slug}' from ctx where name = 'sc1000'), 'equinox-1000', 'scenario echo: equinox-1000');
select is((select doc #>> '{scenario,slug}' from ctx where name = 'sc1600'), 'equinox-1600', 'scenario echo: equinox-1600');
select isnt(
  (select (doc #>> '{right,analysis,shade,m2}')::numeric from ctx where name = 'sc1600'),
  (select (doc #>> '{right,analysis,shade,m2}')::numeric from ctx where name = 'sc1000'),
  'equinox-1600 and equinox-1000 give different shade m2 for a canopy snapshot'
);
select ok((select (doc #>> '{right,analysis,shade,m2}')::numeric > 0 from ctx where name = 'sc1000'), 'equinox-1000: the canopy casts positive shade');
select is(
  (select (doc #>> '{metricDeltas,shadeM2}')::numeric from ctx where name = 'sc1600'),
  (select round((doc #>> '{right,analysis,shade,m2}')::numeric - (doc #>> '{left,analysis,shade,m2}')::numeric, 2) from ctx where name = 'sc1600'),
  'equinox-1600: shadeM2 delta is right minus left'
);

-- 11. Different sites or baselines raise FT422
insert into public.sites (id, slug, name_es, name_en, locality_es, locality_en, timezone, currency, metric_srid, completeness, published)
select '94000000-0000-4000-8000-0000000000a1', 'cmp-second-site', name_es, name_en, locality_es, locality_en, timezone, currency, metric_srid, completeness, true
from public.sites where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99';
insert into public.site_baselines (id, site_id, version, boundary, pedestrian_area, source_url, source_license, source_attribution, capture_date, source_checksum, coverage_note_es, coverage_note_en, is_active)
select '94000000-0000-4000-8000-0000000000b1', '94000000-0000-4000-8000-0000000000a1', version, boundary, pedestrian_area, source_url, source_license, source_attribution, capture_date, source_checksum, coverage_note_es, coverage_note_en, true
from public.site_baselines where id = (select id from ctx where name = 'baseline');

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select throws_ok(
  format($$select public.compare_revisions('baseline:94000000-0000-4000-8000-0000000000b1', 'publication:%s')$$, (select id from ctx where name = 'pA')),
  'FT422', 'incompatible_snapshots', 'a baseline of another site vs a pilot publication is incompatible'
);
select throws_ok(
  format($$select public.compare_revisions('publication:%s', 'baseline:94000000-0000-4000-8000-0000000000b1')$$, (select id from ctx where name = 'pA')),
  'FT422', 'incompatible_snapshots', 'incompatibility is symmetric'
);
reset role;
set local role anon;
select throws_ok(
  format($$select public.compare_revisions('baseline:94000000-0000-4000-8000-0000000000b1', 'publication:%s')$$, (select id from ctx where name = 'pA')),
  'FT422', 'incompatible_snapshots', 'anon also gets incompatible_snapshots'
);
reset role;
update public.sites set published = false where id = '94000000-0000-4000-8000-0000000000a1';
set local role anon;
select throws_ok(
  $$select public.compare_revisions('baseline:94000000-0000-4000-8000-0000000000b1', 'baseline:94000000-0000-4000-8000-0000000000b1')$$,
  'P0002', 'snapshot_not_found', 'a baseline of an unpublished site is not found'
);
reset role;

-- 12. Catalog incompatibility.
-- Revisions created in this transaction all have created_at = now(), so a catalog with
-- effective_from = now() pins every app-created revision. To get a revision pinned to v1,
-- insert a revision row as postgres with created_at one second after v1 became effective.
insert into public.revisions (id, branch_id, site_id, baseline_id, message, author_id, created_at)
select '94000000-0000-4000-8000-0000000000e1', r.branch_id, r.site_id, r.baseline_id, 'Old pin', r.author_id,
       (select c.effective_from + interval '1 second' from public.catalog_versions as c where c.id = '8f5a6417-0000-4000-8000-0000000000c1')
from public.revisions as r where r.id = (select id from ctx where name = 'rA');
insert into public.revision_features (revision_id, site_id, feature_id, kind, properties, geometry)
select '94000000-0000-4000-8000-0000000000e1', f.site_id, f.feature_id, f.kind, f.properties, f.geometry
from public.revision_features as f
where f.revision_id = (select id from ctx where name = 'rA') and f.kind = 'shade_canopy';

insert into public.catalog_versions (id, site_id, currency, version, effective_from, source, price_date, is_illustrative, assumption_owner, checksum)
select '94000000-0000-4000-8000-0000000000c2', site_id, currency, 'cmp-v2', now(), 'test catalog v2', current_date, is_illustrative, assumption_owner, repeat('b', 64)
from public.catalog_versions where id = '8f5a6417-0000-4000-8000-0000000000c1';
insert into public.catalog_items (catalog_version_id, code, kind, unit, quantity_formula, price_low_cents, price_high_cents, is_assumption, assumption_owner, assumption_date)
select '94000000-0000-4000-8000-0000000000c2', code, kind, unit, quantity_formula, price_low_cents * 2, price_high_cents * 2, is_assumption, assumption_owner, assumption_date
from public.catalog_items where catalog_version_id = '8f5a6417-0000-4000-8000-0000000000c1' and kind = 'shade_canopy';

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
insert into ctx (name, id, doc) select 'cat_old_new', null, public.compare_revisions('revision:94000000-0000-4000-8000-0000000000e1', 'revision:' || (select id from ctx where name = 'rA'));
insert into ctx (name, id, doc) select 'cat_new_old', null, public.compare_revisions('revision:' || (select id from ctx where name = 'rA'), 'revision:94000000-0000-4000-8000-0000000000e1');
insert into ctx (name, id, doc) select 'cat_old_base', null, public.compare_revisions('baseline:' || (select id from ctx where name = 'baseline'), 'revision:94000000-0000-4000-8000-0000000000e1');
insert into ctx (name, id, doc) select 'cat_pub_pub', null, public.compare_revisions('publication:' || (select id from ctx where name = 'pA'), 'publication:' || (select id from ctx where name = 'pB'));
reset role;

select is((select doc #>> '{left,cost,catalogVersionId}' from ctx where name = 'cat_old_new'), '8f5a6417-0000-4000-8000-0000000000c1', 'catalog: the older revision pins v1');
select is((select doc #>> '{right,cost,catalogVersionId}' from ctx where name = 'cat_old_new'), '94000000-0000-4000-8000-0000000000c2', 'catalog: the newer revision pins v2');
select is((select doc -> 'catalogCompatible' from ctx where name = 'cat_old_new'), 'false'::jsonb, 'catalog: different catalogs with cost lines on both sides are incompatible');
select ok((select doc #>> '{costDelta}' from ctx where name = 'cat_old_new') is null, 'catalog: costDelta is null when incompatible');
select is((select doc -> 'costDelta' from ctx where name = 'cat_old_new'), 'null'::jsonb, 'catalog: costDelta is JSON null (key present)');
select is((select doc -> 'catalogCompatible' from ctx where name = 'cat_new_old'), 'false'::jsonb, 'catalog: incompatibility is symmetric');
select ok((select doc #>> '{costDelta}' from ctx where name = 'cat_new_old') is null, 'catalog: costDelta is null in the reversed comparison');
select is((select doc -> 'catalogCompatible' from ctx where name = 'cat_old_base'), 'true'::jsonb, 'catalog: a zero-line baseline side stays compatible with a v1 revision');
select is(
  (select doc -> 'costDelta' from ctx where name = 'cat_old_base'),
  (select jsonb_build_object('totalLowCents', doc #> '{right,cost,totalLowCents}', 'totalHighCents', doc #> '{right,cost,totalHighCents}') from ctx where name = 'cat_old_base'),
  'catalog: costDelta against the baseline equals the right totals'
);
select is((select doc -> 'catalogCompatible' from ctx where name = 'cat_pub_pub'), 'true'::jsonb, 'catalog: two publications pinned to the same v2 stay compatible');
select isnt(
  (select (doc #>> '{left,cost,totalLowCents}')::bigint from ctx where name = 'cat_old_new'),
  (select (doc #>> '{right,cost,totalLowCents}')::bigint from ctx where name = 'cat_old_new'),
  'catalog: the same canopy is priced differently under v1 and v2'
);
select is((select doc -> 'counts' from ctx where name = 'cat_old_new'), '{"equal":1,"added":3,"removed":0,"modified":0}'::jsonb, 'catalog: counts still compare the features (1 shared canopy, 3 added)');

-- 13. Hidden publications are not found
update public.publications set moderation_state = 'hidden' where id = (select id from ctx where name = 'pB');
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  format($$select public.compare_revisions('publication:%s', 'publication:%s')$$, (select id from ctx where name = 'pA'), (select id from ctx where name = 'pB')),
  'P0002', 'snapshot_not_found', 'anon: a hidden publication as right ref is not found'
);
select throws_ok(
  format($$select public.compare_revisions('publication:%s', 'publication:%s')$$, (select id from ctx where name = 'pB'), (select id from ctx where name = 'pA')),
  'P0002', 'snapshot_not_found', 'anon: a hidden publication as left ref is not found'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select throws_ok(
  format($$select public.compare_revisions('publication:%s', 'publication:%s')$$, (select id from ctx where name = 'pA'), (select id from ctx where name = 'pB')),
  'P0002', 'snapshot_not_found', 'the author also cannot compare their own hidden publication by publication ref'
);
select lives_ok(
  format($$select public.compare_revisions('publication:%s', 'revision:%s')$$, (select id from ctx where name = 'pA'), (select id from ctx where name = 'rB')),
  'the author can still compare the hidden revision through a revision ref'
);
reset role;

-- 14. Comparing never changes snapshots
insert into ctx (name, id, doc)
select 'counts_after', null, jsonb_build_object(
  'revisions', (select count(*) from public.revisions),
  'features', (select count(*) from public.revision_features),
  'publications', (select count(*) from public.publications));
select is(
  (select (doc ->> 'revisions')::bigint from ctx where name = 'counts_after') - 1,
  (select (doc ->> 'revisions')::bigint from ctx where name = 'counts_before'),
  'revisions count is unchanged by compare calls (only the one test-inserted revision is added)'
);
select is(
  (select (doc ->> 'features')::bigint from ctx where name = 'counts_after') - 1,
  (select (doc ->> 'features')::bigint from ctx where name = 'counts_before'),
  'revision_features count is unchanged by compare calls (only the one test-inserted feature is added)'
);
select is((select doc -> 'publications' from ctx where name = 'counts_after'), (select doc -> 'publications' from ctx where name = 'counts_before'), 'publications count is unchanged by compare calls');

-- Stricter check: snapshot the counts, run more compares, and compare again.
insert into ctx (name, id, doc)
select 'counts_mid', null, jsonb_build_object(
  'revisions', (select count(*) from public.revisions),
  'features', (select count(*) from public.revision_features),
  'publications', (select count(*) from public.publications),
  'mutation_requests', (select count(*) from public.mutation_requests));
set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select public.compare_revisions('publication:' || (select id from ctx where name = 'pA'), 'publication:' || (select id from ctx where name = 'pA'));
select public.compare_revisions('baseline:' || (select id from ctx where name = 'baseline'), 'revision:' || (select id from ctx where name = 'rB'), 'equinox-1600');
select public.compare_revisions('revision:' || (select id from ctx where name = 'rA'), 'revision:' || (select id from ctx where name = 'rB'));
reset role;
select is(
  (select jsonb_build_object(
    'revisions', (select count(*) from public.revisions),
    'features', (select count(*) from public.revision_features),
    'publications', (select count(*) from public.publications))),
  (select doc - 'mutation_requests' from ctx where name = 'counts_mid'),
  'three more compare calls leave revisions, revision_features and publications unchanged'
);
-- Measured before/after: rows committed by other suites (e.g. E2E merges) must not matter.
select is(
  (select count(*) from public.mutation_requests),
  (select (doc ->> 'mutation_requests')::bigint from ctx where name = 'counts_mid'),
  'compare writes no mutation_requests rows'
);

select * from finish();
rollback;
