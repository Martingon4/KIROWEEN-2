begin;

select plan(156);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction). They run as the calling role.
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
create function public.t_doc(p text) returns jsonb language sql stable as $$ select doc from ctx where name = p $$;
create function public.t_uid(p text) returns text language sql immutable as
$$ select '97000000-0000-4000-8000-' || lpad(p, 12, '0') $$;
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
-- Error text of create_comment / set_support / retract_comment as the current role.
create function public.t_cc(p_pub uuid, p_feat uuid, p_body text, p_key text, p_hash text default repeat('a', 64)) returns text language sql as $$
  select public.t_err(format('select public.create_comment(%L::uuid, %L::uuid, %L, %L, %L)', p_pub, p_feat, p_body, p_key, p_hash))
$$;
create function public.t_sup(p_pub uuid, p_on boolean) returns text language sql as $$
  select public.t_err(format('select public.set_support(%L::uuid, %L::boolean)', p_pub, p_on))
$$;
create function public.t_ret(p_id uuid) returns text language sql as $$
  select public.t_err(format('select public.retract_comment(%L::uuid)', p_id))
$$;
create function public.t_list(p_pub uuid, p_at timestamptz default null, p_after uuid default null, p_limit integer default 20) returns text language sql as $$
  select public.t_err(format('select public.list_public_comments(%L::uuid, %L::timestamptz, %L::uuid, %L::integer)', p_pub, p_at, p_after, p_limit))
$$;
-- Ids of a list page, in order, as text.
create function public.t_page_ids(p jsonb) returns text language sql immutable as $$
  select coalesce(string_agg(i ->> 'commentId', ',' order by o), '') from jsonb_array_elements(p -> 'items') with ordinality as t (i, o)
$$;
create function public.t_ncomments(p_pub uuid) returns integer language sql as
$$ select count(*)::int from public.comments where publication_id = p_pub $$;
create function public.t_used(p_actor text, p_action text) returns integer language sql as $$
  select coalesce(sum(w.count), 0)::int from public.rate_windows as w
  where w.actor_id = public.t_uid(p_actor)::uuid and w.action = p_action
$$;

-- 1. Setup (as postgres): four users, publications p1 (canopy f1), p2 (tree f2), p3 (hidden)
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n::text)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from generate_series(1, 4) as n;

set local role authenticated;
select public.t_as('1');
insert into ctx select 'b1', public.t_branch('Comments one'), null;
insert into ctx select 'r1', public.t_save(public.t_id('b1'), jsonb_build_array(public.t_canopy(public.t_uid('f1')))), null;
insert into ctx select 'p1', public.t_pub(public.t_id('r1')), null;
insert into ctx select 'b2', public.t_branch('Comments two'), null;
insert into ctx select 'r2', public.t_save(public.t_id('b2'), jsonb_build_array(public.t_tree(public.t_uid('f2'), public.t_pt(-98.19775, 19.0436), 'Arbol'))), null;
insert into ctx select 'p2', public.t_pub(public.t_id('r2')), null;
insert into ctx select 'b3', public.t_branch('Comments three'), null;
insert into ctx select 'r3', public.t_save(public.t_id('b3'), jsonb_build_array(public.t_tree(public.t_uid('f3'), public.t_pt(-98.19770, 19.0436)))), null;
insert into ctx select 'p3', public.t_pub(public.t_id('r3')), null;
reset role;
update public.publications set moderation_state = 'hidden' where id = public.t_id('p3');

