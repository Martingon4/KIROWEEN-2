begin;

select plan(82);

-- Covers migration 20261124070000_community_review_fixes.sql. The plain_text_ok cases
-- live in 012_community_schema.test.sql. Every count here is limited to rows made by this test.

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

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
create function public.t_canopy(p_id text) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'kind', 'shade_canopy',
    'properties', jsonb_build_object('label', 'Cubierta', 'heightM', 4.5),
    'geometry', jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(jsonb_build_array(
      jsonb_build_array(-98.19825, 19.04358), jsonb_build_array(-98.19805, 19.04358),
      jsonb_build_array(-98.19805, 19.04372), jsonb_build_array(-98.19825, 19.04372),
      jsonb_build_array(-98.19825, 19.04358)))))
$$;
create function public.t_branch(p_title text) returns uuid language sql as $$
  select (public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', p_title, gen_random_uuid()::text, repeat('a', 64)) ->> 'branchId')::uuid
$$;
create function public.t_head(p_branch uuid) returns uuid language sql as
$$ select (public.get_branch_head(p_branch) ->> 'revisionId')::uuid $$;
create function public.t_save(p_branch uuid, p_features jsonb) returns uuid language sql as $$
  select (public.save_revision(p_branch, public.t_head(p_branch), 'Save', p_features, gen_random_uuid()::text, repeat('b', 64)) ->> 'revisionId')::uuid
$$;
create function public.t_pub(p_rev uuid, p_label text default 'Etiqueta') returns uuid language sql as $$
  select (public.publish_revision(p_rev, p_label, 'Resumen', gen_random_uuid()::text, repeat('c', 64)) ->> 'publicationId')::uuid
$$;
create function public.t_alias(p_user text, p_alias text) returns text language sql as $$
  select public.t_err(format('update public.profiles set public_alias = %L where id = %L', p_alias, public.t_uid(p_user)))
$$;
create function public.t_res(p_report uuid, p_outcome text, p_note text, p_event uuid,
  p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64)) returns text language sql as $$
  select public.t_err(format('select public.resolve_report(%L::uuid, %L, %L, %L::uuid, %L, %L)', p_report, p_outcome, p_note, p_event, p_key, p_hash))
$$;
create function public.t_consume(p_user text, p_action text, p_at timestamptz) returns text language sql as $$
  select public.t_err(format('select public.rate_limit_consume(%L::uuid, %L, %L::timestamptz)', public.t_uid(p_user), p_action, p_at))
$$;

-- 1. Setup (as postgres)
-- Users: 1 publisher, 2 and 3 and 5 reporters, 4 moderator, 6 and 7 alias owners.
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n::text)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from generate_series(1, 7) as n;
insert into public.site_roles (site_id, user_id, role)
values ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('4')::uuid, 'moderator');

set local role authenticated;
select public.t_as('1');
insert into ctx select 'b1', public.t_branch('Review fixes 1'), null;
insert into ctx select 'r1', public.t_save(public.t_id('b1'), jsonb_build_array(public.t_canopy(public.t_uid('f1')))), null;
insert into ctx select 'p1', public.t_pub(public.t_id('r1'), 'Publicacion uno'), null;
insert into ctx select 'b2', public.t_branch('Review fixes 2'), null;
insert into ctx select 'r2', public.t_save(public.t_id('b2'), jsonb_build_array(public.t_canopy(public.t_uid('f2')))), null;
insert into ctx select 'p2', public.t_pub(public.t_id('r2'), 'Publicacion dos'), null;
insert into ctx select 'b3', public.t_branch('Review fixes 3'), null;
insert into ctx select 'r3', public.t_save(public.t_id('b3'), jsonb_build_array(public.t_canopy(public.t_uid('f3')))), null;
insert into ctx select 'p3', public.t_pub(public.t_id('r3'), 'Publicacion tres'), null;
insert into ctx select 'b4', public.t_branch('Review fixes 4'), null;
insert into ctx select 'r4', public.t_save(public.t_id('b4'), jsonb_build_array(public.t_canopy(public.t_uid('f4')))), null;
insert into ctx select 'p4', public.t_pub(public.t_id('r4'), 'Publicacion cuatro'), null;
reset role;

-- 2. profile_alias_ok
select is(has_function_privilege(r.role, 'public.profile_alias_ok(text)', 'EXECUTE'), true, r.role || ' can execute profile_alias_ok')
from unnest(array['anon', 'authenticated']) as r (role) order by r.role;
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc as p where p.oid = 'public.profile_alias_ok(text)'::regprocedure),
  true, 'profile_alias_ok is SECURITY DEFINER with an empty search_path');

