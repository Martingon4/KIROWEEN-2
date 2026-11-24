begin;

select plan(235);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction). They run as the calling role.
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
create function public.t_doc(p text) returns jsonb language sql stable as $$ select doc from ctx where name = p $$;
create function public.t_uid(p text) returns text language sql immutable as
$$ select '98000000-0000-4000-8000-' || lpad(p, 12, '0') $$;
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
-- Switches the session user and then runs the statement.
create function public.t_deny(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', public.t_uid(p_user), true);
  return public.t_err(p_sql);
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
-- create_report as text (error or ok).
create function public.t_rep(p_kind text, p_id uuid, p_reason text, p_note text, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_err(format('select public.create_report(%L, %L::uuid, %L, %L, %L, %L)', p_kind, p_id, p_reason, p_note, p_key, p_hash))
$$;
create function public.t_mod(p_kind text, p_id uuid, p_action text, p_reason text, p_note text, p_report uuid,
  p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64)) returns text language sql as $$
  select public.t_err(format('select public.moderate_target(%L, %L::uuid, %L, %L, %L, %L::uuid, %L, %L)', p_kind, p_id, p_action, p_reason, p_note, p_report, p_key, p_hash))
$$;
create function public.t_res(p_report uuid, p_outcome text, p_note text, p_event uuid,
  p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64)) returns text language sql as $$
  select public.t_err(format('select public.resolve_report(%L::uuid, %L, %L, %L::uuid, %L, %L)', p_report, p_outcome, p_note, p_event, p_key, p_hash))
$$;
create function public.t_hid(p_site uuid, p_limit integer) returns text language sql as $$
  select public.t_err(format('select public.list_hidden_content(%L::uuid, %L::integer)', p_site, p_limit))
$$;
create function public.t_open(p_site uuid, p_at timestamptz, p_after uuid, p_limit integer) returns text language sql as $$
  select public.t_err(format('select public.list_open_reports(%L::uuid, %L::timestamptz, %L::uuid, %L::integer)', p_site, p_at, p_after, p_limit))
$$;
-- A fingerprint of everything moderation can change (run as postgres).
create function public.t_snap() returns jsonb language sql as $$
  select jsonb_build_object(
    'events', (select count(*) from public.moderation_events),
    'pubs', (select jsonb_agg(p.moderation_state::text order by p.id) from public.publications as p),
    'comments', (select jsonb_agg(c.moderation_state::text || coalesce(c.retracted_at::text, '') order by c.id) from public.comments as c),
    'reports', (select jsonb_agg(r.state::text || coalesce(r.resolved_by::text, '') || coalesce(r.resolution_event_id::text, '') order by r.id) from public.reports as r),
    'requests', (select count(*) from public.mutation_requests where operation in ('moderate_target', 'resolve_report', 'create_report')))
$$;
create function public.t_nev(p_kind text, p_id uuid) returns integer language sql as $$
  select count(*)::int from public.moderation_events as e
  where (p_kind = 'comment' and e.comment_id = p_id) or (p_kind = 'publication' and e.publication_id = p_id and e.comment_id is null)
$$;
create function public.t_ids(p jsonb, p_field text) returns text language sql immutable as $$
  select coalesce(string_agg(i ->> p_field, ',' order by o), '') from jsonb_array_elements(p -> 'items') with ordinality as t (i, o)
$$;

-- 1. Setup (as postgres)
-- Users: 1 publisher, 2 and 3 and 7 participants, 4 moderator, 5 coordinator only, 6 moderator of another site.
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n::text)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from generate_series(1, 7) as n;
insert into public.sites (id, slug, name_es, name_en, locality_es, locality_en, timezone, currency, metric_srid, completeness, published)
values (public.t_uid('5a')::uuid, 'sitio-prueba-98', 'Sitio', 'Site', 'Localidad', 'Locality', 'America/Mexico_City', 'MXN', 32614, 'partial', true);
insert into public.site_roles (site_id, user_id, role) values
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('4')::uuid, 'moderator'),
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('5')::uuid, 'coordinator'),
  (public.t_uid('5a')::uuid, public.t_uid('6')::uuid, 'moderator'),
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('6')::uuid, 'coordinator');
update public.profiles set public_alias = 'Moderador Cuatro' where id = public.t_uid('4')::uuid;
update public.profiles set public_alias = 'Reportera Dos' where id = public.t_uid('2')::uuid;
update public.profiles set public_alias = 'Reportero Tres' where id = public.t_uid('3')::uuid;
insert into ctx values ('site', '8f5a6417-5f6d-4f02-a50c-76d97167db99', null), ('site2', public.t_uid('5a')::uuid, null);

set local role authenticated;
select public.t_as('1');
insert into ctx select 'b1', public.t_branch('Moderation one'), null;
insert into ctx select 'r1', public.t_save(public.t_id('b1'), jsonb_build_array(public.t_canopy(public.t_uid('f1')))), null;
insert into ctx select 'p1', public.t_pub(public.t_id('r1')), null;
insert into ctx select 'b2', public.t_branch('Moderation two'), null;
insert into ctx select 'r2', public.t_save(public.t_id('b2'), jsonb_build_array(public.t_tree(public.t_uid('f2'), public.t_pt(-98.19775, 19.0436)))), null;
insert into ctx select 'p2', public.t_pub(public.t_id('r2')), null;
insert into ctx select 'b3', public.t_branch('Moderation three'), null;
insert into ctx select 'r3', public.t_save(public.t_id('b3'), jsonb_build_array(public.t_tree(public.t_uid('f3'), public.t_pt(-98.19770, 19.0436)))), null;
insert into ctx select 'p3', public.t_pub(public.t_id('r3')), null;
select public.t_as('2');
insert into ctx select 'c1', (public.create_comment(public.t_id('p1'), null, 'Comentario uno', 'mod-c1-key-01', repeat('a', 64)) ->> 'commentId')::uuid, null;
insert into ctx select 'c3', (public.create_comment(public.t_id('p2'), null, 'Comentario tres', 'mod-c3-key-01', repeat('b', 64)) ->> 'commentId')::uuid, null;
select public.t_as('3');
insert into ctx select 'c2', (public.create_comment(public.t_id('p1'), null, repeat('x', 200), 'mod-c2-key-01', repeat('c', 64)) ->> 'commentId')::uuid, null;
reset role;
insert into public.comments (id, publication_id, revision_id, author_id, body, moderation_state, retracted_at) values
  (public.t_uid('c4')::uuid, public.t_id('p1'), public.t_id('r1'), public.t_uid('2')::uuid, 'Retirado', 'visible', now()),
  (public.t_uid('c5')::uuid, public.t_id('p1'), public.t_id('r1'), public.t_uid('3')::uuid, 'Oculto previo', 'hidden', null);