-- 2. Grants
select is(has_function_privilege('anon', 'public.create_comment(uuid,uuid,text,text,text)', 'EXECUTE'), false, 'anon cannot execute create_comment');
select is(has_function_privilege('authenticated', 'public.create_comment(uuid,uuid,text,text,text)', 'EXECUTE'), true, 'authenticated can execute create_comment');
select is(has_function_privilege('anon', 'public.retract_comment(uuid)', 'EXECUTE'), false, 'anon cannot execute retract_comment');
select is(has_function_privilege('anon', 'public.set_support(uuid,boolean)', 'EXECUTE'), false, 'anon cannot execute set_support');
select is(has_function_privilege('anon', 'public.my_support_state(uuid)', 'EXECUTE'), false, 'anon cannot execute my_support_state');
select is(has_function_privilege('authenticated', 'public.my_support_state(uuid)', 'EXECUTE'), true, 'authenticated can execute my_support_state');
select is(has_function_privilege('anon', 'public.list_public_comments(uuid,timestamptz,uuid,integer)', 'EXECUTE'), true, 'anon can execute list_public_comments');
select is(has_function_privilege('anon', 'public.get_public_community_summary(uuid)', 'EXECUTE'), true, 'anon can execute get_public_community_summary');
select is(has_function_privilege('anon', 'public.list_my_moderation_notices(uuid)', 'EXECUTE'), false, 'anon cannot execute list_my_moderation_notices');
select is(has_function_privilege('authenticated', 'public.community_lock_publication(uuid)', 'EXECUTE'), false, 'authenticated cannot execute the internal community_lock_publication');

-- 3. create_comment
set local role authenticated;
select public.t_as('2');
insert into ctx select 'c_un', null, public.create_comment(public.t_id('p1'), null, 'Pregunta general', 'k-unanch-01', repeat('a', 64));
insert into ctx select 'c_an', null, public.create_comment(public.t_id('p1'), public.t_uid('f1')::uuid, 'Me gusta la cubierta', 'k-anchor-01', repeat('b', 64));
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.t_doc('c_un')) as k),
  array['commentId', 'createdAt', 'featureId', 'publicationId'],
  'create_comment returns commentId, createdAt, featureId, publicationId'
);
select is(public.t_doc('c_un') -> 'featureId', 'null'::jsonb, 'unanchored comment returns featureId null');
select is(public.t_doc('c_an') ->> 'featureId', public.t_uid('f1'), 'anchored comment returns the feature id');
select is(public.t_doc('c_un') ->> 'publicationId', public.t_id('p1')::text, 'the response names the publication');
reset role;
select is((select count(*)::int from public.comments where id in ((public.t_doc('c_un') ->> 'commentId')::uuid, (public.t_doc('c_an') ->> 'commentId')::uuid) and author_id = public.t_uid('2')::uuid), 2, 'both comments are stored with the caller as author');
select is(
  (select feature_id from public.comments where id = (public.t_doc('c_an') ->> 'commentId')::uuid),
  public.t_uid('f1')::uuid, 'the anchored comment stores its feature');
select is(
  (select revision_id from public.comments where id = (public.t_doc('c_an') ->> 'commentId')::uuid),
  public.t_id('r1'), 'the comment stores the revision of the publication');

set local role authenticated;
select public.t_as('2');
select is(public.t_cc(public.t_id('p1'), public.t_uid('f2')::uuid, 'ancla ajena', 'k-badanch-1'), 'FT422|invalid_anchor|', 'an anchor on a feature that is not in the revision is FT422 invalid_anchor');
select is(public.t_cc(public.t_id('p1'), gen_random_uuid(), 'ancla ajena', 'k-badanch-2'), 'FT422|invalid_anchor|', 'an unknown feature id is FT422 invalid_anchor');
select is(public.t_cc(gen_random_uuid(), null, 'hola', 'k-unknown-1'), 'P0002|publication_not_found|', 'an unknown publication is P0002');
select is(public.t_cc(public.t_id('p3'), null, 'hola', 'k-hidden-01'), 'P0002|publication_not_found|', 'a hidden publication is P0002');
select is(public.t_cc(null, null, 'hola', 'k-nullpub-1'), '22023|invalid_comment_request|', 'a null publication is 22023');
select is(public.t_cc(public.t_id('p1'), null, '', 'k-body-000'), '22023|invalid_comment_request|', 'a body of 0 characters is 22023');
select is(public.t_cc(public.t_id('p1'), null, null, 'k-body-null'), '22023|invalid_comment_request|', 'a null body is 22023');
select is(public.t_cc(public.t_id('p1'), null, repeat('a', 1001), 'k-body-1001'), '22023|invalid_comment_request|', 'a body of 1001 characters is 22023');
select is(public.t_cc(public.t_id('p1'), null, 'a' || chr(7) || 'b', 'k-body-ctrl'), '22023|invalid_comment_request|', 'a body with a control character is 22023');
select is(public.t_cc(public.t_id('p1'), null, ' relleno', 'k-body-lead'), '22023|invalid_comment_request|', 'a body with a leading space is 22023');
select is(public.t_cc(public.t_id('p1'), null, 'relleno ' , 'k-body-trail'), '22023|invalid_comment_request|', 'a body with a trailing space is 22023');
select is(public.t_cc(public.t_id('p1'), null, 'a' || chr(8238) || 'b', 'k-body-bidi'), '22023|invalid_comment_request|', 'a body with a bidi override is 22023');
select is(public.t_cc(public.t_id('p1'), null, 'hola', 'short'), '22023|invalid_comment_request|', 'an idempotency key shorter than 8 characters is 22023');
select is(public.t_cc(public.t_id('p1'), null, 'hola', 'k-hash-bad', 'xyz'), '22023|invalid_comment_request|', 'a malformed payload hash is 22023');
select is(public.t_cc(public.t_id('p1'), null, 'x', 'k-body-one-1'), 'ok', 'a body of 1 character is accepted');
select is(public.t_cc(public.t_id('p1'), null, repeat('a', 1000), 'k-body-1000'), 'ok', 'a body of 1000 characters is accepted');
reset role;
select is(public.t_ncomments(public.t_id('p1')), 4, 'only the four valid comments exist (rejections stored nothing)');