select is(public.profile_alias_ok('Muñoz Pérez'), true, 'alias accepts accents and a space');
select is(public.profile_alias_ok('Ana-2'), true, 'alias accepts a hyphen and a digit');
select is(public.profile_alias_ok('Ana'), true, 'alias accepts a plain name');
select is(public.profile_alias_ok(chr(1072) || 'na'), false, 'alias rejects a Cyrillic a (U+0430)');
select is(public.profile_alias_ok('Ana' || chr(8238)), false, 'alias rejects a bidi override (U+202E)');
select is(public.profile_alias_ok('An' || chr(8203) || 'a'), false, 'alias rejects a zero-width space');
select is(public.profile_alias_ok(chr(160) || 'Ana' || chr(160)), false, 'alias rejects NBSP padding');
select is(public.profile_alias_ok(' Ana'), false, 'alias rejects a leading space');
select is(public.profile_alias_ok('-Ana'), false, 'alias rejects leading punctuation (hyphen)');
select is(public.profile_alias_ok('.Ana'), false, 'alias rejects leading punctuation (dot)');
select is(public.profile_alias_ok('participant'), false, 'alias rejects participant');
select is(public.profile_alias_ok('Moderator'), false, 'alias rejects Moderator (case-insensitive)');
select is(public.profile_alias_ok('ADMIN'), false, 'alias rejects ADMIN (case-insensitive)');
select is(public.profile_alias_ok('system'), false, 'alias rejects system');
select is(public.profile_alias_ok('moderación'), false, 'alias rejects moderación');
select is(public.profile_alias_ok('Moderación'), false, 'alias rejects Moderación');
select is(public.profile_alias_ok('An' || chr(7) || 'a'), false, 'alias rejects a control character');
select is(public.profile_alias_ok(null), false, 'alias rejects null');
select is(public.profile_alias_ok('participant-e411e8ff'), true, 'a generated alias (participant-xxxxxxxx) is still valid');

-- 3. profiles constraint through a real update by the owner
set local role authenticated;
select public.t_as('6');
select is(public.t_alias('6', 'Zoraida Prueba 17'), 'ok', 'a user updates their own alias to a valid one');
select is((select public_alias from public.profiles where id = public.t_uid('6')::uuid), 'Zoraida Prueba 17', 'the valid alias was stored');
select alike(public.t_alias('6', chr(1072) || 'na'), '23514|%profiles_alias_safe%', 'a Cyrillic alias fails with 23514');
select alike(public.t_alias('6', 'Zoraida' || chr(8203)), '23514|%profiles_alias_safe%', 'a zero-width alias fails with 23514');
select alike(public.t_alias('6', 'Moderator'), '23514|%profiles_alias_safe%', 'a reserved alias fails with 23514');
select alike(public.t_alias('6', ' Zoraida'), '23514|%profiles_alias_safe%', 'a padded alias fails with 23514');
select is((select public_alias from public.profiles where id = public.t_uid('6')::uuid), 'Zoraida Prueba 17', 'rejected updates left the alias unchanged');
reset role;

-- 4. Folded unique index
select is(
  (select indexdef like '%lower(NORMALIZE(public_alias, NFKC))%' and indexdef like 'CREATE UNIQUE INDEX%' from pg_indexes
   where schemaname = 'public' and indexname = 'profiles_alias_folded_idx'),
  true, 'profiles_alias_folded_idx is a unique index on lower(normalize(alias, NFKC))');
update public.profiles set public_alias = 'Quetzal Unico' where id = public.t_uid('6')::uuid;
select alike(
  public.t_err(format('update public.profiles set public_alias = %L where id = %L', 'quetzal unico', public.t_uid('7'))),
  '23505|%profiles_alias_folded_idx%', 'an alias differing only by case collides (23505)');
select alike(
  public.t_err(format('update public.profiles set public_alias = %L where id = %L', 'QUETZAL UNICO', public.t_uid('7'))),
  '23505|%profiles_alias_folded_idx%', 'an alias differing only by upper case collides (23505)');
-- A fullwidth letter would fold to ASCII under NFKC, but the Latin-only character check
-- rejects it first, so the check constraint answers before the index is reached.
select alike(
  public.t_err(format('update public.profiles set public_alias = %L where id = %L', chr(65313) || 'na', public.t_uid('7'))),
  '23514|%profiles_alias_safe%', 'a fullwidth letter (NFKC would fold it) is rejected by the character check (23514)');
