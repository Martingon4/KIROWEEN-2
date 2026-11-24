begin;

select plan(101);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction). They run as the calling role.
-- Every open report of a site, paging through the cursor (the queue may hold committed rows from other runs).
create function public.t_queue(p_site uuid) returns jsonb language plpgsql as $$
declare
  v_page jsonb;
  v_all jsonb := '[]'::jsonb;
  v_at timestamptz;
  v_id uuid;
begin
  loop
    v_page := public.list_open_reports(p_site, v_at, v_id, 50);
    v_all := v_all || (v_page -> 'items');
    exit when v_page -> 'nextCursor' = 'null'::jsonb;
    v_at := (v_page #>> '{nextCursor,createdAt}')::timestamptz;
    v_id := (v_page #>> '{nextCursor,id}')::uuid;
  end loop;
  return v_all;
end;
$$;
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
create function public.t_doc(p text) returns jsonb language sql stable as $$ select doc from ctx where name = p $$;
create function public.t_uid(p text) returns text language sql immutable as
$$ select '99000000-0000-4000-8000-' || lpad(p, 12, '0') $$;
create function public.t_as(p text) returns text language sql as
$$ select set_config('request.jwt.claim.sub', public.t_uid(p), true) $$;
create function public.t_noauth() returns text language sql as
$$ select set_config('request.jwt.claim.sub', '', true) $$;
create function public.t_err(p_sql text) returns text language plpgsql as $$
declare
  m text;
  d text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return sqlstate || '|' || m || '|' || coalesce(d, '');
end;
$$;
create function public.t_pt(x numeric, y numeric) returns jsonb language sql immutable as
$$ select jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(x, y)) $$;
create function public.t_rect(x1 numeric, y1 numeric, x2 numeric, y2 numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(jsonb_build_array(
    jsonb_build_array(x1, y1), jsonb_build_array(x2, y1), jsonb_build_array(x2, y2),
    jsonb_build_array(x1, y2), jsonb_build_array(x1, y1))))
$$;
create function public.t_canopy(p_id text, p_label text default 'Cubierta') returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'kind', 'shade_canopy',
    'properties', jsonb_build_object('label', p_label, 'heightM', 4.5),
    'geometry', public.t_rect(-98.19825, 19.04358, -98.19805, 19.04372))
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
create function public.t_forke(p_pub uuid) returns text language sql as
$$ select public.t_err(format('select public.fork_publication(%L::uuid, ''Fork'', %L, %L)', p_pub, gen_random_uuid()::text, repeat('d', 64))) $$;
create function public.t_prev(p_branch uuid, p_pub uuid) returns text language sql as
$$ select public.t_err(format('select public.merge_preview(%L::uuid, %L::uuid, ''[]''::jsonb)', p_branch, p_pub)) $$;
create function public.t_merge(p_branch uuid, p_pub uuid) returns text language sql as $$
  select public.t_err(format('select public.merge_commit(%L::uuid, %L::uuid, %L::uuid, ''Merge'', ''[]''::jsonb, %L, %L)',
    p_branch, p_pub, public.t_head(p_branch), gen_random_uuid()::text, repeat('e', 64)))
$$;
create function public.t_cc(p_pub uuid, p_body text) returns text language sql as $$
  select public.t_err(format('select public.create_comment(%L::uuid, null, %L, %L, %L)', p_pub, p_body, gen_random_uuid()::text, repeat('a', 64)))
$$;
create function public.t_sup(p_pub uuid, p_on boolean) returns text language sql as $$
  select public.t_err(format('select public.set_support(%L::uuid, %L::boolean)', p_pub, p_on))
$$;
create function public.t_rep(p_kind text, p_id uuid) returns text language sql as $$
  select public.t_err(format('select public.create_report(%L, %L::uuid, ''spam'', null, %L, %L)', p_kind, p_id, gen_random_uuid()::text, repeat('a', 64)))
$$;
create function public.t_mod(p_kind text, p_id uuid, p_action text, p_reason text) returns text language sql as $$
  select public.t_err(format('select public.moderate_target(%L, %L::uuid, %L, %L, null, null, %L, %L)', p_kind, p_id, p_action, p_reason, gen_random_uuid()::text, repeat('a', 64)))