-- Replay and idempotency
set local role authenticated;
select public.t_as('2');
select is(
  public.create_comment(public.t_id('p1'), null, 'Pregunta general', 'k-unanch-01', repeat('a', 64)),
  public.t_doc('c_un'), 'the same key and payload replays the identical response');
reset role;
select is(public.t_ncomments(public.t_id('p1')), 4, 'a replay creates no second comment');
set local role authenticated;
select public.t_as('2');
select is(public.t_cc(public.t_id('p1'), null, 'Otra cosa', 'k-unanch-01', repeat('9', 64)), 'FT001|idempotency_key_reused|', 'the same key with another payload is FT001');
reset role;
select is(public.t_ncomments(public.t_id('p1')), 4, 'a reused key creates no comment');
select is(
  (select count(*)::int from public.mutation_requests where operation = 'create_comment' and idempotency_key = 'k-unanch-01'),
  1, 'one ledger row per key');
select is(
  (select response_json ? 'body' from public.mutation_requests where operation = 'create_comment' and idempotency_key = 'k-unanch-01'),
  false, 'the ledger response has no body key');
select is(
  (select count(*)::int from public.mutation_requests where operation = 'create_comment' and response_json::text like '%Pregunta general%'),
  0, 'the ledger stores no comment text');
select is(
  (select count(*)::int from public.mutation_requests where operation = 'create_comment' and response_json::text like '%Me gusta la cubierta%'),
  0, 'the ledger stores no anchored comment text either');

-- Authentication
set local role authenticated;
select public.t_noauth();
select is(public.t_cc(public.t_id('p1'), null, 'hola', 'k-noauth-01'), '28000|authentication_required|', 'create_comment without a session is 28000');
select is(public.t_ret(public.t_id('p1')), '28000|authentication_required|', 'retract_comment without a session is 28000');
select is(public.t_sup(public.t_id('p1'), true), '28000|authentication_required|', 'set_support without a session is 28000');
reset role;
set local role anon;
select public.t_noauth();
select alike(public.t_cc(public.t_id('p1'), null, 'hola', 'k-anon-0001'), '42501|%', 'anon is denied create_comment (42501)');
select alike(public.t_ret(public.t_id('p1')), '42501|%', 'anon is denied retract_comment (42501)');
select alike(public.t_sup(public.t_id('p1'), true), '42501|%', 'anon is denied set_support (42501)');
select alike(public.t_err(format('select public.my_support_state(%L::uuid)', public.t_id('p1'))), '42501|%', 'anon is denied my_support_state (42501)');
select alike(public.t_err(format('select public.list_my_moderation_notices(%L::uuid)', public.t_id('p1'))), '42501|%', 'anon is denied list_my_moderation_notices (42501)');
reset role;

