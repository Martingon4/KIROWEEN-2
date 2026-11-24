begin;

select plan(201);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction). They run as the calling role.
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
create function public.t_uid(p text) returns text language sql immutable as
$$ select '96000000-0000-4000-8000-' || lpad(p, 12, '0') $$;
-- Runs a statement in a subtransaction. Returns 'ok' or sqlstate|message|detail.
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
-- Direct inserts (run as postgres). Author of every comment is user 2.
create function public.t_cmt(p_id text, p_pub text, p_rev text, p_feat text, p_body text) returns text language sql as $$
  select public.t_err(format(
    'insert into public.comments (id, publication_id, revision_id, feature_id, author_id, body) values (%L, %L, %L, %L, %L, %L)',
    public.t_uid(p_id), public.t_id(p_pub), public.t_id(p_rev), p_feat, public.t_uid('2'), p_body))
$$;
create function public.t_rep(p_id text, p_kind text, p_pub text, p_comment text, p_reporter text,
  p_site text default '8f5a6417-5f6d-4f02-a50c-76d97167db99') returns text language sql as $$
  select public.t_err(format(
    'insert into public.reports (id, site_id, target_kind, publication_id, comment_id, reporter_id, reason) values (%L, %L, %L, %L, %L, %L, ''harassment'')',
    public.t_uid(p_id), p_site, p_kind, public.t_id(p_pub), p_comment, public.t_uid(p_reporter)))
$$;
create function public.t_evt(p_id text, p_kind text, p_pub text, p_comment text, p_reason text,
  p_site text default '8f5a6417-5f6d-4f02-a50c-76d97167db99') returns text language sql as $$
  select public.t_err(format(
    'insert into public.moderation_events (id, site_id, target_kind, publication_id, comment_id, action, reason, actor_id) values (%L, %L, %L, %L, %L, ''hide'', %L, %L)',
    public.t_uid(p_id), p_site, p_kind, public.t_id(p_pub), p_comment, p_reason, public.t_uid('1')))
$$;

-- 1. Tables, RLS, and no table privileges
select has_table('public', 'comments', 'comments exists');
select has_table('public', 'supports', 'supports exists');
select has_table('public', 'reports', 'reports exists');
select has_table('public', 'moderation_events', 'moderation_events exists');
select has_table('public', 'rate_limits', 'rate_limits exists');
select has_table('public', 'rate_windows', 'rate_windows exists');

select is((select c.relrowsecurity from pg_class as c where c.oid = 'public.comments'::regclass), true, 'RLS enabled on comments');
select is((select c.relrowsecurity from pg_class as c where c.oid = 'public.supports'::regclass), true, 'RLS enabled on supports');
select is((select c.relrowsecurity from pg_class as c where c.oid = 'public.reports'::regclass), true, 'RLS enabled on reports');
select is((select c.relrowsecurity from pg_class as c where c.oid = 'public.moderation_events'::regclass), true, 'RLS enabled on moderation_events');
select is((select c.relrowsecurity from pg_class as c where c.oid = 'public.rate_limits'::regclass), true, 'RLS enabled on rate_limits');
select is((select c.relrowsecurity from pg_class as c where c.oid = 'public.rate_windows'::regclass), true, 'RLS enabled on rate_windows');

select is(
  (select count(*)::int from pg_policies as p
   where p.schemaname = 'public'
     and p.tablename in ('comments', 'supports', 'reports', 'moderation_events', 'rate_limits', 'rate_windows')),
  0, 'the community and rate-limit tables have no policies'
);

select is(
  count(*) filter (where has_table_privilege(r.role, 'public.' || t.name, p.priv))::int,
  0,
  r.role || ' has no privilege on public.' || t.name
)
from unnest(array['comments', 'supports', 'reports', 'moderation_events', 'rate_limits', 'rate_windows']) as t (name)
cross join unnest(array['anon', 'authenticated']) as r (role)
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p (priv)
group by t.name, r.role
order by t.name, r.role;