select is(public.t_alias('7', 'Quetzal Otro'), 'ok', 'a different alias is accepted');
select is(
  public.t_err(format('update public.profiles set public_alias = %L where id = %L', 'Quetzal Unico', public.t_uid('6'))),
  'ok', 'a user can rewrite their own alias unchanged');

-- 5. create_report advisory lock and deduplication
select is(
  (select (length(d) - length(replace(d, 'pg_advisory_xact_lock', ''))) / length('pg_advisory_xact_lock')
   from (select pg_get_functiondef('public.create_report(public.moderation_target_kind,uuid,public.report_reason,text,text,text)'::regprocedure) as d) as q),
  2, 'create_report takes two advisory locks (idempotency key, reporter and target)');
select is(
  (select pg_get_functiondef('public.create_report(public.moderation_target_kind,uuid,public.report_reason,text,text,text)'::regprocedure) like '%'':report:''%'),
  true, 'create_report builds the per-target lock key with '':report:''');

set local role authenticated;
select public.t_as('3');
insert into ctx select 'dupA', null, public.create_report('publication', public.t_id('p3'), 'spam', null, 'dup-key-0001', repeat('1', 64));
insert into ctx select 'dupB', null, public.create_report('publication', public.t_id('p3'), 'spam', null, 'dup-key-0002', repeat('2', 64));
insert into ctx select 'dupC', null, public.create_report('publication', public.t_id('p3'), 'harassment', 'otro motivo', 'dup-key-0003', repeat('3', 64));
reset role;
select is(public.t_doc('dupA') -> 'duplicate', 'false'::jsonb, 'the first report is not a duplicate');
select is(public.t_doc('dupB') -> 'duplicate', 'true'::jsonb, 'a second key for the same target is a duplicate');
select is(public.t_doc('dupC') -> 'duplicate', 'true'::jsonb, 'a third key with another reason is also a duplicate');
select is(public.t_doc('dupB') ->> 'reportId', public.t_doc('dupA') ->> 'reportId', 'the duplicate returns the id of the first report');
select is(public.t_doc('dupC') ->> 'reportId', public.t_doc('dupA') ->> 'reportId', 'the third request returns the same report id');
select is(
  (select count(*)::int from public.reports where reporter_id = public.t_uid('3')::uuid and publication_id = public.t_id('p3') and state = 'open'),
  1, 'exactly one open report exists for that reporter and target');
select is(
  (select coalesce(sum(w.count), 0)::int from public.rate_windows as w where w.actor_id = public.t_uid('3')::uuid and w.action = 'report'),
  1, 'only the real report consumed a rate unit');
select is(
  (select count(*)::int from public.mutation_requests where actor_id = public.t_uid('3')::uuid and operation = 'create_report'),
  3, 'each of the three idempotency keys was recorded');

-- 6. resolve_report: an actioned event cannot predate the report
set local role authenticated;
select public.t_as('2');
insert into ctx select 'rep1', null, public.create_report('publication', public.t_id('p4'), 'spam', null, 'res-key-0001', repeat('4', 64));
select public.t_as('5');
insert into ctx select 'rep2', null, public.create_report('publication', public.t_id('p4'), 'spam', null, 'res-key-0002', repeat('5', 64));
reset role;
insert into ctx values
  ('rep1id', (public.t_doc('rep1') ->> 'reportId')::uuid, null),
  ('rep2id', (public.t_doc('rep2') ->> 'reportId')::uuid, null);
insert into public.moderation_events (id, site_id, target_kind, publication_id, comment_id, action, reason, actor_id, created_at)
select public.t_uid('e1')::uuid, r.site_id, 'publication', r.publication_id, null, 'hide', 'Evento anterior', public.t_uid('4')::uuid,
  r.created_at - interval '1 day'
from public.reports as r where r.id = public.t_id('rep1id');
insert into public.moderation_events (id, site_id, target_kind, publication_id, comment_id, action, reason, actor_id, created_at)
select public.t_uid('e2')::uuid, r.site_id, 'publication', r.publication_id, null, 'hide', 'Evento simultaneo', public.t_uid('4')::uuid,
  r.created_at
from public.reports as r where r.id = public.t_id('rep1id');
insert into public.moderation_events (id, site_id, target_kind, publication_id, comment_id, action, reason, actor_id, created_at)
select public.t_uid('e3')::uuid, r.site_id, 'publication', r.publication_id, null, 'hide', 'Evento posterior', public.t_uid('4')::uuid,
  r.created_at + interval '1 hour'
