begin;

select plan(87);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction). They run as the calling role.
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
create function public.t_doc(p text) returns jsonb language sql stable as $$ select doc from ctx where name = p $$;
create function public.t_uid(p text) returns text language sql immutable as
$$ select '96000000-0000-4000-8000-' || lpad(p, 12, '0') $$;
create function public.t_as(p text) returns text language sql as
$$ select set_config('request.jwt.claim.sub', public.t_uid(p), true) $$;
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
create function public.t_consume(p_actor text, p_action text, p_now text) returns text language sql as $$
  select public.t_err(format('select public.rate_limit_consume(%L, %L, %L)', public.t_uid(p_actor), p_action, p_now))
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
-- Calls through the public RPCs (run as the current role).
create function public.t_comment(p_body text, p_key text, p_hash text default repeat('a', 64)) returns text language sql as $$
  select public.t_err(format('select public.create_comment(%L, null, %L, %L, %L)', public.t_id('pA'), p_body, p_key, p_hash))
$$;
create function public.t_report(p_kind text, p_target uuid, p_key text) returns text language sql as $$
  select public.t_err(format('select public.create_report(%L, %L, ''spam'', null, %L, %L)', p_kind, p_target, p_key, repeat('a', 64)))
$$;
create function public.t_support(p_on boolean) returns text language sql as $$
  select public.t_err(format('select public.set_support(%L, %L)', public.t_id('pA'), p_on))
$$;
-- Sum of consumed units for an actor and action across all buckets (run as postgres).
create function public.t_used(p_actor text, p_action text) returns integer language sql as $$
  select coalesce(sum(w.count), 0)::int from public.rate_windows as w
  where w.actor_id = public.t_uid(p_actor)::uuid and w.action = p_action
$$;

-- 1. Seed values and table checks
select results_eq(
  $$select action, max_count, window_seconds from public.rate_limits order by action$$,
  $$values ('comment'::text, 10, 3600), ('report', 10, 3600), ('support', 60, 3600)$$,
  'rate_limits holds exactly the comment, report, and support limits'
);

insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n::text)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from generate_series(1, 8) as n;

select alike(public.t_err($$insert into public.rate_limits values ('zero_max', 0, 3600)$$), '23514|%rate_limits_max_count_check%', 'max_count 0 is rejected');
select alike(public.t_err($$insert into public.rate_limits values ('neg_max', -1, 3600)$$), '23514|%rate_limits_max_count_check%', 'negative max_count is rejected');
select alike(public.t_err($$insert into public.rate_limits values ('zero_window', 5, 0)$$), '23514|%rate_limits_window_seconds_check%', 'window_seconds 0 is rejected');
select alike(public.t_err($$insert into public.rate_limits values ('Upper', 5, 60)$$), '23514|%rate_limits_action_check%', 'an uppercase action is rejected');
select alike(public.t_err($$insert into public.rate_limits values ('with-dash', 5, 60)$$), '23514|%rate_limits_action_check%', 'an action with a dash is rejected');
select alike(public.t_err($$insert into public.rate_limits values ('with_digit1', 5, 60)$$), '23514|%rate_limits_action_check%', 'an action with a digit is rejected');
select is(public.t_err($$insert into public.rate_limits values ('valid_action', 5, 60)$$), 'ok', 'a valid new action is accepted');
select alike(
  public.t_err(format('insert into public.rate_windows values (%L, ''comment'', timestamptz ''2030-01-01 00:00+00'', 0)', public.t_uid('6'))),
  '23514|%rate_windows_count_check%', 'a window count of 0 is rejected');
select alike(
  public.t_err(format('insert into public.rate_windows values (%L, ''unknown_action'', timestamptz ''2030-01-01 00:00+00'', 1)', public.t_uid('6'))),
  '23503|%', 'a window for an unknown action is 23503');

-- 2. rate_limit_consume with a pinned clock (as postgres)
select is(
  (select count(*)::int from generate_series(1, 10) as g where public.t_consume('6', 'comment', '2030-03-05 10:30:00+00') = 'ok'),
  10, 'the first 10 comment calls in a bucket succeed'
);
select is(public.t_used('6', 'comment'), 10, 'the counter reads 10');
select is(
  (select w.window_start from public.rate_windows as w where w.actor_id = public.t_uid('6')::uuid and w.action = 'comment'),
  timestamptz '2030-03-05 10:00:00+00', 'a call at 10:30 lands in the bucket starting at 10:00');