-- A publication of an unpublished site is not found
update public.sites set published = false where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99';
set local role authenticated;
select public.t_as('2');
select is(public.t_cc(public.t_id('p1'), null, 'hola', 'k-unpubl-01'), 'P0002|publication_not_found|', 'create_comment on an unpublished site is P0002');
select is(public.t_sup(public.t_id('p1'), true), 'P0002|publication_not_found|', 'set_support on an unpublished site is P0002');
select is(public.get_public_community_summary(public.t_id('p1')), null, 'summary of an unpublished site is null');
select is(public.list_public_comments(public.t_id('p1')), null, 'comment list of an unpublished site is null');
select is(public.my_support_state(public.t_id('p1')), null, 'my_support_state of an unpublished site is null');
select is(public.list_my_moderation_notices(public.t_id('p1')), null, 'notices of an unpublished site are null');
reset role;
update public.sites set published = true where id = '8f5a6417-5f6d-4f02-a50c-76d97167db99';

-- 4. retract_comment (comment '1000' characters of user 2 is the one retracted)
select is(public.t_used('2', 'comment'), 4, 'user 2 consumed 4 comment units (the rejected calls consumed none)');
insert into ctx select 'c_long', (select id from public.comments where publication_id = public.t_id('p1') and body = repeat('a', 1000)), null;
set local role anon;
select public.t_noauth();
select is(public.get_public_community_summary(public.t_id('p1')) ->> 'commentCount', '4', 'summary counts the four comments before the retraction');
select is(jsonb_array_length(public.list_public_comments(public.t_id('p1'), null, null, 50) -> 'items'), 4, 'the list shows four comments before the retraction');
reset role;
set local role authenticated;
select public.t_as('3');
select is(public.t_ret(public.t_id('c_long')), 'P0002|comment_not_found|', 'another user cannot retract the comment (P0002)');
select is(public.t_ret(gen_random_uuid()), 'P0002|comment_not_found|', 'an unknown comment is P0002');
select is(public.t_ret(null), '22023|invalid_comment_request|', 'a null comment id is 22023');
reset role;
select is((select retracted_at from public.comments where id = public.t_id('c_long')), null, 'the comment is still not retracted');
set local role authenticated;
select public.t_as('2');
insert into ctx select 'ret1', null, public.retract_comment(public.t_id('c_long'));
insert into ctx select 'ret2', null, public.retract_comment(public.t_id('c_long'));
select is(public.t_doc('ret1') ->> 'commentId', public.t_id('c_long')::text, 'retract_comment returns the comment id');
select isnt(public.t_doc('ret1') -> 'retractedAt', 'null'::jsonb, 'retract_comment returns the retraction time');
select is(public.t_doc('ret2'), public.t_doc('ret1'), 'retracting twice returns the same retractedAt');
select is(public.my_support_state(public.t_id('p1')), false, 'my_support_state is false before supporting');
reset role;
select isnt((select retracted_at from public.comments where id = public.t_id('c_long')), null, 'the comment row carries retracted_at');
select is(public.t_err(format('update public.comments set retracted_at = null where id = %L', public.t_id('c_long'))), '55000|immutable_comment|', 'retracted_at cannot be set back to null');
select is(public.t_err(format('update public.comments set retracted_at = now() + interval ''1 day'' where id = %L', public.t_id('c_long'))), '55000|immutable_comment|', 'retracted_at cannot be moved once set');
select is((select count(*)::int from public.comments where id = public.t_id('c_long')), 1, 'a retracted comment is kept');
set local role anon;
select public.t_noauth();
select is(public.get_public_community_summary(public.t_id('p1')) ->> 'commentCount', '3', 'the summary count drops after the retraction');
select is(
  (select count(*)::int from jsonb_array_elements(public.list_public_comments(public.t_id('p1'), null, null, 50) -> 'items') as i where i ->> 'commentId' = public.t_id('c_long')::text),
  0, 'a retracted comment disappears from the public list');
select is(jsonb_array_length(public.list_public_comments(public.t_id('p1'), null, null, 50) -> 'items'), 3, 'the list shows three comments after the retraction');
reset role;