from public.reports as r where r.id = public.t_id('rep2id');

set local role authenticated;
select public.t_as('4');
select is(public.t_res(public.t_id('rep1id'), 'actioned', null, public.t_uid('e1')::uuid), 'FT422|report_mismatch|', 'an event one day older than the report is report_mismatch');
select is(public.t_res(public.t_id('rep1id'), 'actioned', null, public.t_uid('e2')::uuid), 'ok', 'an event created at the same instant as the report resolves it');
select is(public.t_res(public.t_id('rep2id'), 'actioned', null, public.t_uid('e3')::uuid), 'ok', 'an event after the report resolves it');
reset role;
select is((select state::text from public.reports where id = public.t_id('rep1id')), 'actioned', 'the report at the event instant is actioned');
select is((select resolution_event_id from public.reports where id = public.t_id('rep1id')), public.t_uid('e2')::uuid, 'the report links the accepted event');
select is((select state::text from public.reports where id = public.t_id('rep2id')), 'actioned', 'the report with a later event is actioned');

-- 7. rate_limit_consume purge and the window cap
insert into public.rate_limits (action, max_count, window_seconds) values ('t_long', 5, 86400);
select alike(
  public.t_err($$insert into public.rate_limits (action, max_count, window_seconds) values ('t_toolong', 5, 86401)$$),
  '23514|%rate_limits_window_max%', 'a window of 86401 seconds violates rate_limits_window_max');
select is(
  public.t_err($$insert into public.rate_limits (action, max_count, window_seconds) values ('t_dayok', 5, 86400)$$),
  'ok', 'a window of exactly 86400 seconds is accepted');
select alike(
  public.t_err($$update public.rate_limits set window_seconds = 172800 where action = 'comment'$$),
  '23514|%rate_limits_window_max%', 'raising an existing window above one day is rejected');
insert into public.rate_windows (actor_id, action, window_start, count) values
  (public.t_uid('2')::uuid, 't_long', timestamptz '2030-03-01 00:00:00+00', 1),
  (public.t_uid('2')::uuid, 't_long', timestamptz '2030-03-04 00:00:00+00', 1);
select is(public.t_consume('2', 't_long', timestamptz '2030-03-05 10:30:00+00'), 'ok', 'consuming on a one-day window works');
select is(
  (select w.count from public.rate_windows as w where w.actor_id = public.t_uid('2')::uuid and w.action = 't_long'
   and w.window_start = timestamptz '2030-03-05 00:00:00+00'),
  1, 'the current bucket of a one-day window is not purged');
select is(
  (select count(*)::int from public.rate_windows as w where w.actor_id = public.t_uid('2')::uuid and w.action = 't_long'
   and w.window_start in (timestamptz '2030-03-01 00:00:00+00', timestamptz '2030-03-04 00:00:00+00')),
  0, 'buckets older than a day are purged');
select is(public.t_consume('2', 't_long', timestamptz '2030-03-05 11:00:00+00'), 'ok', 'a second call in the same window works');
select is(
  (select w.count from public.rate_windows as w where w.actor_id = public.t_uid('2')::uuid and w.action = 't_long'
   and w.window_start = timestamptz '2030-03-05 00:00:00+00'),
  2, 'the live bucket kept counting (it was not deleted between calls)');

-- 8. Indexes
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'moderation_events_comment_idx') is not null,
  true, 'moderation_events_comment_idx exists');
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'moderation_events_publication_idx') is not null,
  true, 'moderation_events_publication_idx exists');
select is(
  (select indexdef like '%(comment_id, action, created_at DESC, id DESC)%' and indexdef like '%WHERE (comment_id IS NOT NULL)%'
   from pg_indexes where schemaname = 'public' and indexname = 'moderation_events_comment_idx'),
  true, 'the comment index is partial on comment_id is not null');
select is(
  (select indexdef like '%(publication_id, action, created_at DESC, id DESC)%' and indexdef like '%WHERE (comment_id IS NULL)%'
   from pg_indexes where schemaname = 'public' and indexname = 'moderation_events_publication_idx'),
  true, 'the publication index is partial on comment_id is null');

-- 9. list_my_hidden_publications
select is(has_function_privilege('anon', 'public.list_my_hidden_publications()', 'EXECUTE'), false, 'anon cannot execute list_my_hidden_publications');
select is(has_function_privilege('public', 'public.list_my_hidden_publications()', 'EXECUTE'), false, 'public cannot execute list_my_hidden_publications');
select is(has_function_privilege('authenticated', 'public.list_my_hidden_publications()', 'EXECUTE'), true, 'authenticated can execute list_my_hidden_publications');