select is(public.t_consume('6', 'comment', '2030-03-05 10:59:30+00'), 'FT429|rate_limited|30', 'the 11th call raises FT429 with 30 seconds to the next bucket');
select is(public.t_consume('6', 'comment', '2030-03-05 10:30:00+00'), 'FT429|rate_limited|1800', 'the 11th call at 10:30 reports 1800 seconds');
select is(public.t_consume('6', 'comment', '2030-03-05 10:00:00+00'), 'FT429|rate_limited|3600', 'at the exact bucket start the wait is the full 3600 seconds');
select is(public.t_consume('6', 'comment', '2030-03-05 10:59:59.5+00'), 'FT429|rate_limited|1', 'half a second before the next bucket rounds up to 1');
select is(public.t_consume('6', 'comment', '2030-03-05 10:59:59.999+00'), 'FT429|rate_limited|1', 'one millisecond before the next bucket reports 1');
select is(public.t_used('6', 'comment'), 10, 'rejected calls leave the counter at 10');
select is((select count(*)::int from public.rate_windows where actor_id = public.t_uid('6')::uuid), 1, 'rejected calls create no extra bucket');
select is(public.t_consume('6', 'comment', '2030-03-05 11:00:00+00'), 'ok', 'the next bucket (11:00:00) accepts a call');
select is(
  (select w.count from public.rate_windows as w where w.actor_id = public.t_uid('6')::uuid and w.action = 'comment' and w.window_start = timestamptz '2030-03-05 11:00:00+00'),
  1, 'the next bucket starts again at 1');
select is(
  (select w.count from public.rate_windows as w where w.actor_id = public.t_uid('6')::uuid and w.action = 'comment' and w.window_start = timestamptz '2030-03-05 10:00:00+00'),
  10, 'the previous bucket keeps its 10');
select is(public.t_consume('6', 'comment', '2030-03-05 10:30:00+00'), 'FT429|rate_limited|1800', 'the earlier bucket is still full');

select is(public.t_consume('7', 'comment', '2030-03-05 10:30:00+00'), 'ok', 'another actor is not limited by a full bucket');
select is(public.t_used('7', 'comment'), 1, 'the other actor has its own counter');
select is(public.t_consume('6', 'report', '2030-03-05 10:30:00+00'), 'ok', 'another action of the same actor is not limited');
select is(public.t_used('6', 'report'), 1, 'the other action has its own counter');
select is(
  (select count(*)::int from generate_series(1, 60) as g where public.t_consume('6', 'support', '2030-03-05 10:30:00+00') = 'ok'),
  60, 'the first 60 support calls in a bucket succeed');
select is(public.t_consume('6', 'support', '2030-03-05 10:30:00+00'), 'FT429|rate_limited|1800', 'the 61st support call raises FT429');
select is(public.t_used('6', 'support'), 60, 'the support counter stays at 60');
select alike(public.t_err($$delete from public.rate_limits where action = 'support'$$), '23503|%', 'deleting a limit that has windows is blocked');

select is(public.t_consume('6', 'nope', '2030-03-05 10:30:00+00'), '22023|invalid_rate_limit_request|', 'an unknown action is 22023');
select is(public.t_err('select public.rate_limit_consume(null, ''comment'', timestamptz ''2030-03-05 10:30:00+00'')'), '22023|invalid_rate_limit_request|', 'a null actor is 22023');
select is(public.t_err(format('select public.rate_limit_consume(%L, ''comment'', null)', public.t_uid('6'))), '22023|invalid_rate_limit_request|', 'a null clock is 22023');
select is(public.t_err(format('select public.rate_limit_consume(%L, null, timestamptz ''2030-03-05 10:30:00+00'')', public.t_uid('6'))), '22023|invalid_rate_limit_request|', 'a null action is 22023');
select is((select count(*)::int from public.rate_windows where action = 'nope'), 0, 'an unknown action creates no window');

-- Old buckets of the calling actor are purged on a successful call.
insert into public.rate_windows (actor_id, action, window_start, count)
values
  (public.t_uid('8')::uuid, 'comment', timestamptz '2030-03-04 09:00:00+00', 3),
  (public.t_uid('8')::uuid, 'support', timestamptz '2030-03-04 10:30:00+00', 2),
  (public.t_uid('8')::uuid, 'report', timestamptz '2030-03-04 11:00:00+00', 1),
  (public.t_uid('7')::uuid, 'report', timestamptz '2030-03-04 09:00:00+00', 2);
select is(public.t_consume('8', 'comment', '2030-03-05 10:30:00+00'), 'ok', 'a call by an actor with old buckets succeeds');
select is(
  (select count(*)::int from public.rate_windows where actor_id = public.t_uid('8')::uuid and window_start = timestamptz '2030-03-04 09:00:00+00'),
  0, 'a bucket older than 24 hours is purged');
select is(
  (select count(*)::int from public.rate_windows where actor_id = public.t_uid('8')::uuid and window_start = timestamptz '2030-03-04 10:30:00+00'),
  1, 'a bucket exactly 24 hours old is kept');