set local role authenticated;
select alike(public.t_err('select 1 from public.comments'), '42501|%', 'authenticated cannot select comments');
select alike(public.t_err('select 1 from public.supports'), '42501|%', 'authenticated cannot select supports');
select alike(public.t_err('select 1 from public.reports'), '42501|%', 'authenticated cannot select reports');
select alike(public.t_err('select 1 from public.moderation_events'), '42501|%', 'authenticated cannot select moderation_events');
select alike(public.t_err('select 1 from public.rate_limits'), '42501|%', 'authenticated cannot select rate_limits');
select alike(public.t_err('select 1 from public.rate_windows'), '42501|%', 'authenticated cannot select rate_windows');
set local role anon;
select alike(public.t_err('select 1 from public.comments'), '42501|%', 'anon cannot select comments');
select alike(public.t_err('select 1 from public.supports'), '42501|%', 'anon cannot select supports');
select alike(public.t_err('select 1 from public.reports'), '42501|%', 'anon cannot select reports');
select alike(public.t_err('select 1 from public.moderation_events'), '42501|%', 'anon cannot select moderation_events');
select alike(public.t_err('select 1 from public.rate_limits'), '42501|%', 'anon cannot select rate_limits');
select alike(public.t_err('select 1 from public.rate_windows'), '42501|%', 'anon cannot select rate_windows');
reset role;