insert into ctx values ('c_retracted', public.t_uid('c4')::uuid, null), ('c_hidden', public.t_uid('c5')::uuid, null);
update public.publications set moderation_state = 'hidden' where id = public.t_id('p3');

-- The pilot site's queue may hold committed rows from earlier E2E runs. Queue and
-- pagination assertions need an exact queue, so set those rows aside inside this
-- transaction only (user triggers off, rows deleted, everything rolled back at the end).
alter table public.reports disable trigger user;
delete from public.reports where state = 'open' and reporter_id::text not like '98000000-0000-4000-8000-%';
alter table public.reports enable trigger user;

-- 2. Grants
select is(has_function_privilege('anon', 'public.list_open_reports(uuid,timestamptz,uuid,integer)', 'EXECUTE'), false, 'anon cannot execute list_open_reports');
select is(has_function_privilege('authenticated', 'public.list_open_reports(uuid,timestamptz,uuid,integer)', 'EXECUTE'), true, 'authenticated can execute list_open_reports');
select is(has_function_privilege('anon', 'public.get_moderation_target(public.moderation_target_kind,uuid)', 'EXECUTE'), false, 'anon cannot execute get_moderation_target');
select is(has_function_privilege('anon', 'public.moderate_target(public.moderation_target_kind,uuid,public.moderation_action,text,text,uuid,text,text)', 'EXECUTE'), false, 'anon cannot execute moderate_target');
select is(has_function_privilege('anon', 'public.resolve_report(uuid,text,text,uuid,text,text)', 'EXECUTE'), false, 'anon cannot execute resolve_report');
select is(has_function_privilege('anon', 'public.list_hidden_content(uuid,integer)', 'EXECUTE'), false, 'anon cannot execute list_hidden_content');
select is(has_function_privilege('anon', 'public.create_report(public.moderation_target_kind,uuid,public.report_reason,text,text,text)', 'EXECUTE'), false, 'anon cannot execute create_report');
select is(has_function_privilege('authenticated', 'public.is_site_moderator(uuid,uuid)', 'EXECUTE'), false, 'authenticated cannot execute the internal is_site_moderator');
select is(has_function_privilege('authenticated', 'public.moderation_target_site(public.moderation_target_kind,uuid)', 'EXECUTE'), false, 'authenticated cannot execute the internal moderation_target_site');

-- 3. create_report
set local role authenticated;
select public.t_as('2');
insert into ctx select 'R1', null, public.create_report('publication', public.t_id('p1'), 'spam', 'parece spam', 'rep-r1-key-01', repeat('1', 64));
select public.t_as('3');
insert into ctx select 'R2', null, public.create_report('comment', public.t_id('c1'), 'harassment', null, 'rep-r2-key-01', repeat('2', 64));
insert into ctx select 'R3', null, public.create_report('publication', public.t_id('p2'), 'misinformation', null, 'rep-r3-key-01', repeat('3', 64));
select public.t_as('2');
insert into ctx select 'R4', null, public.create_report('comment', public.t_id('c2'), 'privacy', null, 'rep-r4-key-01', repeat('4', 64));
select public.t_as('7');
insert into ctx select 'R5', null, public.create_report('comment', public.t_id('c3'), 'other', repeat('n', 500), 'rep-r5-key-01', repeat('5', 64));
select is(public.t_doc('R1') ->> 'state', 'open', 'a new report is open');
select is(public.t_doc('R1') -> 'duplicate', 'false'::jsonb, 'a new report is not a duplicate');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.t_doc('R1')) as k),
  array['duplicate', 'reportId', 'state'], 'create_report returns only reportId, state, duplicate (no reporter data)');
select public.t_as('2');
insert into ctx select 'R1dup', null, public.create_report('publication', public.t_id('p1'), 'spam', 'otra vez', 'rep-r1-key-02', repeat('6', 64));
select is(public.t_doc('R1dup') ->> 'reportId', public.t_doc('R1') ->> 'reportId', 'a duplicate report returns the same id');
select is(public.t_doc('R1dup') -> 'duplicate', 'true'::jsonb, 'a duplicate report says duplicate=true');
select is(public.create_report('publication', public.t_id('p1'), 'spam', 'parece spam', 'rep-r1-key-01', repeat('1', 64)), public.t_doc('R1'), 'the same key and payload replays the identical report response');
select is(public.t_rep('publication', public.t_id('p1'), 'spam', 'parece spam', 'rep-r1-key-01', repeat('7', 64)), 'FT001|idempotency_key_reused|', 'the same key with another payload is FT001');
select is(public.t_rep('publication', public.t_id('p1'), 'harassment', null, 'rep-r1-key-02', repeat('6', 64)), 'ok', 'replaying the duplicate key stays ok');
reset role;
select is((select count(*)::int from public.reports where reporter_id = public.t_uid('2')::uuid and publication_id = public.t_id('p1') and target_kind = 'publication'), 1, 'a duplicate creates no second row');
select is(
  (select sum(w.count)::int from public.rate_windows as w where w.actor_id = public.t_uid('2')::uuid and w.action = 'report'),
  2, 'duplicates consume no rate unit (user 2 made two real reports)');
insert into ctx values ('R1id', (public.t_doc('R1') ->> 'reportId')::uuid, null), ('R2id', (public.t_doc('R2') ->> 'reportId')::uuid, null),
  ('R3id', (public.t_doc('R3') ->> 'reportId')::uuid, null), ('R4id', (public.t_doc('R4') ->> 'reportId')::uuid, null),
  ('R5id', (public.t_doc('R5') ->> 'reportId')::uuid, null);
select is((select count(*)::int from public.reports where state = 'open' and reporter_id::text like '98000000-0000-4000-8000-%'), 5, 'five reports are open');
select is((select note from public.reports where id = public.t_id('R5id')), repeat('n', 500), 'a note of 500 characters is stored');