$$;
create function public.t_cmp(p_pub uuid) returns text language sql as $$
  select public.t_err(format('select public.compare_revisions(%L, %L)', 'publication:' || p_pub, 'baseline:' || public.t_id('baseline')))
$$;
create function public.t_ana(p_pub uuid) returns text language sql as $$
  select public.t_err(format('select public.get_snapshot_analysis(%L)', 'publication:' || p_pub))
$$;
-- Community rows as the tables hold them (run as postgres).
create function public.t_rows(p_pub uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'comments', (select jsonb_agg(c.id::text || ':' || c.moderation_state::text || ':' || (c.retracted_at is not null)::text order by c.id) from public.comments as c where c.publication_id = p_pub),
    'supports', (select count(*) from public.supports as s where s.publication_id = p_pub),
    'reports', (select jsonb_agg(r.id::text || ':' || r.state::text order by r.id) from public.reports as r where r.publication_id = p_pub))
$$;

-- 1. Setup
-- Users: 1 publisher, 2 forker and merger, 3 moderator, 4 and 5 community, 6 outsider.
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n::text)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from generate_series(1, 6) as n;
insert into public.site_roles (site_id, user_id, role)
values ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('3')::uuid, 'moderator');
insert into ctx select 'baseline', id, null from public.site_baselines
where site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and is_active;

set local role authenticated;
select public.t_as('1');
insert into ctx select 'b1', public.t_branch('Hidden effects A'), null;
insert into ctx select 'r1', public.t_save(public.t_id('b1'), jsonb_build_array(public.t_canopy(public.t_uid('f1')))), null;
insert into ctx select 'P1', public.t_pub(public.t_id('r1')), null;
insert into ctx select 'bOwn', public.t_branch('Own branch of A'), null;
select public.t_as('2');
-- (a) B forks P1
insert into ctx select 'fork', null, public.t_fork(public.t_id('P1'));
insert into ctx select 'F', (public.t_doc('fork') ->> 'branchId')::uuid, null;
-- (b) B's own branch T merges P1 before the hide; T2 and T3 stay empty for later attempts
insert into ctx select 'T', public.t_branch('Target merged'), null;
insert into ctx select 'rT', public.t_save(public.t_id('T'), jsonb_build_array(public.t_tree(public.t_uid('f2'), public.t_pt(-98.19775, 19.0436)))), null;
insert into ctx select 'T2', public.t_branch('Target after hide'), null;
insert into ctx select 'T3', public.t_branch('Target after restore'), null;
insert into ctx select 'merge', null, public.merge_commit(public.t_id('T'), public.t_id('P1'), public.t_head(public.t_id('T')), 'Merge', '[]'::jsonb, 'fx-merge-key-1', repeat('e', 64));
select is((public.t_doc('merge') ->> 'featureCount')::int, 2, 'setup: the merge of P1 into T succeeded before the hide with two features');
-- Community: comments, supports, reports
select public.t_as('4');
insert into ctx select 'c1', (public.create_comment(public.t_id('P1'), public.t_uid('f1')::uuid, 'Comentario anclado', 'fx-c1-key-0001', repeat('1', 64)) ->> 'commentId')::uuid, null;
insert into ctx select 'c2', (public.create_comment(public.t_id('P1'), null, 'Comentario libre', 'fx-c2-key-0001', repeat('2', 64)) ->> 'commentId')::uuid, null;
select public.set_support(public.t_id('P1'), true);
insert into ctx select 'rep_p', null, public.create_report('publication', public.t_id('P1'), 'spam', 'sospechoso', 'fx-rp-key-0001', repeat('3', 64));
insert into ctx select 'rep_c', null, public.create_report('comment', public.t_id('c2'), 'privacy', null, 'fx-rc-key-0001', repeat('4', 64));
select public.t_as('5');
select public.set_support(public.t_id('P1'), true);
reset role;