-- p1 (author 1) is hidden twice with different reasons; p2 (author 1 as well) stays visible.
-- A second author owns p5, hidden too, which author 1 must never see.
set local role authenticated;
select public.t_as('7');
insert into ctx select 'b5', public.t_branch('Review fixes 5'), null;
insert into ctx select 'r5', public.t_save(public.t_id('b5'), jsonb_build_array(public.t_canopy(public.t_uid('f5')))), null;
insert into ctx select 'p5', public.t_pub(public.t_id('r5'), 'Publicacion ajena'), null;
select public.t_as('1');
select is(public.list_my_hidden_publications(), '{"items": []}'::jsonb, 'an author with nothing hidden gets an empty list');
reset role;

update public.publications set moderation_state = 'hidden' where id in (public.t_id('p1'), public.t_id('p5'));
insert into public.moderation_events (id, site_id, target_kind, publication_id, comment_id, action, reason, private_note, actor_id, created_at) values
  (public.t_uid('e4')::uuid, '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'publication', public.t_id('p1'), null, 'hide', 'Motivo antiguo', null, public.t_uid('4')::uuid, now() - interval '2 days'),
  (public.t_uid('e5')::uuid, '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'publication', public.t_id('p1'), null, 'hide', 'Motivo publico vigente', 'NOTA-PRIVADA-SECRETA', public.t_uid('4')::uuid, now() - interval '1 day'),
  (public.t_uid('e6')::uuid, '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'publication', public.t_id('p5'), null, 'hide', 'Motivo de otra persona', 'OTRA-NOTA-PRIVADA', public.t_uid('4')::uuid, now());

set local role authenticated;
select public.t_as('1');
insert into ctx select 'mine1', null, public.list_my_hidden_publications();
select public.t_as('7');
insert into ctx select 'mine7', null, public.list_my_hidden_publications();
select public.t_as('3');
insert into ctx select 'mine3', null, public.list_my_hidden_publications();
reset role;

select is(jsonb_array_length(public.t_doc('mine1') -> 'items'), 1, 'author 1 sees exactly one hidden publication');
select is(public.t_doc('mine1') #>> '{items,0,publicationId}', public.t_id('p1')::text, 'it is their own hidden publication');
select is(public.t_doc('mine1') #>> '{items,0,label}', 'Publicacion uno', 'the public label is returned');
select is(public.t_doc('mine1') #>> '{items,0,reason}', 'Motivo publico vigente', 'the latest hide reason is returned');
select is(
  (select array_agg(k order by k collate "C") from jsonb_object_keys(public.t_doc('mine1') -> 'items' -> 0) as k),
  array['hiddenAt', 'label', 'publicationId', 'reason']::text[], 'an item has only publicationId, label, reason, hiddenAt');
select is(public.t_doc('mine1')::text like '%' || public.t_id('p5')::text || '%', false, 'another author''s hidden publication is not listed');
select is(public.t_doc('mine1')::text like '%NOTA-PRIVADA%' or public.t_doc('mine1')::text like '%OTRA-NOTA%', false, 'no private note is returned');
select is(public.t_doc('mine1')::text like '%' || public.t_uid('4') || '%', false, 'the moderator id is never returned');
select is(public.t_doc('mine1')::text like '%' || public.t_uid('2') || '%' or public.t_doc('mine1')::text like '%' || public.t_uid('5') || '%', false, 'no reporter id is returned');
select is(jsonb_array_length(public.t_doc('mine7') -> 'items'), 1, 'author 7 sees exactly one hidden publication');
select is(public.t_doc('mine7') #>> '{items,0,reason}', 'Motivo de otra persona', 'author 7 sees their own reason');
select is(public.t_doc('mine7')::text like '%' || public.t_id('p1')::text || '%', false, 'author 7 does not see author 1''s publication');
select is(public.t_doc('mine3'), '{"items": []}'::jsonb, 'a user who published nothing gets an empty list');

set local role anon;
select alike(public.t_err('select public.list_my_hidden_publications()'), '42501|%', 'anon is denied list_my_hidden_publications (42501)');
reset role;
set local role authenticated;
select public.t_noauth();
select is(public.t_err('select public.list_my_hidden_publications()'), '28000|authentication_required|', 'list_my_hidden_publications without a session is 28000');
reset role;

select * from finish();
rollback;