set local role authenticated;
select public.t_as('7');
select is(public.t_rep('publication', public.t_id('p1'), 'spam', repeat('n', 501)), '22023|invalid_report_request|', 'a note of 501 characters is 22023');
select is(public.t_rep('publication', public.t_id('p1'), 'spam', ''), '22023|invalid_report_request|', 'an empty note is 22023');
select is(public.t_rep('publication', public.t_id('p1'), 'spam', 'a' || chr(7) || 'b'), '22023|invalid_report_request|', 'a note with a control character is 22023');
select is(public.t_rep('publication', public.t_id('p1'), 'spam', ' relleno'), '22023|invalid_report_request|', 'a padded note is 22023');
select alike(public.t_rep('publication', public.t_id('p1'), 'bogus', null), '22P02|%', 'an unknown reason is rejected by the enum (22P02)');
select alike(public.t_rep('thread', public.t_id('p1'), 'spam', null), '22P02|%', 'an unknown target kind is rejected by the enum (22P02)');
select is(public.t_rep('publication', null, 'spam', null), '22023|invalid_report_request|', 'a null target is 22023');
select is(public.t_rep('publication', public.t_id('p1'), 'spam', null, 'short'), '22023|invalid_report_request|', 'a short idempotency key is 22023');
select is(public.t_rep('publication', public.t_id('p1'), 'spam', null, gen_random_uuid()::text, 'nothex'), '22023|invalid_report_request|', 'a malformed hash is 22023');
select is(public.t_rep('comment', public.t_id('c_retracted'), 'spam', null), 'P0002|target_not_found|', 'a report on a retracted comment is P0002');
select is(public.t_rep('comment', public.t_id('c_hidden'), 'spam', null), 'P0002|target_not_found|', 'a report on a hidden comment is P0002');
select is(public.t_rep('comment', gen_random_uuid(), 'spam', null), 'P0002|target_not_found|', 'a report on an unknown comment is P0002');
select is(public.t_rep('publication', gen_random_uuid(), 'spam', null), 'P0002|target_not_found|', 'a report on an unknown publication is P0002');
select is(public.t_rep('publication', public.t_id('p3'), 'spam', null), 'P0002|target_not_found|', 'a report on a hidden publication is P0002');
select is(public.t_rep('publication', public.t_id('c1'), 'spam', null), 'P0002|target_not_found|', 'a comment id given as a publication is P0002');
select is(public.t_rep('comment', public.t_id('p1'), 'spam', null), 'P0002|target_not_found|', 'a publication id given as a comment is P0002');
select public.t_noauth();
select is(public.t_rep('publication', public.t_id('p1'), 'spam', null), '28000|authentication_required|', 'create_report without a session is 28000');
reset role;
set local role anon;
select public.t_noauth();
select alike(public.t_rep('publication', public.t_id('p1'), 'spam', null), '42501|%', 'anon is denied create_report (42501)');
reset role;
select is((select count(*)::int from public.reports where reporter_id::text like '98000000-0000-4000-8000-%'), 5, 'rejected reports created no rows');
select is(public.t_err(format('update public.reports set note = ''x'' where id = %L', public.t_id('R1id'))), '55000|immutable_report|', 'a report note cannot be edited');

-- 4. list_open_reports: content and pagination
select is(
  (select jsonb_build_object('c', count(*))::text from public.reports where state = 'open' and reporter_id::text like '98000000-0000-4000-8000-%'),
  '{"c": 5}', 'five open reports before moderation');