select is(
  (select count(*)::int from public.rate_windows where actor_id = public.t_uid('8')::uuid and window_start = timestamptz '2030-03-04 11:00:00+00'),
  1, 'a bucket 23.5 hours old is kept');
select is(
  (select count(*)::int from public.rate_windows where actor_id = public.t_uid('7')::uuid and window_start = timestamptz '2030-03-04 09:00:00+00'),
  1, 'old buckets of another actor are not purged');

-- 3. Through the public RPCs (real now())
set local role authenticated;
select public.t_as('1');
insert into ctx select 'bA', public.t_branch('Rate limits'), null;
insert into ctx select 'rA', public.t_save(public.t_id('bA'), jsonb_build_array(public.t_tree(public.t_uid('f1'), public.t_pt(-98.19775, 19.0436)))), null;
insert into ctx select 'pA', public.t_pub(public.t_id('rA')), null;

-- 3.1 Comments (user 2)
select public.t_as('2');
insert into ctx select 'first', null, public.create_comment(public.t_id('pA'), null, 'Comentario 1', 'cmt-key-01', repeat('a', 64));
select is(public.t_doc('first') ->> 'publicationId', public.t_id('pA')::text, 'the first comment succeeds and names its publication');
select is(
  (select count(*)::int from generate_series(2, 10) as g
   where public.t_comment('Comentario ' || g, 'cmt-key-' || lpad(g::text, 2, '0')) = 'ok'),
  9, 'comments 2 to 10 succeed');