-- Baselines taken before the hide
insert into ctx select 'rows0', null, public.t_rows(public.t_id('P1'));
set local role authenticated;
select public.t_as('2');
insert into ctx select 'F_head0', null, public.get_branch_head(public.t_id('F'));
insert into ctx select 'T_head0', null, public.get_branch_head(public.t_id('T'));
set local role anon;
select public.t_noauth();
insert into ctx select 'pub0', null, public.get_public_publication(public.t_id('P1'));
insert into ctx select 'sum0', null, public.get_public_community_summary(public.t_id('P1'));
insert into ctx select 'list0', null, public.list_public_comments(public.t_id('P1'), null, null, 50);
select is(public.t_doc('pub0') is not null, true, 'before the hide: the publication is public');
select is(public.public_publication_exists(public.t_id('P1')), true, 'before the hide: public_publication_exists is true');
select is(public.t_doc('sum0'), '{"supportCount": 2, "commentCount": 2}'::jsonb, 'before the hide: the summary has two supports and two comments');
select is(jsonb_array_length(public.t_doc('list0') -> 'items'), 2, 'before the hide: the list has two comments');
reset role;
set local role authenticated;
select public.t_as('2');
select is(public.t_cmp(public.t_id('P1')), 'ok', 'before the hide: compare_revisions works');
select is(public.t_ana(public.t_id('P1')), 'ok', 'before the hide: get_snapshot_analysis works');
select is((public.t_doc('F_head0') ->> 'sourceVisible')::boolean, true, 'before the hide: the fork reports a visible source');
select is((public.t_doc('T_head0') ->> 'mergeSourceVisible')::boolean, true, 'before the hide: the merged branch reports a visible merge source');
reset role;

-- 2. A moderator hides P1
set local role authenticated;
select public.t_as('3');
select is(public.t_mod('publication', public.t_id('P1'), 'hide', 'Retirada por revisión'), 'ok', 'the moderator hides P1');
reset role;

-- 3. Public reads go dark
set local role anon;
select public.t_noauth();
select is(public.get_public_publication(public.t_id('P1')), null, 'hidden: get_public_publication is null for anon');
select is(public.public_publication_exists(public.t_id('P1')), false, 'hidden: public_publication_exists is false for anon');
select is(public.list_public_comments(public.t_id('P1')), null, 'hidden: list_public_comments is null for anon');
select is(public.get_public_community_summary(public.t_id('P1')), null, 'hidden: get_public_community_summary is null for anon');
reset role;
set local role authenticated;
select public.t_as('2');
select is(public.get_public_publication(public.t_id('P1')), null, 'hidden: get_public_publication is null for a signed-in user');
select is(public.public_publication_exists(public.t_id('P1')), false, 'hidden: public_publication_exists is false for a signed-in user');
select is(public.list_public_comments(public.t_id('P1')), null, 'hidden: list_public_comments is null for a signed-in user');
select is(public.get_public_community_summary(public.t_id('P1')), null, 'hidden: the summary is null for a signed-in user');
select public.t_as('4');
select is(public.my_support_state(public.t_id('P1')), null, 'hidden: my_support_state is null even for a supporter');
select is(public.list_my_moderation_notices(public.t_id('P1')), null, 'hidden: the author notices are null');
select public.t_as('1');
select is(public.get_public_publication(public.t_id('P1')), null, 'hidden: even the publisher gets null from the public read');
select public.t_as('2');
-- Authenticated operations on the hidden publication
select alike(public.t_cmp(public.t_id('P1')), 'P0002|%', 'hidden: compare_revisions is P0002');
select alike(public.t_ana(public.t_id('P1')), 'P0002|%', 'hidden: get_snapshot_analysis is P0002');
select alike(public.t_forke(public.t_id('P1')), 'P0002|%', 'hidden: fork_publication is P0002');
select is(public.t_prev(public.t_id('T2'), public.t_id('P1')), 'P0002|publication_not_found|', 'hidden: merge_preview is P0002 publication_not_found');
select is(public.t_merge(public.t_id('T2'), public.t_id('P1')), 'P0002|publication_not_found|', 'hidden: merge_commit is P0002 publication_not_found');
select public.t_as('6');
select is(public.t_cc(public.t_id('P1'), 'Nuevo comentario'), 'P0002|publication_not_found|', 'hidden: create_comment is P0002');
select is(public.t_sup(public.t_id('P1'), true), 'P0002|publication_not_found|', 'hidden: set_support is P0002');
select is(public.t_rep('publication', public.t_id('P1')), 'P0002|target_not_found|', 'hidden: create_report on the publication is P0002');
select is(public.t_rep('comment', public.t_id('c1')), 'P0002|target_not_found|', 'hidden: create_report on a comment of it is P0002');
select public.t_as('4');
select is(public.t_sup(public.t_id('P1'), false), 'P0002|publication_not_found|', 'hidden: even removing an existing support is P0002');
reset role;
select is((select count(*)::int from public.comments where publication_id = public.t_id('P1')), 2, 'hidden: the rejected comment created no row');
select is((select count(*)::int from public.supports where publication_id = public.t_id('P1')), 2, 'hidden: the supports are untouched');