insert into ctx select 'expected_order', null, (select jsonb_agg(r.id order by r.created_at, r.id) from public.reports as r where r.state = 'open' and r.reporter_id::text like '98000000-0000-4000-8000-%');
set local role authenticated;
select public.t_as('4');
insert into ctx select 'q_all', null, public.list_open_reports(public.t_id('site'), null, null, 50);
insert into ctx select 'q_1', null, public.list_open_reports(public.t_id('site'), null, null, 2);
select is(jsonb_array_length(public.t_doc('q_all') -> 'items'), 5, 'the moderator sees five open reports');
select is(public.t_doc('q_all') -> 'nextCursor', 'null'::jsonb, 'everything on one page gives a null nextCursor');
select is(
  (select jsonb_agg(i -> 'reportId') from jsonb_array_elements(public.t_doc('q_all') -> 'items') as i),
  (select jsonb_agg(to_jsonb(e #>> '{}')) from jsonb_array_elements(public.t_doc('expected_order')) as e),
  'the queue is ordered by (created_at, id)');
select is(jsonb_array_length(public.t_doc('q_1') -> 'items'), 2, 'page 1 has two reports');
select isnt(public.t_doc('q_1') -> 'nextCursor', 'null'::jsonb, 'page 1 has a nextCursor');
insert into ctx select 'q_2', null, public.list_open_reports(public.t_id('site'),
  (public.t_doc('q_1') #>> '{nextCursor,createdAt}')::timestamptz, (public.t_doc('q_1') #>> '{nextCursor,id}')::uuid, 2);
insert into ctx select 'q_3', null, public.list_open_reports(public.t_id('site'),
  (public.t_doc('q_2') #>> '{nextCursor,createdAt}')::timestamptz, (public.t_doc('q_2') #>> '{nextCursor,id}')::uuid, 2);
select is(jsonb_array_length(public.t_doc('q_2') -> 'items'), 2, 'page 2 has two reports');
select is(jsonb_array_length(public.t_doc('q_3') -> 'items'), 1, 'page 3 has one report');
select is(public.t_doc('q_3') -> 'nextCursor', 'null'::jsonb, 'page 3 has a null nextCursor');
select is(
  public.t_ids(public.t_doc('q_1'), 'reportId') || ',' || public.t_ids(public.t_doc('q_2'), 'reportId') || ',' || public.t_ids(public.t_doc('q_3'), 'reportId'),
  public.t_ids(public.t_doc('q_all'), 'reportId'), 'the three pages add up to the full queue without repeats');
select is(public.t_open(public.t_id('site'), null, null, 0), '22023|invalid_page_request|', 'limit 0 is 22023');
select is(public.t_open(public.t_id('site'), null, null, 51), '22023|invalid_page_request|', 'limit 51 is 22023');
select is(public.t_open(public.t_id('site'), now(), null, 5), '22023|invalid_page_request|', 'a cursor with only createdAt is 22023');
select is(public.t_open(public.t_id('site'), null, gen_random_uuid(), 5), '22023|invalid_page_request|', 'a cursor with only id is 22023');
select is(public.t_open(null, null, null, 5), 'P0002|site_not_found|', 'a null site is P0002');
select is(
  (select array_agg(k order by k collate "C") from jsonb_object_keys(public.t_doc('q_all') -> 'items' -> 0) as k),
  array['commentId', 'createdAt', 'note', 'preview', 'publicationId', 'reason', 'reportId', 'reporterAlias', 'targetKind', 'targetState']::text[],
  'a queue item has the documented keys and no reporter id');
select is(
  (select to_jsonb(i) - 'createdAt' from jsonb_array_elements(public.t_doc('q_all') -> 'items') as i where i ->> 'reportId' = public.t_id('R1id')::text),
  jsonb_build_object('reportId', public.t_id('R1id'), 'targetKind', 'publication', 'publicationId', public.t_id('p1'), 'commentId', null,
    'reason', 'spam', 'note', 'parece spam', 'reporterAlias', 'Reportera Dos', 'targetState', 'visible', 'preview', 'Etiqueta'),
  'the publication report shows alias, label, state, note, and reason');
select is(
  (select to_jsonb(i) - 'createdAt' from jsonb_array_elements(public.t_doc('q_all') -> 'items') as i where i ->> 'reportId' = public.t_id('R2id')::text),
  jsonb_build_object('reportId', public.t_id('R2id'), 'targetKind', 'comment', 'publicationId', public.t_id('p1'), 'commentId', public.t_id('c1'),
    'reason', 'harassment', 'note', null, 'reporterAlias', 'Reportero Tres', 'targetState', 'visible', 'preview', 'Comentario uno'),
  'the comment report shows the body as preview and a null note');
select is(
  (select i ->> 'preview' from jsonb_array_elements(public.t_doc('q_all') -> 'items') as i where i ->> 'reportId' = public.t_id('R4id')::text),
  repeat('x', 140), 'a comment preview is cut at 140 characters');
select is(public.t_doc('q_all')::text like '%' || public.t_uid('2') || '%', false, 'the queue never contains a reporter account id');
reset role;

-- 5. Roles: non-moderator, coordinator only, moderator of another site
insert into ctx select 'snap0', null, public.t_snap();
set local role authenticated;
select is(
  public.t_deny(u.id, c.sql),
  c.expected,
  u.label || ': ' || c.fn || ' is denied'
)
from (values ('2', 'a non-moderator'), ('5', 'a coordinator without the moderator role'), ('6', 'a moderator of another site'), ('7', 'a reporter')) as u (id, label)
cross join (values
  ('list_open_reports', format('select public.list_open_reports(%L::uuid)', public.t_id('site')), 'P0002|site_not_found|'),
  ('get_moderation_target (publication)', format('select public.get_moderation_target(''publication'', %L::uuid)', public.t_id('p1')), 'P0002|target_not_found|'),
  ('get_moderation_target (comment)', format('select public.get_moderation_target(''comment'', %L::uuid)', public.t_id('c1')), 'P0002|target_not_found|'),
  ('moderate_target (comment)', format('select public.moderate_target(''comment'', %L::uuid, ''hide'', ''razón'', null, null, %L, %L)', public.t_id('c1'), gen_random_uuid()::text, repeat('a', 64)), 'P0002|target_not_found|'),
  ('moderate_target (publication)', format('select public.moderate_target(''publication'', %L::uuid, ''hide'', ''razón'', null, %L::uuid, %L, %L)', public.t_id('p1'), public.t_id('R1id'), gen_random_uuid()::text, repeat('a', 64)), 'P0002|target_not_found|'),
  ('resolve_report (dismissed)', format('select public.resolve_report(%L::uuid, ''dismissed'', ''nota'', null, %L, %L)', public.t_id('R1id'), gen_random_uuid()::text, repeat('a', 64)), 'P0002|report_not_found|'),
  ('resolve_report (actioned)', format('select public.resolve_report(%L::uuid, ''actioned'', null, null, %L, %L)', public.t_id('R2id'), gen_random_uuid()::text, repeat('a', 64)), 'P0002|report_not_found|'),
  ('list_hidden_content', format('select public.list_hidden_content(%L::uuid)', public.t_id('site')), 'P0002|site_not_found|')
) as c (fn, sql, expected)
order by u.id, c.fn;
select is(public.t_deny('6', format('select public.list_open_reports(%L::uuid)', public.t_id('site2'))), 'ok', 'the moderator of the other site can read the queue of their own site');
select is(jsonb_array_length(public.list_open_reports(public.t_id('site2')) -> 'items'), 0, 'the other site has an empty queue (it never sees this site''s reports)');
select is(public.t_deny('4', format('select public.list_open_reports(%L::uuid)', public.t_id('site2'))), 'P0002|site_not_found|', 'the moderator of this site is denied the other site');
reset role;
select is(public.t_snap(), (select doc from ctx where name = 'snap0'), 'denied calls changed no event, state, report, or ledger row');
select is((select count(*)::int from public.moderation_events where publication_id in (select id from ctx where name in ('p1', 'p2', 'p3'))), 0, 'no moderation event exists yet');

-- Unauthenticated and anon
set local role authenticated;
select public.t_noauth();
select is(public.t_err(format('select public.list_open_reports(%L::uuid)', public.t_id('site'))), '28000|authentication_required|', 'list_open_reports without a session is 28000');
select is(public.t_err(format('select public.list_hidden_content(%L::uuid)', public.t_id('site'))), '28000|authentication_required|', 'list_hidden_content without a session is 28000');
select is(public.t_err(format('select public.get_moderation_target(''publication'', %L::uuid)', public.t_id('p1'))), '28000|authentication_required|', 'get_moderation_target without a session is 28000');
select is(public.t_mod('comment', public.t_id('c1'), 'hide', 'razón', null, null), '28000|authentication_required|', 'moderate_target without a session is 28000');
select is(public.t_res(public.t_id('R1id'), 'dismissed', 'nota', null), '28000|authentication_required|', 'resolve_report without a session is 28000');
reset role;
set local role anon;
select public.t_noauth();
select alike(public.t_mod('comment', public.t_id('c1'), 'hide', 'razón', null, null), '42501|%', 'anon is denied moderate_target (42501)');
select alike(public.t_res(public.t_id('R1id'), 'dismissed', 'nota', null), '42501|%', 'anon is denied resolve_report (42501)');
select alike(public.t_hid(public.t_id('site'), 5), '42501|%', 'anon is denied list_hidden_content (42501)');
select alike(public.t_open(public.t_id('site'), null, null, 5), '42501|%', 'anon is denied list_open_reports (42501)');
reset role;

-- 6. get_moderation_target on visible content
set local role authenticated;
select public.t_as('4');
insert into ctx select 'g_p1', null, public.get_moderation_target('publication', public.t_id('p1'));
insert into ctx select 'g_c1', null, public.get_moderation_target('comment', public.t_id('c1'));
select is(public.t_doc('g_p1') ->> 'state', 'visible', 'a visible publication is visible');
select is(public.t_doc('g_p1') ->> 'label', 'Etiqueta', 'the moderator reads the publication label');
select is(public.t_doc('g_p1') ->> 'summary', 'Resumen', 'the moderator reads the publication summary');
select is(public.t_doc('g_p1') ->> 'siteId', public.t_id('site')::text, 'the target reports its site');
select is(public.t_doc('g_p1') ->> 'publicationId', public.t_id('p1')::text, 'the target reports its publication');
select is(public.t_doc('g_p1') -> 'openReports', '1'::jsonb, 'the publication has one open report');
select is(public.t_doc('g_p1') -> 'history', '[]'::jsonb, 'a never moderated publication has an empty history');
select is(public.t_doc('g_c1') ->> 'body', 'Comentario uno', 'the moderator reads the comment body');
select is(public.t_doc('g_c1') ->> 'state', 'visible', 'a visible comment is visible');
select is(public.t_doc('g_c1') -> 'retracted', 'false'::jsonb, 'a live comment is not retracted');
select is(public.t_doc('g_c1') ->> 'authorAlias', 'Reportera Dos', 'the comment shows its author alias');
select is(public.t_doc('g_c1') -> 'openReports', '1'::jsonb, 'the comment has one open report');
select is(public.get_moderation_target('comment', public.t_id('c_retracted')) -> 'retracted', 'true'::jsonb, 'the moderator can read a retracted comment');
select is(public.get_moderation_target('comment', public.t_id('c_hidden')) ->> 'state', 'hidden', 'the moderator can read a hidden comment');
select is(public.get_moderation_target('publication', public.t_id('p3')) ->> 'state', 'hidden', 'the moderator can read a hidden publication');
select is(public.t_err(format('select public.get_moderation_target(''comment'', %L::uuid)', gen_random_uuid())), 'P0002|target_not_found|', 'an unknown comment is P0002');
select is(public.t_err(format('select public.get_moderation_target(''publication'', %L::uuid)', gen_random_uuid())), 'P0002|target_not_found|', 'an unknown publication is P0002');
select is(public.t_err('select public.get_moderation_target(''publication'', null)'), '22023|invalid_moderation_request|', 'a null target is 22023');

-- 7. moderate_target: hide a comment from a report
insert into ctx select 'h_c1', null, public.moderate_target('comment', public.t_id('c1'), 'hide', 'Acoso a otra persona', 'revisar cuenta', public.t_id('R2id'), 'mod-h-c1-key1', repeat('a', 64));
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.t_doc('h_c1')) as k),
  array['eventId', 'state', 'targetId', 'targetKind'], 'moderate_target returns eventId, targetKind, targetId, state');
select is(public.t_doc('h_c1') ->> 'state', 'hidden', 'hiding a comment returns state hidden');
reset role;
select is((select moderation_state::text from public.comments where id = public.t_id('c1')), 'hidden', 'the comment is hidden');
select is(
  (select to_jsonb(r) - 'created_at' - 'resolved_at' from public.reports as r where r.id = public.t_id('R2id')) ->> 'state', 'actioned', 'the report is actioned');
select is((select resolved_by from public.reports where id = public.t_id('R2id')), public.t_uid('4')::uuid, 'the report records who resolved it');
select is((select resolution_event_id from public.reports where id = public.t_id('R2id')), (public.t_doc('h_c1') ->> 'eventId')::uuid, 'the report records the resolution event');
select is((select resolved_at is not null from public.reports where id = public.t_id('R2id')), true, 'the report records when it was resolved');
select is(
  (select jsonb_build_object('action', e.action, 'reason', e.reason, 'note', e.private_note, 'actor', e.actor_id, 'kind', e.target_kind, 'pub', e.publication_id, 'comment', e.comment_id, 'site', e.site_id)
   from public.moderation_events as e where e.id = (public.t_doc('h_c1') ->> 'eventId')::uuid),
  jsonb_build_object('action', 'hide', 'reason', 'Acoso a otra persona', 'note', 'revisar cuenta', 'actor', public.t_uid('4'), 'kind', 'comment',
    'pub', public.t_id('p1'), 'comment', public.t_id('c1'), 'site', public.t_id('site')),
  'the event stores action, reason, private note, actor, and target');
select is(public.t_err(format('update public.moderation_events set reason = ''otra'' where id = %L', (public.t_doc('h_c1') ->> 'eventId')::uuid)), '55000|append_only_audit|', 'an event cannot be updated');
select is(public.t_err(format('delete from public.moderation_events where id = %L', (public.t_doc('h_c1') ->> 'eventId')::uuid)), '55000|append_only_audit|', 'an event cannot be deleted');
select isnt(public.t_err('truncate public.moderation_events'), 'ok', 'the events table cannot be truncated');

set local role authenticated;
select public.t_as('4');
select is(public.t_mod('comment', public.t_id('c1'), 'hide', 'Otra vez', null, null), 'FT409|moderation_state_unchanged|', 'hiding a hidden comment is FT409 moderation_state_unchanged');
select is(public.t_mod('comment', public.t_id('c2'), 'restore', 'Nada que restaurar', null, null), 'FT409|moderation_state_unchanged|', 'restoring a visible comment is FT409 moderation_state_unchanged');
select is(public.get_moderation_target('comment', public.t_id('c1')) ->> 'state', 'hidden', 'the target now reads hidden');
select is(jsonb_array_length(public.get_moderation_target('comment', public.t_id('c1')) -> 'history'), 1, 'the comment history has one event');
select is(
  (select to_jsonb(h) - 'eventId' - 'createdAt' from jsonb_array_elements(public.get_moderation_target('comment', public.t_id('c1')) -> 'history') as h limit 1),
  '{"action": "hide", "reason": "Acoso a otra persona", "privateNote": "revisar cuenta", "actorAlias": "Moderador Cuatro"}'::jsonb,
  'the history shows action, reason, private note, and actor alias to the moderator');
select is(public.get_moderation_target('comment', public.t_id('c1')) -> 'openReports', '0'::jsonb, 'the comment has no open reports after the action');
select is(jsonb_array_length(public.list_open_reports(public.t_id('site')) -> 'items'), 4, 'the actioned report left the queue');
-- restore, then reuse of the resolved report
insert into ctx select 'rs_c1', null, public.moderate_target('comment', public.t_id('c1'), 'restore', 'Revisado: se restaura', null, null, 'mod-rs-c1-key', repeat('b', 64));
select is(public.t_doc('rs_c1') ->> 'state', 'visible', 'restoring a comment returns state visible');
select is(public.t_mod('comment', public.t_id('c1'), 'hide', 'Con reporte resuelto', null, public.t_id('R2id')), 'FT409|report_already_resolved|', 'reusing a resolved report is FT409 report_already_resolved');
select is(public.get_moderation_target('comment', public.t_id('c1')) ->> 'state', 'visible', 'the failed hide changed nothing');
select is(jsonb_array_length(public.get_moderation_target('comment', public.t_id('c1')) -> 'history'), 2, 'the comment history has hide and restore');
-- report_mismatch
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'Mal reporte', null, public.t_id('R3id')), 'FT422|report_mismatch|', 'a report of a publication used for a comment is FT422 report_mismatch');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'Mal reporte', null, public.t_id('R2id')), 'FT422|report_mismatch|', 'a report of another comment is FT422 report_mismatch');
select is(public.t_mod('publication', public.t_id('p1'), 'hide', 'Mal reporte', null, public.t_id('R3id')), 'FT422|report_mismatch|', 'a report of another publication is FT422 report_mismatch');
select is(public.t_mod('publication', public.t_id('p1'), 'hide', 'Mal reporte', null, public.t_id('R4id')), 'FT422|report_mismatch|', 'a comment report used for a publication is FT422 report_mismatch');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'Mal reporte', null, gen_random_uuid()), 'FT422|report_mismatch|', 'an unknown report is FT422 report_mismatch');
select is(public.get_moderation_target('comment', public.t_id('c2')) ->> 'state', 'visible', 'a report mismatch hid nothing');
-- Input validation
select is(public.t_mod('comment', public.t_id('c2'), 'hide', '', null, null), '22023|invalid_moderation_request|', 'an empty reason is 22023');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', repeat('r', 501), null, null), '22023|invalid_moderation_request|', 'a reason of 501 characters is 22023');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'a' || chr(7) || 'b', null, null), '22023|invalid_moderation_request|', 'a reason with a control character is 22023');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', ' padded', null, null), '22023|invalid_moderation_request|', 'a padded reason is 22023');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', null, null, null), '22023|invalid_moderation_request|', 'a null reason is 22023');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'razón', repeat('n', 501), null), '22023|invalid_moderation_request|', 'a private note of 501 characters is 22023');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'razón', 'a' || chr(7), null), '22023|invalid_moderation_request|', 'a private note with a control character is 22023');
select is(public.t_mod('comment', public.t_id('c2'), 'dismiss', 'razón', null, null), '22023|invalid_moderation_request|', 'the dismiss action is not valid for moderate_target');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', repeat('r', 500), repeat('n', 500), null), 'ok', 'a reason and a private note of exactly 500 characters are accepted');
select is(public.t_mod('comment', public.t_id('c2'), 'restore', 'Se restaura', null, null), 'ok', 'restoring the comment after the long reason works');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'razón', null, null, 'short'), '22023|invalid_moderation_request|', 'a short idempotency key is 22023');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'razón', null, null, gen_random_uuid()::text, 'nothex'), '22023|invalid_moderation_request|', 'a malformed hash is 22023');
-- Idempotency
insert into ctx select 'h_c2', null, public.moderate_target('comment', public.t_id('c2'), 'hide', 'Datos personales', null, public.t_id('R4id'), 'mod-h-c2-key1', repeat('d', 64));
select is(public.moderate_target('comment', public.t_id('c2'), 'hide', 'Datos personales', null, public.t_id('R4id'), 'mod-h-c2-key1', repeat('d', 64)), public.t_doc('h_c2'), 'the same key and payload replays the identical moderation response');
select is(public.t_mod('comment', public.t_id('c2'), 'hide', 'Datos personales', null, public.t_id('R4id'), 'mod-h-c2-key1', repeat('e', 64)), 'FT001|idempotency_key_reused|', 'the same key with another hash is FT001');
reset role;
select is((select count(*)::int from public.moderation_events where action = 'hide' and comment_id = public.t_id('c2') and reason = 'Datos personales'), 1, 'a replay writes one event');
select is((select state::text from public.reports where id = public.t_id('R4id')), 'actioned', 'report R4 is actioned by the hide of c2');