insert into ctx select 'c11', null, to_jsonb(public.t_comment('Comentario 11', 'cmt-key-11'));
select matches(public.t_doc('c11') #>> '{}', '^FT429\|rate_limited\|[0-9]+$', 'the 11th comment raises FT429 with a numeric DETAIL');
select ok(
  split_part(public.t_doc('c11') #>> '{}', '|', 3)::int between 1 and 3600,
  'the FT429 DETAIL is between 1 and 3600 seconds');
reset role;
select is((select count(*)::int from public.comments where author_id = public.t_uid('2')::uuid), 10, 'the rejected comment was not created');
select is((select count(*)::int from public.comments where body = 'Comentario 11'), 0, 'no comment has the rejected body');
select is(
  (select count(*)::int from public.mutation_requests where actor_id = public.t_uid('2')::uuid and operation = 'create_comment'),
  10, 'the rejected comment left no mutation_requests row');
select is(
  (select count(*)::int from public.mutation_requests where actor_id = public.t_uid('2')::uuid and idempotency_key = 'cmt-key-11'),
  0, 'the rejected key is not stored');
select is(public.t_used('2', 'comment'), 10, 'the comment counter is 10');

set local role authenticated;
select public.t_as('2');
insert into ctx select 'replay', null, public.create_comment(public.t_id('pA'), null, 'Comentario 1', 'cmt-key-01', repeat('a', 64));
select is(public.t_doc('replay'), public.t_doc('first'), 'a replay of an earlier key at the limit returns the stored result');
select is(public.t_comment('Otro cuerpo', 'cmt-key-01', repeat('b', 64)), 'FT001|idempotency_key_reused|', 'a reused key with another payload is FT001, not FT429');
select is(public.t_comment('', 'cmt-key-12'), '22023|invalid_comment_request|', 'an invalid body at the limit is 22023, not FT429');
select is(
  public.t_err(format('select public.create_comment(%L, %L, ''Ancla'', ''cmt-key-13'', %L)', public.t_id('pA'), gen_random_uuid(), repeat('a', 64))),
  'FT422|invalid_anchor|', 'an invalid anchor at the limit is FT422, not FT429');
select is(
  public.t_err(format('select public.create_comment(%L, null, ''Huerfano'', ''cmt-key-14'', %L)', gen_random_uuid(), repeat('a', 64))),
  'P0002|publication_not_found|', 'a missing publication at the limit is P0002, not FT429');
reset role;
select is(public.t_used('2', 'comment'), 10, 'replays and validation errors consumed nothing');
select is((select count(*)::int from public.comments where author_id = public.t_uid('2')::uuid), 10, 'replays and validation errors created no comments');

-- 3.2 Reports (user 3)
insert into ctx
select 'cm' || n.rn, n.id, null
from (select c.id, row_number() over (order by c.body = 'Comentario 1' desc, c.body) as rn
      from public.comments as c where c.publication_id = public.t_id('pA')) as n;
select is((select count(*)::int from ctx where name like 'cm%'), 10, 'ten comments are available to report');

set local role authenticated;
select public.t_as('3');
insert into ctx select 'rep1', null, public.create_report('comment', public.t_id('cm1'), 'spam', null, 'rep-key-01', repeat('a', 64));
select is(public.t_doc('rep1') ->> 'duplicate', 'false', 'the first report is created');
insert into ctx select 'dup1', null, public.create_report('comment', public.t_id('cm1'), 'spam', null, 'rep-dup-01', repeat('a', 64));
select is(public.t_doc('dup1') ->> 'duplicate', 'true', 'a second report of the same target is a duplicate');
select is(public.t_doc('dup1') ->> 'reportId', public.t_doc('rep1') ->> 'reportId', 'the duplicate returns the existing report');
reset role;
select is(public.t_used('3', 'report'), 1, 'the duplicate did not consume');
set local role authenticated;
select public.t_as('3');
select is(
  (select count(*)::int from generate_series(2, 10) as g
   where public.t_report('comment', public.t_id('cm' || g), 'rep-key-' || lpad(g::text, 2, '0')) = 'ok'),
  9, 'reports 2 to 10 on different comments succeed');
reset role;
select is(public.t_used('3', 'report'), 10, 'the report counter is 10');
set local role authenticated;
select public.t_as('3');
insert into ctx select 'dup2', null, public.create_report('comment', public.t_id('cm2'), 'spam', null, 'rep-dup-02', repeat('a', 64));
select is(public.t_doc('dup2') ->> 'duplicate', 'true', 'a duplicate at the limit is returned, not rejected');
insert into ctx select 'replay5', null, public.create_report('comment', public.t_id('cm5'), 'spam', null, 'rep-key-05', repeat('a', 64));
select is(public.t_doc('replay5') ->> 'duplicate', 'false', 'a replay of an earlier key at the limit returns the stored result');
insert into ctx select 'rep11', null, to_jsonb(public.t_report('publication', public.t_id('pA'), 'rep-key-pub'));
select matches(public.t_doc('rep11') #>> '{}', '^FT429\|rate_limited\|[0-9]+$', 'the 11th report on a new target raises FT429');
reset role;
select is(public.t_used('3', 'report'), 10, 'the rejected report left the counter at 10');
select is((select count(*)::int from public.reports where reporter_id = public.t_uid('3')::uuid), 10, 'the rejected report was not created');
select is(
  (select count(*)::int from public.mutation_requests where actor_id = public.t_uid('3')::uuid and idempotency_key = 'rep-key-pub'),
  0, 'the rejected report left no mutation_requests row');
select is(
  (select r.id::text from public.reports as r where r.comment_id = public.t_id('cm5') and r.reporter_id = public.t_uid('3')::uuid),
  public.t_doc('replay5') ->> 'reportId', 'the replay returned the report created by the original call');

-- 3.3 Support (users 4 and 5)
set local role authenticated;
select public.t_as('4');
insert into ctx select 'st1', null, public.set_support(public.t_id('pA'), true);
select is(public.t_doc('st1'), '{"supported": true, "count": 1}'::jsonb, 'the first support is counted');
reset role;
select is(public.t_used('4', 'support'), 1, 'a real change consumes one unit');
set local role authenticated;
select public.t_as('4');
select is(public.t_support(true), 'ok', 'a repeated PUT succeeds');
reset role;
select is(public.t_used('4', 'support'), 1, 'a repeated PUT does not consume');
set local role authenticated;
select public.t_as('4');
select is(public.t_support(false), 'ok', 'removing the support succeeds');
reset role;
select is(public.t_used('4', 'support'), 2, 'removing a real support consumes one unit');
set local role authenticated;
select public.t_as('4');
select is(public.t_support(false), 'ok', 'a repeated DELETE succeeds');
reset role;
select is(public.t_used('4', 'support'), 2, 'a repeated DELETE does not consume');

-- User 5 starts with 59 of 60 units used in the current bucket.
insert into public.rate_windows (actor_id, action, window_start, count)
values (
  public.t_uid('5')::uuid, 'support',
  pg_catalog.date_bin(interval '3600 seconds', now(), timestamptz '2000-01-01 00:00:00+00'), 59);
set local role authenticated;
select public.t_as('5');
select is(public.t_support(true), 'ok', 'the 60th support change succeeds');
select is(public.my_support_state(public.t_id('pA')), true, 'the support exists');
select matches(public.t_support(false), '^FT429\|rate_limited\|[0-9]+$', 'the 61st change raises FT429');
select is(public.my_support_state(public.t_id('pA')), true, 'the rolled-back request left the support row in place');
select is(public.t_support(true), 'ok', 'a repeated PUT at the limit still succeeds');
reset role;
select is(public.t_used('5', 'support'), 60, 'the support counter stays at 60');
select is((select count(*)::int from public.supports where user_id = public.t_uid('5')::uuid), 1, 'the support row of user 5 survived the rejected removal');

select * from finish();
rollback;