-- 5. set_support
set local role authenticated;
select public.t_as('2');
select is(public.my_support_state(public.t_id('p1')), false, 'my_support_state is false for a user who has not supported');
select is(public.set_support(public.t_id('p1'), true), '{"supported": true, "count": 1}'::jsonb, 'first support gives count 1');
select is(public.my_support_state(public.t_id('p1')), true, 'my_support_state is true after supporting');
reset role;
select is(public.t_used('2', 'support'), 1, 'the first support consumed one unit');
set local role authenticated;
select public.t_as('2');
select is(public.set_support(public.t_id('p1'), true), '{"supported": true, "count": 1}'::jsonb, 'a repeated support keeps count 1');
reset role;
select is(public.t_used('2', 'support'), 1, 'a repeated support consumes no unit');
select is((select count(*)::int from public.supports where publication_id = public.t_id('p1')), 1, 'a repeated support creates no second row');
set local role authenticated;
select public.t_as('2');
select is(public.set_support(public.t_id('p1'), false), '{"supported": false, "count": 0}'::jsonb, 'removing support gives count 0');
select is(public.my_support_state(public.t_id('p1')), false, 'my_support_state is false after removing support');
reset role;
select is(public.t_used('2', 'support'), 2, 'removing support consumed one unit');
set local role authenticated;
select public.t_as('2');
select is(public.set_support(public.t_id('p1'), false), '{"supported": false, "count": 0}'::jsonb, 'a repeated removal keeps count 0');
reset role;
select is(public.t_used('2', 'support'), 2, 'a repeated removal consumes no unit');
set local role authenticated;
select public.t_as('2');
select is(public.set_support(public.t_id('p1'), true) ->> 'count', '1', 'user 2 supports again');
select public.t_as('3');
select is(public.set_support(public.t_id('p1'), true), '{"supported": true, "count": 2}'::jsonb, 'two users give count 2');
select is(public.my_support_state(public.t_id('p1')), true, 'user 3 sees its own support');
select is(public.t_sup(public.t_id('p3'), true), 'P0002|publication_not_found|', 'support on a hidden publication is P0002');
select is(public.t_sup(gen_random_uuid(), true), 'P0002|publication_not_found|', 'support on an unknown publication is P0002');
select is(public.t_sup(null, true), '22023|invalid_support_request|', 'a null publication is 22023');
select is(public.t_err(format('select public.set_support(%L::uuid, null)', public.t_id('p1'))), '22023|invalid_support_request|', 'a null supported flag is 22023');
select is(public.my_support_state(public.t_id('p3')), null, 'my_support_state of a hidden publication is null');
select is(public.my_support_state(gen_random_uuid()), null, 'my_support_state of an unknown publication is null');
select public.t_noauth();
select is(public.my_support_state(public.t_id('p1')), null, 'my_support_state without a session is null');
reset role;
select is((select count(*)::int from public.supports where publication_id = public.t_id('p3')), 0, 'no support row exists on the hidden publication');
set local role anon;
select public.t_noauth();
select is(public.get_public_community_summary(public.t_id('p1')) ->> 'supportCount', '2', 'the summary shows two supports');
reset role;

-- 6. list_public_comments on p2: five visible comments, one hidden, one retracted
insert into public.comments (id, publication_id, revision_id, feature_id, author_id, body, created_at, moderation_state, retracted_at)
values
  (public.t_uid('a5')::uuid, public.t_id('p2'), public.t_id('r2'), null, public.t_uid('2')::uuid, 'quinto', timestamptz '2030-01-01 10:00:03+00', 'visible', null),
  (public.t_uid('a3')::uuid, public.t_id('p2'), public.t_id('r2'), null, public.t_uid('3')::uuid, 'tercero', timestamptz '2030-01-01 10:00:01+00', 'visible', null),
  (public.t_uid('a1')::uuid, public.t_id('p2'), public.t_id('r2'), null, public.t_uid('2')::uuid, 'primero', timestamptz '2030-01-01 10:00:00.123456+00', 'visible', null),
  (public.t_uid('a4')::uuid, public.t_id('p2'), public.t_id('r2'), null, public.t_uid('3')::uuid, 'cuarto', timestamptz '2030-01-01 10:00:02+00', 'visible', null),
  (public.t_uid('a2')::uuid, public.t_id('p2'), public.t_id('r2'), public.t_uid('f2')::uuid, public.t_uid('3')::uuid, 'segundo', timestamptz '2030-01-01 10:00:01+00', 'visible', null),
  (public.t_uid('a6')::uuid, public.t_id('p2'), public.t_id('r2'), null, public.t_uid('2')::uuid, 'oculto', timestamptz '2030-01-01 10:00:04+00', 'hidden', null),
  (public.t_uid('a7')::uuid, public.t_id('p2'), public.t_id('r2'), null, public.t_uid('2')::uuid, 'retirado', timestamptz '2030-01-01 10:00:05+00', 'visible', timestamptz '2030-01-01 11:00:00+00'),
  (public.t_uid('a8')::uuid, public.t_id('p2'), public.t_id('r2'), null, public.t_uid('3')::uuid, 'oculto ajeno', timestamptz '2030-01-01 10:00:06+00', 'hidden', null);