-- Hide a publication from its report
set local role authenticated;
select public.t_as('4');
insert into ctx select 'h_p1', null, public.moderate_target('publication', public.t_id('p1'), 'hide', 'Spam comprobado', 'mismo patrón', public.t_id('R1id'), 'mod-h-p1-key1', repeat('f', 64));
select is(public.t_doc('h_p1') ->> 'state', 'hidden', 'hiding a publication returns state hidden');
reset role;
select is((select moderation_state::text from public.publications where id = public.t_id('p1')), 'hidden', 'the publication is hidden');
select is((select state::text from public.reports where id = public.t_id('R1id')), 'actioned', 'the publication report is actioned');
select is((select resolution_event_id from public.reports where id = public.t_id('R1id')), (public.t_doc('h_p1') ->> 'eventId')::uuid, 'the publication report links its event');
set local role anon;
select public.t_noauth();
select is(public.get_public_publication(public.t_id('p1')), null, 'the hidden publication is no longer public');
reset role;
set local role authenticated;
select public.t_as('4');
select is(public.get_moderation_target('publication', public.t_id('p1')) ->> 'state', 'hidden', 'the moderator still reads the hidden publication');
select is(public.t_mod('publication', public.t_id('p1'), 'hide', 'Otra vez', null, null), 'FT409|moderation_state_unchanged|', 'hiding a hidden publication is FT409');
select is(public.moderate_target('publication', public.t_id('p1'), 'restore', 'Revisión completada', null, null, 'mod-rs-p1-key', repeat('9', 64)) ->> 'state', 'visible', 'restoring a publication returns state visible');
select is(jsonb_array_length(public.get_moderation_target('publication', public.t_id('p1')) -> 'history'), 2, 'the publication history has hide and restore');
select is(
  (select h ->> 'privateNote' from jsonb_array_elements(public.get_moderation_target('publication', public.t_id('p1')) -> 'history') as h where h ->> 'action' = 'hide'),
  'mismo patrón', 'the publication history shows the private note');