-- 4. Derivatives stay intact
set local role authenticated;
select public.t_as('2');
select is(public.get_branch_head(public.t_id('F')) -> 'features', public.t_doc('F_head0') -> 'features', 'hidden: the fork keeps exactly its features');
select is(jsonb_array_length(public.get_branch_head(public.t_id('F')) -> 'features'), 1, 'hidden: the fork still has its one feature');
select is((public.get_branch_head(public.t_id('F')) ->> 'sourceVisible')::boolean, false, 'hidden: the fork reports sourceVisible=false');
select is(public.get_branch_head(public.t_id('F')) ->> 'sourcePublicationId', public.t_id('P1')::text, 'hidden: the fork keeps sourcePublicationId');
select is(public.get_branch_head(public.t_id('F')) ->> 'revisionId', public.t_doc('F_head0') ->> 'revisionId', 'hidden: the fork head revision is unchanged');
select is(public.get_branch_head(public.t_id('T')) -> 'features', public.t_doc('T_head0') -> 'features', 'hidden: the merged branch keeps exactly its features');
select is(jsonb_array_length(public.get_branch_head(public.t_id('T')) -> 'features'), 2, 'hidden: the merged branch still has two features');
select is((public.get_branch_head(public.t_id('T')) ->> 'mergeSourceVisible')::boolean, false, 'hidden: the merged branch reports mergeSourceVisible=false');
select is(public.get_branch_head(public.t_id('T')) ->> 'mergeSourcePublicationId', public.t_id('P1')::text, 'hidden: the merged branch keeps mergeSourcePublicationId');
select is(public.get_branch_head(public.t_id('T')) ->> 'revisionId', (public.t_doc('merge') ->> 'revisionId'), 'hidden: the merged revision is still the head');
select is(public.save_revision(public.t_id('F'), public.t_head(public.t_id('F')), 'Sigue editable', jsonb_build_array(public.t_canopy(public.t_uid('f1'), 'Editado')), 'fx-edit-fork-01', repeat('b', 64)) is not null, true, 'hidden: the fork can still be edited');
reset role;
select is(
  (select count(*)::int from public.revision_features as f where f.revision_id = (public.t_doc('merge') ->> 'revisionId')::uuid),
  2, 'hidden: the merged revision keeps its two feature rows in the table');
select is(
  (select count(*)::int from public.revision_features as f where f.revision_id = public.t_id('r1')),
  1, 'hidden: the hidden publication keeps its revision features');
select is(public.t_rows(public.t_id('P1')), public.t_doc('rows0'), 'hidden: comment, support, and report rows are unchanged');