-- 2. plain_text_ok
select is(public.plain_text_ok('Hola mundo'), true, 'plain_text_ok accepts normal text');
select is(public.plain_text_ok('ñandú ✓ café'), true, 'plain_text_ok accepts non-ASCII text');
select is(public.plain_text_ok(E'primera\nsegunda'), true, 'plain_text_ok accepts an inner newline');
select is(public.plain_text_ok(''), true, 'plain_text_ok accepts the empty string (length is checked elsewhere)');
select is(public.plain_text_ok(' x'), false, 'plain_text_ok rejects a leading space');
select is(public.plain_text_ok('x '), false, 'plain_text_ok rejects a trailing space');
select is(public.plain_text_ok(E'\tx'), false, 'plain_text_ok rejects a leading tab');
select is(public.plain_text_ok(E'x\t'), false, 'plain_text_ok rejects a trailing tab');
select is(public.plain_text_ok(E'x\n'), false, 'plain_text_ok rejects a trailing newline');
select is(public.plain_text_ok(chr(160) || 'x'), false, 'plain_text_ok rejects a leading NBSP');
select is(public.plain_text_ok('x' || chr(160)), false, 'plain_text_ok rejects a trailing NBSP');
select is(public.plain_text_ok(chr(65279) || 'x'), false, 'plain_text_ok rejects a leading zero-width no-break space');
select is(public.plain_text_ok(E'a\tb'), false, 'plain_text_ok rejects a tab inside the text');
select is(public.plain_text_ok('a' || chr(7) || 'b'), false, 'plain_text_ok rejects BEL');
select is(public.plain_text_ok('a' || chr(13) || 'b'), false, 'plain_text_ok rejects an inner carriage return');
select is(public.plain_text_ok('a' || chr(127) || 'b'), false, 'plain_text_ok rejects DEL');
select is(public.plain_text_ok('a' || chr(133) || 'b'), false, 'plain_text_ok rejects U+0085');
select is(public.plain_text_ok('a' || chr(8238) || 'b'), false, 'plain_text_ok rejects the bidi override U+202E');
select is(public.plain_text_ok('a' || chr(8234) || 'b'), false, 'plain_text_ok rejects the bidi embedding U+202A');
select is(public.plain_text_ok('a' || chr(8294) || 'b'), false, 'plain_text_ok rejects the bidi isolate U+2066');
select is(public.plain_text_ok('a' || chr(8297) || 'b'), false, 'plain_text_ok rejects the bidi isolate pop U+2069');
select is(public.plain_text_ok(null), false, 'plain_text_ok(null) is false');
select is(public.plain_text_ok('a' || chr(173) || 'b'), false, 'plain_text_ok rejects the soft hyphen U+00AD');
select is(public.plain_text_ok('a' || chr(1564) || 'b'), false, 'plain_text_ok rejects the Arabic letter mark U+061C');
select is(public.plain_text_ok('a' || chr(8203) || 'b'), false, 'plain_text_ok rejects the zero-width space U+200B');
select is(public.plain_text_ok('a' || chr(8204) || 'b'), false, 'plain_text_ok rejects the zero-width non-joiner U+200C');
select is(public.plain_text_ok('a' || chr(8205) || 'b'), false, 'plain_text_ok rejects the zero-width joiner U+200D');
select is(public.plain_text_ok('a' || chr(8206) || 'b'), false, 'plain_text_ok rejects the left-to-right mark U+200E');
select is(public.plain_text_ok('a' || chr(8207) || 'b'), false, 'plain_text_ok rejects the right-to-left mark U+200F');
select is(public.plain_text_ok('a' || chr(8232) || 'b'), false, 'plain_text_ok rejects the line separator U+2028');
select is(public.plain_text_ok('a' || chr(8233) || 'b'), false, 'plain_text_ok rejects the paragraph separator U+2029');
select is(public.plain_text_ok('a' || chr(8235) || 'b'), false, 'plain_text_ok rejects U+202B');
select is(public.plain_text_ok('a' || chr(8236) || 'b'), false, 'plain_text_ok rejects U+202C');
select is(public.plain_text_ok('a' || chr(8237) || 'b'), false, 'plain_text_ok rejects U+202D');
select is(public.plain_text_ok('a' || chr(8288) || 'b'), false, 'plain_text_ok rejects the word joiner U+2060');
select is(public.plain_text_ok('a' || chr(8289) || 'b'), false, 'plain_text_ok rejects U+2061');
select is(public.plain_text_ok('a' || chr(8292) || 'b'), false, 'plain_text_ok rejects U+2064');
select is(public.plain_text_ok('a' || chr(8295) || 'b'), false, 'plain_text_ok rejects U+2067');
select is(public.plain_text_ok('a' || chr(8296) || 'b'), false, 'plain_text_ok rejects U+2068');
select is(public.plain_text_ok('a' || chr(65279) || 'b'), false, 'plain_text_ok rejects an inner U+FEFF');
select is(public.plain_text_ok('a' || chr(8202) || 'b'), true, 'plain_text_ok still accepts the hair space U+200A inside text');
select is(public.plain_text_ok('a' || chr(8212) || 'b'), true, 'plain_text_ok still accepts the em dash U+2014');
select is(public.plain_text_ok('a' || chr(8293) || 'b'), true, 'plain_text_ok leaves the unassigned U+2065 alone (not in the list)');