select is(public.get_moderation_target('publication', public.t_id('p1')) #>> '{history,1,actorAlias}', 'Moderador Cuatro', 'the publication history shows the actor alias');

-- 8. resolve_report
select is(public.t_res(public.t_id('R3id'), 'dismissed', null, null), '22023|invalid_moderation_request|', 'dismissing without a note is 22023');
select is(public.t_res(public.t_id('R3id'), 'dismissed', '', null), '22023|invalid_moderation_request|', 'dismissing with an empty note is 22023');
select is(public.t_res(public.t_id('R3id'), 'dismissed', repeat('n', 501), null), '22023|invalid_moderation_request|', 'dismissing with a 501-character note is 22023');
select is(public.t_res(public.t_id('R3id'), 'dismissed', ' nota', null), '22023|invalid_moderation_request|', 'dismissing with a padded note is 22023');
select is(public.t_res(public.t_id('R3id'), 'ignored', 'nota', null), '22023|invalid_moderation_request|', 'an unknown outcome is 22023');
select is(public.t_res(public.t_id('R3id'), null, 'nota', null), '22023|invalid_moderation_request|', 'a null outcome is 22023');
select is(public.t_res(null, 'dismissed', 'nota', null), '22023|invalid_moderation_request|', 'a null report is 22023');
select is(public.t_res(gen_random_uuid(), 'dismissed', 'nota', null), 'P0002|report_not_found|', 'an unknown report is P0002');
insert into ctx select 'd_R3', null, public.resolve_report(public.t_id('R3id'), 'dismissed', 'Sin infracción', null, 'res-d-r3-key1', repeat('a', 64));
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.t_doc('d_R3')) as k),
  array['eventId', 'reportId', 'state'], 'resolve_report returns reportId, state, eventId');