-- 5. Moderators still work with the hidden content
set local role authenticated;
select public.t_as('3');
insert into ctx select 'mt', null, public.get_moderation_target('publication', public.t_id('P1'));
select is(public.t_doc('mt') ->> 'state', 'hidden', 'moderator: the target reads hidden');
select is(public.t_doc('mt') ->> 'label', 'Etiqueta', 'moderator: the target still returns the content');
select is(jsonb_array_length(public.t_doc('mt') -> 'history'), 1, 'moderator: the history has the hide event');
select is(public.t_doc('mt') #>> '{history,0,reason}', 'Retirada por revisión', 'moderator: the history carries the reason');
select is(public.t_doc('mt') -> 'openReports', '1'::jsonb, 'moderator: the publication report is still open');
select is(public.get_moderation_target('comment', public.t_id('c1')) ->> 'body', 'Comentario anclado', 'moderator: comments of the hidden publication remain readable');
select is(public.get_moderation_target('comment', public.t_id('c2')) -> 'openReports', '1'::jsonb, 'moderator: the comment report is still open');
select is(
  (select count(*)::int from jsonb_array_elements(public.t_queue('8f5a6417-5f6d-4f02-a50c-76d97167db99'::uuid)) as i
   where i ->> 'reportId' in (public.t_doc('rep_p') ->> 'reportId', public.t_doc('rep_c') ->> 'reportId')),
  2, 'moderator: both reports stay in the queue');
select is(
  (select i ->> 'targetState' from jsonb_array_elements(public.t_queue('8f5a6417-5f6d-4f02-a50c-76d97167db99'::uuid)) as i where i ->> 'reportId' = public.t_doc('rep_p') ->> 'reportId'),
  'hidden', 'moderator: the queue shows the hidden publication state');
select is(
  (select i ->> 'reason' from jsonb_array_elements(public.list_hidden_content('8f5a6417-5f6d-4f02-a50c-76d97167db99') -> 'items') as i where i ->> 'targetId' = public.t_id('P1')::text),
  'Retirada por revisión', 'moderator: the hidden list names P1 with its reason');

-- 6. Restore: every read works again
select is(public.t_mod('publication', public.t_id('P1'), 'restore', 'Revisión completada'), 'ok', 'the moderator restores P1');
reset role;
set local role anon;
select public.t_noauth();
select is(public.get_public_publication(public.t_id('P1')), public.t_doc('pub0'), 'restored: get_public_publication returns the same document as before');
select is(public.public_publication_exists(public.t_id('P1')), true, 'restored: public_publication_exists is true');
select is(public.get_public_community_summary(public.t_id('P1')), public.t_doc('sum0'), 'restored: the summary is as before');
select is(public.list_public_comments(public.t_id('P1'), null, null, 50), public.t_doc('list0'), 'restored: the comment list is as before');
reset role;
select is(public.t_rows(public.t_id('P1')), public.t_doc('rows0'), 'restored: comment states, supports, and reports are unchanged');
set local role authenticated;
select public.t_as('2');
select is(public.t_cmp(public.t_id('P1')), 'ok', 'restored: compare_revisions works');
select is(public.t_ana(public.t_id('P1')), 'ok', 'restored: get_snapshot_analysis works');
select is(public.t_prev(public.t_id('T2'), public.t_id('P1')), 'ok', 'restored: merge_preview works');
select is(public.t_merge(public.t_id('T3'), public.t_id('P1')), 'ok', 'restored: merge_commit works');
select is(public.t_forke(public.t_id('P1')), 'ok', 'restored: fork_publication works');
select is((public.get_branch_head(public.t_id('F')) ->> 'sourceVisible')::boolean, true, 'restored: the fork reports sourceVisible=true');
select is((public.get_branch_head(public.t_id('T')) ->> 'mergeSourceVisible')::boolean, true, 'restored: the merged branch reports mergeSourceVisible=true');
select public.t_as('6');
select is(public.t_cc(public.t_id('P1'), 'Nuevo comentario'), 'ok', 'restored: create_comment works');
select is(public.t_sup(public.t_id('P1'), true), 'ok', 'restored: set_support works');
select is(public.t_rep('publication', public.t_id('P1')), 'ok', 'restored: create_report works');
select is(public.my_support_state(public.t_id('P1')), true, 'restored: my_support_state reads again');
select public.t_as('4');
select is(public.my_support_state(public.t_id('P1')), true, 'restored: the earlier supporter still supports');
reset role;

-- 7. Hiding only a comment
set local role authenticated;
select public.t_as('3');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'Datos personales'), 'ok', 'the moderator hides comment c2');
set local role anon;
select public.t_noauth();
select is(public.get_public_publication(public.t_id('P1')) is not null, true, 'comment hidden: the publication stays public');
select is(public.public_publication_exists(public.t_id('P1')), true, 'comment hidden: public_publication_exists stays true');
select is(public.get_public_community_summary(public.t_id('P1')) ->> 'commentCount', '2', 'comment hidden: the count drops from 3 to 2 (c1 and the new comment)');
select is(
  (select count(*)::int from jsonb_array_elements(public.list_public_comments(public.t_id('P1'), null, null, 50) -> 'items') as i where i ->> 'commentId' = public.t_id('c2')::text),
  0, 'comment hidden: c2 disappears from the public list');