-- 3. Setup: users, a second site, two publications
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
values
  (public.t_uid('1')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  (public.t_uid('2')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  (public.t_uid('3')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

insert into public.sites (id, slug, name_es, name_en, locality_es, locality_en, timezone, currency, metric_srid, completeness, published)
values (public.t_uid('5')::uuid, 'sitio-prueba-96', 'Sitio', 'Site', 'Localidad', 'Locality', 'America/Mexico_City', 'MXN', 32614, 'partial', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', public.t_uid('1'), true);

insert into ctx select 'bA', public.t_branch('Community A'), null;
insert into ctx select 'rA', public.t_save(public.t_id('bA'), jsonb_build_array(public.t_tree(public.t_uid('f1'), public.t_pt(-98.19775, 19.0436)))), null;
insert into ctx select 'pA', public.t_pub(public.t_id('rA')), null;
insert into ctx select 'bB', public.t_branch('Community B'), null;
insert into ctx select 'rB', public.t_save(public.t_id('bB'), jsonb_build_array(public.t_tree(public.t_uid('f2'), public.t_pt(-98.19770, 19.0436)))), null;
insert into ctx select 'pB', public.t_pub(public.t_id('rB')), null;
reset role;

select is(
  (select revision_id from public.publications where id = public.t_id('pA')),
  public.t_id('rA'),
  'setup: publication A fixes revision A'
);

-- 4. comments constraints
select alike(public.t_cmt('c01', 'pA', 'rA', null, ''), '23514|%comments_body_check%', 'comment body of 0 characters is rejected');
select is(public.t_cmt('c02', 'pA', 'rA', null, 'x'), 'ok', 'comment body of 1 character is accepted');
select is(public.t_cmt('c03', 'pA', 'rA', null, repeat('a', 1000)), 'ok', 'comment body of 1000 characters is accepted');
select alike(public.t_cmt('c04', 'pA', 'rA', null, repeat('a', 1001)), '23514|%comments_body_check%', 'comment body of 1001 characters is rejected');
select alike(public.t_cmt('c05', 'pA', 'rA', null, ' padded'), '23514|%comments_body_check%', 'comment body with a leading space is rejected');
select alike(public.t_cmt('c06', 'pA', 'rA', null, 'bad' || chr(8238) || 'text'), '23514|%comments_body_check%', 'comment body with a bidi override is rejected');
select is(public.t_cmt('c07', 'pA', 'rA', public.t_uid('f1'), 'Anclado'), 'ok', 'comment anchored to a feature of its own revision is accepted');
select alike(public.t_cmt('c08', 'pA', 'rA', public.t_uid('f2'), 'Ancla ajena'), '23503|%comments_anchor_fk%', 'anchor to a feature of another revision is 23503');
select alike(public.t_cmt('c09', 'pA', 'rB', null, 'Par roto'), '23503|%comments_publication_fk%', 'publication paired with another revision is 23503');
select alike(public.t_cmt('c0a', 'pB', 'rA', null, 'Par roto'), '23503|%comments_publication_fk%', 'revision paired with another publication is 23503');
select is(public.t_cmt('c0b', 'pB', 'rB', null, 'Comentario B'), 'ok', 'comment on publication B with its own revision is accepted');
select is((select count(*)::int from public.comments where id::text like '96000000-0000-4000-8000-%'), 4, 'only the four valid comments exist');

-- 5. comments trigger: limited change
select is(public.t_err(format('update public.comments set body = ''otro'' where id = %L', public.t_uid('c02'))), '55000|immutable_comment|', 'updating body is immutable_comment');
select is(public.t_err(format('update public.comments set author_id = %L where id = %L', public.t_uid('3'), public.t_uid('c02'))), '55000|immutable_comment|', 'updating author is immutable_comment');
select is(public.t_err(format('update public.comments set feature_id = %L where id = %L', public.t_uid('f1'), public.t_uid('c02'))), '55000|immutable_comment|', 'updating the anchor is immutable_comment');
select is(public.t_err(format('update public.comments set moderation_state = ''hidden'' where id = %L', public.t_uid('c02'))), 'ok', 'updating moderation_state is allowed');
select is((select moderation_state::text from public.comments where id = public.t_uid('c02')::uuid), 'hidden', 'moderation_state is hidden');
select is(public.t_err(format('update public.comments set moderation_state = ''visible'' where id = %L', public.t_uid('c02'))), 'ok', 'moderation_state can be restored');
select is(public.t_err(format('update public.comments set retracted_at = timestamptz ''2030-01-01 00:00+00'' where id = %L', public.t_uid('c02'))), 'ok', 'retracted_at null to a value is allowed');
select is(public.t_err(format('update public.comments set retracted_at = null where id = %L', public.t_uid('c02'))), '55000|immutable_comment|', 'retracted_at value to null is immutable_comment');
select is(public.t_err(format('update public.comments set retracted_at = timestamptz ''2031-01-01 00:00+00'' where id = %L', public.t_uid('c02'))), '55000|immutable_comment|', 'retracted_at value to another value is immutable_comment');
select is(public.t_err(format('update public.comments set moderation_state = ''hidden'' where id = %L', public.t_uid('c02'))), 'ok', 'moderation_state can change on a retracted comment');
select is((select retracted_at from public.comments where id = public.t_uid('c02')::uuid), timestamptz '2030-01-01 00:00+00', 'retracted_at kept its first value');
select is(public.t_err(format('delete from public.comments where id = %L', public.t_uid('c03'))), '55000|immutable_comment|', 'deleting a comment is immutable_comment');
select alike(public.t_err('truncate public.comments'), '0A000|%', 'plain truncate of comments is blocked by the referencing foreign keys (trigger is not reached)');
select is(public.t_err('truncate public.comments cascade'), '55000|immutable_comment|', 'truncate cascade of comments reaches the trigger: immutable_comment');
select is((select count(*)::int from public.comments where id::text like '96000000-0000-4000-8000-%'), 4, 'no comment was lost');

-- 6. supports
insert into public.supports (publication_id, user_id) values (public.t_id('pA'), public.t_uid('2')::uuid);
select alike(public.t_err(format('insert into public.supports (publication_id, user_id) values (%L, %L)', public.t_id('pA'), public.t_uid('2'))), '23505|%supports_pkey%', 'a second support by the same user on the same publication is 23505');
select is(public.t_err(format('insert into public.supports (publication_id, user_id) values (%L, %L)', public.t_id('pA'), public.t_uid('3'))), 'ok', 'another user can support the same publication');
select is(public.t_err(format('insert into public.supports (publication_id, user_id) values (%L, %L)', public.t_id('pB'), public.t_uid('2'))), 'ok', 'the same user can support another publication');
select alike(public.t_err(format('insert into public.supports (publication_id, user_id) values (%L, %L)', gen_random_uuid(), public.t_uid('2'))), '23503|%', 'support for a missing publication is 23503');

-- 7. moderation_events (needed by the resolved reports)
select alike(public.t_evt('e01', 'comment', 'pA', null, 'Motivo'), '23514|%moderation_events_target_shape%', 'comment event without comment_id violates the target shape');
select alike(public.t_evt('e02', 'publication', 'pA', public.t_uid('c03'), 'Motivo'), '23514|%moderation_events_target_shape%', 'publication event with comment_id violates the target shape');
select alike(public.t_evt('e03', 'publication', 'pA', null, ''), '23514|%moderation_events_reason_check%', 'event reason of 0 characters is rejected');
select is(public.t_evt('e04', 'publication', 'pA', null, 'x'), 'ok', 'event reason of 1 character is accepted');
select is(public.t_evt('e05', 'publication', 'pA', null, repeat('a', 500)), 'ok', 'event reason of 500 characters is accepted');
select alike(public.t_evt('e06', 'publication', 'pA', null, repeat('a', 501)), '23514|%moderation_events_reason_check%', 'event reason of 501 characters is rejected');
select alike(public.t_evt('e07', 'publication', 'pA', null, ' padded'), '23514|%moderation_events_reason_check%', 'event reason with a leading space is rejected');
select is(public.t_evt('e08', 'comment', 'pA', public.t_uid('c03'), 'Comentario oculto'), 'ok', 'comment event with matching publication is accepted');
select alike(public.t_evt('e09', 'comment', 'pB', public.t_uid('c03'), 'Publicacion ajena'), '23503|%moderation_events_comment_fk%', 'comment event with the wrong publication is 23503');
select is(public.t_evt('e0a', 'publication', 'pA', null, 'Sitio ajeno', public.t_uid('5')), '23514|community_site_mismatch|', 'event naming another site is community_site_mismatch');
select is(public.t_err(format('update public.moderation_events set reason = ''x'' where id = %L', public.t_uid('e04'))), '55000|append_only_audit|', 'updating an event is append_only_audit');
select is(public.t_err(format('delete from public.moderation_events where id = %L', public.t_uid('e04'))), '55000|append_only_audit|', 'deleting an event is append_only_audit');
select alike(public.t_err('truncate public.moderation_events'), '0A000|%', 'plain truncate of events is blocked by the referencing foreign keys (trigger is not reached)');
select is(public.t_err('truncate public.moderation_events cascade'), '55000|append_only_audit|', 'truncate cascade of events reaches the trigger: append_only_audit');
select is((select count(*)::int from public.moderation_events where id::text like '96000000-0000-4000-8000-%'), 3, 'the three valid events remain');

-- 8. reports
select alike(public.t_rep('d01', 'comment', 'pA', null, '2'), '23514|%reports_target_shape%', 'comment report without comment_id violates the target shape');
select alike(public.t_rep('d02', 'publication', 'pA', public.t_uid('c03'), '2'), '23514|%reports_target_shape%', 'publication report with comment_id violates the target shape');
select alike(
  public.t_err(format('insert into public.reports (id, site_id, target_kind, publication_id, reporter_id, reason, state) values (%L, %L, ''publication'', %L, %L, ''spam'', ''actioned'')',
    public.t_uid('d03'), '8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_id('pA'), public.t_uid('2'))),
  '23514|%reports_resolution_shape%', 'a resolved report without resolution columns violates the resolution shape');
select alike(
  public.t_err(format('insert into public.reports (id, site_id, target_kind, publication_id, reporter_id, reason, resolved_at) values (%L, %L, ''publication'', %L, %L, ''spam'', now())',
    public.t_uid('d04'), '8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_id('pA'), public.t_uid('2'))),
  '23514|%reports_resolution_shape%', 'an open report with resolved_at violates the resolution shape');
select is(public.t_rep('d05', 'publication', 'pA', null, '2'), 'ok', 'an open publication report is accepted');
select alike(public.t_rep('d06', 'publication', 'pA', null, '2'), '23505|%reports_one_open_publication_idx%', 'a second open report on the same publication by the same reporter is 23505');
select is(public.t_rep('d07', 'publication', 'pA', null, '3'), 'ok', 'another reporter can report the same publication');
select is(public.t_rep('d08', 'publication', 'pB', null, '2'), 'ok', 'the same reporter can report another publication');
select is(public.t_rep('d09', 'comment', 'pA', public.t_uid('c03'), '2'), 'ok', 'an open comment report is accepted');
select alike(public.t_rep('d0a', 'comment', 'pA', public.t_uid('c03'), '2'), '23505|%reports_one_open_comment_idx%', 'a second open report on the same comment by the same reporter is 23505');
select is(public.t_rep('d0b', 'comment', 'pA', public.t_uid('c03'), '3'), 'ok', 'another reporter can report the same comment');
select alike(public.t_rep('d0c', 'comment', 'pB', public.t_uid('c03'), '1'), '23503|%reports_comment_fk%', 'comment report with the wrong publication is 23503');
select is(public.t_rep('d0d', 'publication', 'pA', null, '1', public.t_uid('5')), '23514|community_site_mismatch|', 'report naming another site is community_site_mismatch');

-- Resolution: only open to actioned or dismissed, resolution columns only.
select alike(
  public.t_err(format('update public.reports set state = ''dismissed'' where id = %L', public.t_uid('d09'))),
  '23514|%reports_resolution_shape%', 'resolving without resolution columns violates the resolution shape');
select is(public.t_err(format('update public.reports set reason = ''spam'' where id = %L', public.t_uid('d09'))), '55000|immutable_report|', 'editing the reason of an open report is immutable_report');
select is(
  public.t_err(format('update public.reports set state = ''actioned'', reason = ''spam'', resolved_by = %L, resolved_at = now(), resolution_event_id = %L where id = %L',
    public.t_uid('1'), public.t_uid('e08'), public.t_uid('d09'))),
  '55000|immutable_report|', 'resolving while editing the reason is immutable_report');
select is(
  public.t_err(format('update public.reports set state = ''actioned'', resolved_by = %L, resolved_at = now(), resolution_event_id = %L where id = %L',
    public.t_uid('1'), public.t_uid('e08'), public.t_uid('d09'))),
  'ok', 'open to actioned with resolution columns is allowed');
select is(
  public.t_err(format('update public.reports set state = ''dismissed'' where id = %L', public.t_uid('d09'))),
  '55000|immutable_report|', 'a resolved report cannot change state again');
select is(
  public.t_err(format('update public.reports set state = ''open'', resolved_by = null, resolved_at = null, resolution_event_id = null where id = %L', public.t_uid('d09'))),
  '55000|immutable_report|', 'a resolved report cannot be reopened');
select is(public.t_rep('d0e', 'comment', 'pA', public.t_uid('c03'), '2'), 'ok', 'after resolution the reporter can open a new report on the same comment');
select is(public.t_err(format('delete from public.reports where id = %L', public.t_uid('d05'))), '55000|immutable_report|', 'deleting a report is immutable_report');
select is(public.t_err('truncate public.reports'), '55000|immutable_report|', 'truncating reports is immutable_report');
select is((select count(*)::int from public.reports where id::text like '96000000-0000-4000-8000-%'), 6, 'no report was lost');

-- 9. Function grants
select is(has_function_privilege(r.role, f.sig, 'EXECUTE'), false, r.role || ' cannot execute ' || f.sig)
from unnest(array[
  'public.plain_text_ok(text)',
  'public.rate_limit_consume(uuid,text,timestamptz)',
  'public.community_lock_publication(uuid)',
  'public.is_site_moderator(uuid,uuid)',
  'public.moderation_target_site(public.moderation_target_kind,uuid)',
  'public.prevent_audit_change()',
  'public.community_site_matches()',
  'public.limit_comment_change()',
  'public.limit_report_change()'
]) as f (sig)
cross join unnest(array['anon', 'authenticated', 'public']) as r (role)
order by f.sig, r.role;

select is(has_function_privilege(r.role, f.sig, 'EXECUTE'), r.expected, r.role || ' EXECUTE ' || f.sig || ' is ' || r.expected)
from unnest(array[
  'public.create_comment(uuid,uuid,text,text,text)',
  'public.retract_comment(uuid)',
  'public.set_support(uuid,boolean)',
  'public.my_support_state(uuid)',
  'public.create_report(public.moderation_target_kind,uuid,public.report_reason,text,text,text)',
  'public.list_my_moderation_notices(uuid)'
]) as f (sig)
cross join (values ('authenticated', true), ('anon', false), ('public', false)) as r (role, expected)
order by f.sig, r.role;

select is(has_function_privilege(r.role, f.sig, 'EXECUTE'), true, r.role || ' can execute ' || f.sig)
from unnest(array[
  'public.list_public_comments(uuid,timestamptz,uuid,integer)',
  'public.get_public_community_summary(uuid)'
]) as f (sig)
cross join unnest(array['anon', 'authenticated']) as r (role)
order by f.sig, r.role;

select is(
  (select count(*)::int from pg_proc as p
   where p.pronamespace = 'public'::regnamespace
     and p.prosecdef
     and p.proname in (
       'rate_limit_consume', 'community_lock_publication', 'create_comment', 'retract_comment',
       'set_support', 'my_support_state', 'create_report', 'list_my_moderation_notices',
       'list_public_comments', 'get_public_community_summary', 'is_site_moderator', 'moderation_target_site')),
  12, 'all twelve community functions are SECURITY DEFINER'
);
select is(
  (select count(*)::int from pg_proc as p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in (
       'rate_limit_consume', 'community_lock_publication', 'create_comment', 'retract_comment',
       'set_support', 'my_support_state', 'create_report', 'list_my_moderation_notices',
       'list_public_comments', 'get_public_community_summary', 'is_site_moderator', 'moderation_target_site')
     and coalesce(p.proconfig @> array['search_path=""'], false)),
  12, 'all twelve community functions pin an empty search_path'
);

select * from finish();
rollback;