select is(public.t_doc('d_R3') ->> 'state', 'dismissed', 'a dismissed report has state dismissed');
reset role;
select is(
  (select jsonb_build_object('action', e.action, 'reason', e.reason, 'kind', e.target_kind, 'pub', e.publication_id, 'comment', e.comment_id, 'actor', e.actor_id)
   from public.moderation_events as e where e.id = (public.t_doc('d_R3') ->> 'eventId')::uuid),
  jsonb_build_object('action', 'dismiss', 'reason', 'Sin infracción', 'kind', 'publication', 'pub', public.t_id('p2'), 'comment', null, 'actor', public.t_uid('4')),
  'dismissing creates a dismiss event with the note as reason');
select is((select state::text from public.reports where id = public.t_id('R3id')), 'dismissed', 'the report row is dismissed');
select is((select resolved_by from public.reports where id = public.t_id('R3id')), public.t_uid('4')::uuid, 'the dismissal records the moderator');
select is((select resolution_event_id from public.reports where id = public.t_id('R3id')), (public.t_doc('d_R3') ->> 'eventId')::uuid, 'the dismissal links its event');
select is((select moderation_state::text from public.publications where id = public.t_id('p2')), 'visible', 'dismissing leaves the publication visible');
set local role authenticated;
select public.t_as('4');
select is(public.resolve_report(public.t_id('R3id'), 'dismissed', 'Sin infracción', null, 'res-d-r3-key1', repeat('a', 64)), public.t_doc('d_R3'), 'the same key and payload replays the identical resolution');
select is(public.t_res(public.t_id('R3id'), 'dismissed', 'Sin infracción', null, 'res-d-r3-key1', repeat('b', 64)), 'FT001|idempotency_key_reused|', 'the same key with another hash is FT001');
select is(public.t_res(public.t_id('R3id'), 'dismissed', 'Otra nota', null), 'FT409|report_already_resolved|', 'a second resolution is FT409 report_already_resolved');
select is(public.t_res(public.t_id('R1id'), 'dismissed', 'Otra nota', null), 'FT409|report_already_resolved|', 'resolving an actioned report is FT409');
reset role;
select is(public.t_nev('publication', public.t_id('p2')), 1, 'only one event exists for p2 (the replay and the failures wrote none)');
set local role authenticated;
select public.t_as('4');
-- actioned needs an event of the same target
select is(public.t_res(public.t_id('R5id'), 'actioned', null, null), 'FT422|report_mismatch|', 'actioned without an event is FT422');
select is(public.t_res(public.t_id('R5id'), 'actioned', null, gen_random_uuid()), 'FT422|report_mismatch|', 'actioned with an unknown event is FT422');
select is(public.t_res(public.t_id('R5id'), 'actioned', null, (public.t_doc('h_p1') ->> 'eventId')::uuid), 'FT422|report_mismatch|', 'actioned with an event of another target is FT422');
select is(public.t_res(public.t_id('R5id'), 'actioned', null, (public.t_doc('h_c2') ->> 'eventId')::uuid), 'FT422|report_mismatch|', 'actioned with an event of another comment is FT422');
select is(public.t_res(public.t_id('R5id'), 'actioned', null, (public.t_doc('d_R3') ->> 'eventId')::uuid), 'FT422|report_mismatch|', 'actioned with a dismiss event is FT422');
select is(public.get_moderation_target('comment', public.t_id('c3')) -> 'openReports', '1'::jsonb, 'the failed resolutions left report R5 open');
insert into ctx select 'h_c3', null, public.moderate_target('comment', public.t_id('c3'), 'hide', 'Ofensivo', null, null, 'mod-h-c3-key1', repeat('a', 64));
insert into ctx select 'a_R5', null, public.resolve_report(public.t_id('R5id'), 'actioned', null, (public.t_doc('h_c3') ->> 'eventId')::uuid, 'res-a-r5-key1', repeat('a', 64));
select is(public.t_doc('a_R5') ->> 'state', 'actioned', 'actioned with an event of the same target works');
select is(public.t_doc('a_R5') ->> 'eventId', public.t_doc('h_c3') ->> 'eventId', 'the resolution reuses the given event');
select is(public.t_res(public.t_id('R5id'), 'actioned', null, (public.t_doc('h_c3') ->> 'eventId')::uuid), 'FT409|report_already_resolved|', 'resolving R5 again is FT409');
select is(jsonb_array_length(public.list_open_reports(public.t_id('site')) -> 'items'), 0, 'every report is resolved, the queue is empty');
select is(public.list_open_reports(public.t_id('site')), '{"items": [], "nextCursor": null}'::jsonb, 'an empty queue has no cursor');
reset role;
select is((select count(*)::int from public.reports where state = 'open' and reporter_id::text like '98000000-0000-4000-8000-%'), 0, 'no report is open');