select is(
  (select count(*)::int from jsonb_array_elements(public.list_public_comments(public.t_id('P1'), null, null, 50) -> 'items') as i where i ->> 'commentId' = public.t_id('c1')::text),
  1, 'comment hidden: c1 stays in the list');
reset role;
set local role authenticated;
select public.t_as('2');
select is(public.t_cmp(public.t_id('P1')), 'ok', 'comment hidden: compare_revisions still works');
select is(public.t_forke(public.t_id('P1')), 'ok', 'comment hidden: fork_publication still works');
select public.t_as('4');
select is(public.t_cc(public.t_id('P1'), 'Sigue abierto'), 'ok', 'comment hidden: new comments are still accepted');
select is(
  (select i ->> 'reason' from jsonb_array_elements(public.list_my_moderation_notices(public.t_id('P1')) -> 'items') as i where i ->> 'commentId' = public.t_id('c2')::text),
  'Datos personales', 'comment hidden: the author is told the public reason');
select public.t_as('3');
select is(public.t_rep('comment', public.t_id('c2')), 'P0002|target_not_found|', 'comment hidden: it can no longer be reported');
select is(public.t_mod('comment', public.t_id('c2'), 'restore', 'Se restaura'), 'ok', 'the moderator restores c2');
set local role anon;
select public.t_noauth();
select is(public.get_public_community_summary(public.t_id('P1')) ->> 'commentCount', '4', 'comment restored: the count is back to 4 (c1, c2, and the two new comments)');
select is(
  (select count(*)::int from jsonb_array_elements(public.list_public_comments(public.t_id('P1'), null, null, 50) -> 'items') as i where i ->> 'commentId' = public.t_id('c2')::text),
  1, 'comment restored: c2 is back in the public list');
reset role;

-- 8. A publication of an unpublished site is dark as well, and nothing is lost
update public.sites set published = false where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99';
insert into ctx select 'rows1', null, public.t_rows(public.t_id('P1'));
set local role anon;
select public.t_noauth();
select is(public.get_public_publication(public.t_id('P1')), null, 'unpublished site: get_public_publication is null');
select is(public.public_publication_exists(public.t_id('P1')), false, 'unpublished site: public_publication_exists is false');
select is(public.list_public_comments(public.t_id('P1')), null, 'unpublished site: the comment list is null');
select is(public.get_public_community_summary(public.t_id('P1')), null, 'unpublished site: the summary is null');
reset role;
set local role authenticated;
select public.t_as('6');
select is(public.t_cc(public.t_id('P1'), 'Sitio cerrado'), 'P0002|publication_not_found|', 'unpublished site: create_comment is P0002');
select is(public.t_sup(public.t_id('P1'), false), 'P0002|publication_not_found|', 'unpublished site: set_support is P0002');
select is(public.t_rep('publication', public.t_id('P1')), 'P0002|target_not_found|', 'unpublished site: create_report is P0002');
select public.t_as('2');
select is((public.get_branch_head(public.t_id('F')) ->> 'sourceVisible')::boolean, false, 'unpublished site: the fork reports sourceVisible=false');
select is(jsonb_array_length(public.get_branch_head(public.t_id('F')) -> 'features'), 1, 'unpublished site: the fork keeps its features');
select public.t_as('3');
select is(public.get_moderation_target('publication', public.t_id('P1')) ->> 'state', 'visible', 'unpublished site: the moderator still reads the target');
reset role;
select is(public.t_rows(public.t_id('P1')), (select doc from ctx where name = 'rows1'), 'unpublished site: no row changed');
update public.sites set published = true where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99';
set local role anon;
select public.t_noauth();
select is(public.get_public_publication(public.t_id('P1')) is not null, true, 'republished site: the publication is public again');
reset role;

select * from finish();
rollback;