set local role anon;
select public.t_noauth();
insert into ctx select 'pg_all', null, public.list_public_comments(public.t_id('p2'), null, null, 50);
insert into ctx select 'pg1', null, public.list_public_comments(public.t_id('p2'), null, null, 2);
select is(public.t_page_ids(public.t_doc('pg_all')), public.t_uid('a1') || ',' || public.t_uid('a2') || ',' || public.t_uid('a3') || ',' || public.t_uid('a4') || ',' || public.t_uid('a5'), 'comments are ordered by (created_at, id); hidden and retracted ones are excluded');
select is(public.t_doc('pg_all') -> 'nextCursor', 'null'::jsonb, 'a page with everything has a null nextCursor');
select is(public.t_page_ids(public.t_doc('pg1')), public.t_uid('a1') || ',' || public.t_uid('a2'), 'page 1 (limit 2) has the first two comments');
select isnt(public.t_doc('pg1') -> 'nextCursor', 'null'::jsonb, 'page 1 has a nextCursor');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.t_doc('pg1') -> 'nextCursor') as k),
  array['createdAt', 'id'], 'the cursor has exactly createdAt and id');
select is((public.t_doc('pg1') #>> '{nextCursor,id}'), public.t_uid('a2'), 'the cursor points at the last item of the page');
insert into ctx select 'pg2', null, public.list_public_comments(public.t_id('p2'),
  (public.t_doc('pg1') #>> '{nextCursor,createdAt}')::timestamptz, (public.t_doc('pg1') #>> '{nextCursor,id}')::uuid, 2);
select is(public.t_page_ids(public.t_doc('pg2')), public.t_uid('a3') || ',' || public.t_uid('a4'), 'page 2 continues after the cursor (a2/a3 share created_at and are split by id)');
select isnt(public.t_doc('pg2') -> 'nextCursor', 'null'::jsonb, 'page 2 has a nextCursor');
insert into ctx select 'pg3', null, public.list_public_comments(public.t_id('p2'),
  (public.t_doc('pg2') #>> '{nextCursor,createdAt}')::timestamptz, (public.t_doc('pg2') #>> '{nextCursor,id}')::uuid, 2);
select is(public.t_page_ids(public.t_doc('pg3')), public.t_uid('a5'), 'page 3 has the last comment');
select is(public.t_doc('pg3') -> 'nextCursor', 'null'::jsonb, 'page 3 has a null nextCursor');
-- Microsecond round trip
insert into ctx select 'pg_us', null, public.list_public_comments(public.t_id('p2'), null, null, 1);
select is((public.t_doc('pg_us') #>> '{nextCursor,createdAt}')::timestamptz, timestamptz '2030-01-01 10:00:00.123456+00', 'the cursor keeps the exact microsecond timestamp');
select is(
  public.t_page_ids(public.list_public_comments(public.t_id('p2'),
    (public.t_doc('pg_us') #>> '{nextCursor,createdAt}')::timestamptz, (public.t_doc('pg_us') #>> '{nextCursor,id}')::uuid, 1)),
  public.t_uid('a2'), 'the cursor round trip resumes at the next comment without skipping or repeating');
select is(public.t_page_ids(public.list_public_comments(public.t_id('p2'), timestamptz '2030-01-01 10:00:00.123455+00', public.t_uid('a1')::uuid, 1)), public.t_uid('a1'), 'a cursor one microsecond earlier returns the comment again');
select is(public.t_page_ids(public.list_public_comments(public.t_id('p2'), timestamptz '2030-01-01 10:00:00.123456+00', public.t_uid('a1')::uuid, 1)), public.t_uid('a2'), 'a cursor equal to a comment excludes it');
-- Limits and cursor shape
select is(public.t_list(public.t_id('p2'), null, null, 0), '22023|invalid_page_request|', 'limit 0 is 22023');
select is(public.t_list(public.t_id('p2'), null, null, 51), '22023|invalid_page_request|', 'limit 51 is 22023');
select is(public.t_list(public.t_id('p2'), null, null, -1), '22023|invalid_page_request|', 'a negative limit is 22023');
select is(public.t_list(public.t_id('p2'), null, null, null), '22023|invalid_page_request|', 'a null limit is 22023');
select is(public.t_list(public.t_id('p2'), timestamptz '2030-01-01 10:00:00+00', null, 5), '22023|invalid_page_request|', 'a cursor with only createdAt is 22023');
select is(public.t_list(public.t_id('p2'), null, public.t_uid('a1')::uuid, 5), '22023|invalid_page_request|', 'a cursor with only id is 22023');
select is(public.t_list(public.t_id('p2'), null, null, 50), 'ok', 'limit 50 is accepted');
select is(public.t_list(public.t_id('p2'), null, null, 1), 'ok', 'limit 1 is accepted');
select is(public.list_public_comments(gen_random_uuid()), null, 'an unknown publication gives a null list');
select is(public.list_public_comments(public.t_id('p3')), null, 'a hidden publication gives a null list');
-- Item shape and privacy
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.t_doc('pg1') -> 'items' -> 0) as k),
  array['anchor', 'authorAlias', 'body', 'commentId', 'createdAt', 'mine'],
  'an item has exactly commentId, body, authorAlias, createdAt, mine, anchor');
select is(public.t_doc('pg1') -> 'items' -> 0 -> 'anchor', 'null'::jsonb, 'an unanchored item has a null anchor');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.t_doc('pg1') -> 'items' -> 1 -> 'anchor') as k),
  array['featureId', 'label'], 'an anchor has exactly featureId and label');
select is(public.t_doc('pg1') #>> '{items,1,anchor,label}', 'Arbol', 'the anchor label comes from the revision feature');
select is(public.t_doc('pg1') #>> '{items,1,anchor,featureId}', public.t_uid('f2'), 'the anchor names the feature');
select is(
  (select count(*)::int from ctx where name like 'pg%' and (doc::text like '%' || public.t_uid('2') || '%' or doc::text like '%' || public.t_uid('3') || '%' or doc::text like '%@%')),
  0, 'no list page contains an account id or an email');
select is(
  (select bool_or((i ->> 'mine')::boolean) from jsonb_array_elements(public.t_doc('pg_all') -> 'items') as i),
  false, 'mine is false for every item when anon reads');
reset role;
-- mine
set local role authenticated;
select public.t_as('2');
select is(
  (select string_agg(i ->> 'commentId', ',' order by o) from jsonb_array_elements(public.list_public_comments(public.t_id('p2'), null, null, 50) -> 'items') with ordinality as t (i, o) where (i ->> 'mine')::boolean),
  public.t_uid('a1') || ',' || public.t_uid('a5'), 'mine is true only for the comments of user 2');
select public.t_as('3');
select is(
  (select string_agg(i ->> 'commentId', ',' order by o) from jsonb_array_elements(public.list_public_comments(public.t_id('p2'), null, null, 50) -> 'items') with ordinality as t (i, o) where (i ->> 'mine')::boolean),
  public.t_uid('a2') || ',' || public.t_uid('a3') || ',' || public.t_uid('a4'), 'mine is true only for the comments of user 3');
select public.t_as('1');
select is(
  (select count(*)::int from jsonb_array_elements(public.list_public_comments(public.t_id('p2'), null, null, 50) -> 'items') as i where (i ->> 'mine')::boolean),
  0, 'mine is false for a user with no comments');
select public.t_noauth();
select is(
  (select count(*)::int from jsonb_array_elements(public.list_public_comments(public.t_id('p2'), null, null, 50) -> 'items') as i where (i ->> 'mine')::boolean),
  0, 'mine is false for an authenticated role without a session');
reset role;
-- Live alias
update public.profiles set public_alias = 'Alias Vivo Dos' where id = public.t_uid('2')::uuid;
set local role anon;
select public.t_noauth();
select is(public.list_public_comments(public.t_id('p2'), null, null, 1) #>> '{items,0,authorAlias}', 'Alias Vivo Dos', 'the list shows the live profile alias');
reset role;
update public.profiles set public_alias = 'Alias Nuevo Dos' where id = public.t_uid('2')::uuid;
set local role anon;
select public.t_noauth();
select is(public.list_public_comments(public.t_id('p2'), null, null, 1) #>> '{items,0,authorAlias}', 'Alias Nuevo Dos', 'a later alias change shows in the list');
select is(public.get_public_community_summary(public.t_id('p2')), '{"supportCount": 0, "commentCount": 5}'::jsonb, 'the summary of p2 counts only the five visible comments');
select is(public.get_public_community_summary(public.t_id('p3')), null, 'the summary of a hidden publication is null');
select is(public.get_public_community_summary(gen_random_uuid()), null, 'the summary of an unknown publication is null');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_public_community_summary(public.t_id('p2'))) as k),
  array['commentCount', 'supportCount'], 'the summary has exactly supportCount and commentCount');
reset role;

-- 7. list_my_moderation_notices
insert into public.moderation_events (id, site_id, target_kind, publication_id, comment_id, action, reason, private_note, actor_id)
values
  (public.t_uid('e6')::uuid, '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'comment', public.t_id('p2'), public.t_uid('a6')::uuid, 'hide', 'Razón pública seis', 'nota privada seis', public.t_uid('1')::uuid),
  (public.t_uid('e8')::uuid, '8f5a6417-5f6d-4f02-a50c-76d97167db99', 'comment', public.t_id('p2'), public.t_uid('a8')::uuid, 'hide', 'Razón pública ocho', 'nota privada ocho', public.t_uid('1')::uuid);
set local role authenticated;
select public.t_as('2');
insert into ctx select 'n2', null, public.list_my_moderation_notices(public.t_id('p2'));
select is(jsonb_array_length(public.t_doc('n2') -> 'items'), 2, 'the author sees the hidden and the retracted comment');
select is(public.t_doc('n2') #>> '{items,0,commentId}', public.t_uid('a6'), 'the hidden comment comes first (by created_at)');
select is(public.t_doc('n2') #>> '{items,0,state}', 'hidden', 'the hidden comment has state hidden');
select is(public.t_doc('n2') #>> '{items,0,reason}', 'Razón pública seis', 'the hidden comment carries the public reason');
select is(public.t_doc('n2') #>> '{items,1,commentId}', public.t_uid('a7'), 'the retracted comment is listed');
select is(public.t_doc('n2') #>> '{items,1,state}', 'retracted', 'the retracted comment has state retracted');
select is(public.t_doc('n2') #> '{items,1,reason}', 'null'::jsonb, 'a retracted comment has no moderation reason');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.t_doc('n2') -> 'items' -> 0) as k),
  array['body', 'commentId', 'createdAt', 'reason', 'state'], 'a notice has exactly commentId, body, state, reason, createdAt');
select is(public.t_doc('n2')::text like '%nota privada%', false, 'the notices never include the private note');
select is(public.t_doc('n2')::text like '%oculto ajeno%', false, 'the notices never include another author''s comment');
select public.t_as('3');
insert into ctx select 'n3', null, public.list_my_moderation_notices(public.t_id('p2'));
select is(jsonb_array_length(public.t_doc('n3') -> 'items'), 1, 'user 3 sees only its own hidden comment');
select is(public.t_doc('n3') #>> '{items,0,commentId}', public.t_uid('a8'), 'user 3 sees comment a8');
select is(public.t_doc('n3') #>> '{items,0,reason}', 'Razón pública ocho', 'user 3 sees the public reason');
select is(public.t_doc('n3')::text like '%nota privada%', false, 'user 3 never sees a private note');
select public.t_as('1');
select is(public.list_my_moderation_notices(public.t_id('p2')), '{"items": []}'::jsonb, 'a user with no comments gets an empty list');
select is(public.list_my_moderation_notices(public.t_id('p3')), null, 'notices of a hidden publication are null');
select public.t_noauth();
select is(public.list_my_moderation_notices(public.t_id('p2')), null, 'notices without a session are null');
reset role;

select * from finish();
rollback;