-- 9. list_hidden_content
set local role authenticated;
select public.t_as('4');
-- c3 is hidden (event h_c3); hide p2 and c2 as well
insert into ctx select 'h_p2', null, public.moderate_target('publication', public.t_id('p2'), 'hide', 'Contenido retirado', null, null, 'mod-h-p2-key1', repeat('a', 64));
insert into ctx select 'hl_all', null, public.list_hidden_content(public.t_id('site'));
select is(jsonb_array_length(public.t_doc('hl_all') -> 'items'), 3, 'three items are hidden: p2, c2, c3');
select is(
  (select string_agg(i ->> 'targetKind' || ':' || (i ->> 'targetId'), ',' order by i ->> 'targetKind', i ->> 'targetId') from jsonb_array_elements(public.t_doc('hl_all') -> 'items') as i),
  'comment:' || least(public.t_id('c2')::text, public.t_id('c3')::text) || ',comment:' || greatest(public.t_id('c2')::text, public.t_id('c3')::text) || ',publication:' || public.t_id('p2')::text,
  'the hidden list names the publication and both comments');
select is(
  (select i ->> 'reason' from jsonb_array_elements(public.t_doc('hl_all') -> 'items') as i where i ->> 'targetId' = public.t_id('p2')::text),
  'Contenido retirado', 'the hidden publication shows its hide reason');
select is(
  (select i ->> 'reason' from jsonb_array_elements(public.t_doc('hl_all') -> 'items') as i where i ->> 'targetId' = public.t_id('c3')::text),
  'Ofensivo', 'a hidden comment shows its hide reason');
select is(
  (select to_jsonb(i) - 'hiddenAt' from jsonb_array_elements(public.t_doc('hl_all') -> 'items') as i where i ->> 'targetId' = public.t_id('c3')::text),
  jsonb_build_object('targetKind', 'comment', 'targetId', public.t_id('c3'), 'publicationId', public.t_id('p2'), 'commentId', public.t_id('c3'), 'preview', 'Comentario tres', 'reason', 'Ofensivo'),
  'a hidden comment item has the documented keys');
select is(
  (select to_jsonb(i) - 'hiddenAt' from jsonb_array_elements(public.t_doc('hl_all') -> 'items') as i where i ->> 'targetId' = public.t_id('p2')::text),
  jsonb_build_object('targetKind', 'publication', 'targetId', public.t_id('p2'), 'publicationId', public.t_id('p2'), 'commentId', null, 'preview', 'Etiqueta', 'reason', 'Contenido retirado'),
  'a hidden publication item has the documented keys');
select is(jsonb_array_length(public.list_hidden_content(public.t_id('site'), 1) -> 'items'), 1, 'limit 1 returns one item');
select is(public.t_hid(public.t_id('site'), 0), '22023|invalid_page_request|', 'limit 0 is 22023');
select is(public.t_hid(public.t_id('site'), 51), '22023|invalid_page_request|', 'limit 51 is 22023');
select is(public.t_hid(public.t_id('site'), null), '22023|invalid_page_request|', 'a null limit is 22023');
select is(public.t_hid(public.t_id('site'), 50), 'ok', 'limit 50 is accepted');
-- last hide reason wins after hide, restore, hide
-- Events written in one transaction share created_at, so a later hide event is inserted directly with a later time.
reset role;
insert into public.moderation_events (id, site_id, target_kind, publication_id, comment_id, action, reason, actor_id, created_at)
values (public.t_uid('e9')::uuid, public.t_id('site'), 'comment', public.t_id('p2'), public.t_id('c3'), 'hide', 'Segunda ocultación', public.t_uid('4')::uuid, timestamptz '2099-01-01 00:00:00+00');
set local role authenticated;
select public.t_as('4');
select is(
  (select i ->> 'reason' from jsonb_array_elements(public.list_hidden_content(public.t_id('site')) -> 'items') as i where i ->> 'targetId' = public.t_id('c3')::text),
  'Segunda ocultación', 'the list shows the reason of the latest hide event');
-- Moderators have no rate limit: 12 toggles of c2 (currently hidden)
select is(
  (select count(*)::int from generate_series(1, 12) as g
   where public.t_mod('comment', public.t_id('c2'), case when g % 2 = 1 then 'restore' else 'hide' end, 'Ciclo ' || g, null, null) = 'ok'),
  12, 'twelve moderation calls in a row all succeed (no rate limit)');
select is(
  (select i ->> 'reason' from jsonb_array_elements(public.list_hidden_content(public.t_id('site')) -> 'items') as i where i ->> 'targetId' = public.t_id('c2')::text),
  (select r from (values ('Ciclo 2'), ('Ciclo 4'), ('Ciclo 6'), ('Ciclo 8'), ('Ciclo 10'), ('Ciclo 12'), ('Datos personales'), (repeat('r', 500))) as v (r) where r = (select i2 ->> 'reason' from jsonb_array_elements(public.list_hidden_content(public.t_id('site')) -> 'items') as i2 where i2 ->> 'targetId' = public.t_id('c2')::text)),
  'after the cycle c2 is hidden with the reason of one of its hide events');
reset role;
select is((select count(*)::int from public.rate_windows where actor_id = public.t_uid('4')::uuid), 0, 'the moderator consumed no rate unit');
select is((select count(*)::int from public.moderation_events where actor_id = public.t_uid('4')::uuid), (select count(*)::int from public.moderation_events where publication_id in (select id from ctx where name in ('p1', 'p2', 'p3'))), 'every event was written by the moderator');
set local role authenticated;
select public.t_as('4');
select is(public.t_mod('comment', public.t_id('c2'), 'restore', 'Fin', null, null), 'ok', 'c2 is restored');
select is(public.t_mod('comment', public.t_id('c3'), 'restore', 'Fin', null, null), 'ok', 'c3 is restored');
select is(public.t_mod('publication', public.t_id('p2'), 'restore', 'Fin', null, null), 'ok', 'p2 is restored');
select is(public.list_hidden_content(public.t_id('site')), '{"items": []}'::jsonb, 'the hidden list is empty after every restore');
select public.t_as('6');
select is(public.t_deny('6', format('select public.list_hidden_content(%L::uuid)', public.t_id('site'))), 'P0002|site_not_found|', 'the moderator of another site cannot read the hidden list');
select is(public.list_hidden_content(public.t_id('site2')), '{"items": []}'::jsonb, 'the other site has an empty hidden list');
reset role;
-- The hidden publication p3 (hidden directly as postgres, no event) is not listed because it has no hide event
set local role authenticated;
select public.t_as('4');
select is(public.t_ids(public.list_hidden_content(public.t_id('site')), 'targetId'), '', 'content hidden without any event is not listed');
reset role;

select * from finish();
rollback;
