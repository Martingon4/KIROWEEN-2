-- Independent-review fixes for the community and moderation work (spec 04):
-- 1. Profile aliases are editable by their owner and are shown live next to comments,
--    reports, and moderation history. They must be plain text, NFC-normalized, limited to
--    Latin letters (blocks Cyrillic and Greek homoglyphs), unique after case and NFKC
--    folding, and never one of the labels the interface uses for missing profiles.
-- 2. plain_text_ok also rejects invisible and line-separator characters, so a comment,
--    note, or reason cannot be blank-looking or visually obfuscated. Existing rows are not
--    revalidated; the pilot database holds none.
-- 3. create_report serializes concurrent requests per reporter and target, so two
--    different idempotency keys cannot both pass deduplication and end in a 500.
-- 4. resolve_report accepts an "actioned" event only if it happened after the report.
-- 5. rate_limit_consume never purges the live bucket of a long window, and windows are
--    capped at one day.
-- 6. Indexes for the moderation_events lookups used by notices, hidden lists, history.
-- 7. Authors of a hidden publication can read the public moderation reason.

create or replace function public.plain_text_ok(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null
    and p_text = public.js_trim(p_text)
    and p_text !~ '[\x01-\x09\x0B-\x1F\x7F-\x9F\u00AD\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]';
$$;

revoke all on function public.plain_text_ok(text) from public, anon, authenticated;

-- A SECURITY DEFINER wrapper keeps plain_text_ok private: a CHECK constraint runs the
-- function with the privileges of the user who updates the row.
create or replace function public.profile_alias_ok(p_alias text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_alias is not null
    and public.plain_text_ok(p_alias)
    and p_alias = normalize(p_alias, nfc)
    and p_alias ~ '^[A-Za-z0-9À-ÖØ-öø-ÿ][A-Za-z0-9À-ÖØ-öø-ÿ ._-]*$'
    and lower(p_alias) <> all (array['participant', 'moderator', 'admin', 'system', 'moderacion', 'moderación']);
$$;

revoke all on function public.profile_alias_ok(text) from public;
grant execute on function public.profile_alias_ok(text) to anon, authenticated;

alter table public.profiles
  add constraint profiles_alias_safe check (public.profile_alias_ok(public_alias)) not valid;
alter table public.profiles validate constraint profiles_alias_safe;

create unique index profiles_alias_folded_idx
  on public.profiles (lower(normalize(public_alias, nfkc)));

alter table public.rate_limits
  add constraint rate_limits_window_max check (window_seconds <= 86400);

create index moderation_events_comment_idx
  on public.moderation_events (comment_id, action, created_at desc, id desc)
  where comment_id is not null;

create index moderation_events_publication_idx
  on public.moderation_events (publication_id, action, created_at desc, id desc)
  where comment_id is null;


create or replace function public.create_report(
  p_target_kind public.moderation_target_kind,
  p_target_id uuid,
  p_reason public.report_reason,
  p_note text,
  p_idempotency_key text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  previous public.mutation_requests%rowtype;
  v_pub_id uuid;
  v_comment_id uuid;
  v_pub record;
  v_existing record;
  v_report_id uuid := pg_catalog.gen_random_uuid();
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_target_kind is null
    or p_target_id is null
    or p_reason is null
    or (p_note is not null and (char_length(p_note) not between 1 and 500 or not public.plain_text_ok(p_note)))
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_report_request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':create_report:' || p_idempotency_key, 0)
  );
  select * into previous
  from public.mutation_requests as request
  where request.actor_id = actor
    and request.operation = 'create_report'
    and request.idempotency_key = p_idempotency_key;
  if found then
    if previous.payload_hash <> p_payload_hash then
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  if p_target_kind = 'publication' then
    v_pub_id := p_target_id;
  else
    select c.publication_id into v_pub_id
    from public.comments as c
    where c.id = p_target_id;
  end if;

  select * into v_pub from public.community_lock_publication(v_pub_id);
  if v_pub.publication_id is null then
    raise exception using errcode = 'P0002', message = 'target_not_found';
  end if;

  if p_target_kind = 'comment' then
    select c.id into v_comment_id
    from public.comments as c
    where c.id = p_target_id
      and c.publication_id = v_pub.publication_id
      and c.moderation_state = 'visible'
      and c.retracted_at is null;
    if v_comment_id is null then
      raise exception using errcode = 'P0002', message = 'target_not_found';
    end if;
  end if;

  -- Two requests with different idempotency keys for the same target must not both
  -- pass deduplication: serialize them per reporter and target.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':report:' || p_target_kind::text || ':' || p_target_id::text, 0)
  );

  -- Deduplicate before the limit so repeating a report costs nothing.
  select r.id, r.state into v_existing
  from public.reports as r
  where r.reporter_id = actor
    and r.state = 'open'
    and r.target_kind = p_target_kind
    and (
      (p_target_kind = 'publication' and r.publication_id = v_pub.publication_id)
      or (p_target_kind = 'comment' and r.comment_id = v_comment_id)
    );
  if v_existing.id is not null then
    result := pg_catalog.jsonb_build_object(
      'reportId', v_existing.id, 'state', v_existing.state, 'duplicate', true);
    insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
    values (actor, 'create_report', p_idempotency_key, p_payload_hash, result);
    return result;
  end if;

  perform public.rate_limit_consume(actor, 'report', pg_catalog.now());

  insert into public.reports (
    id, site_id, target_kind, publication_id, comment_id, reporter_id, reason, note
  )
  values (
    v_report_id, v_pub.site_id, p_target_kind, v_pub.publication_id, v_comment_id,
    actor, p_reason, p_note
  );

  result := pg_catalog.jsonb_build_object('reportId', v_report_id, 'state', 'open', 'duplicate', false);
  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'create_report', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.create_report(
  public.moderation_target_kind, uuid, public.report_reason, text, text, text
) from public, anon;
grant execute on function public.create_report(
  public.moderation_target_kind, uuid, public.report_reason, text, text, text
) to authenticated;

create or replace function public.resolve_report(
  p_report_id uuid,
  p_outcome text,
  p_note text,
  p_event_id uuid,
  p_idempotency_key text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  previous public.mutation_requests%rowtype;
  v_report public.reports%rowtype;
  v_event_id uuid;
  v_new_state public.report_state;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_report_id is null
    or p_outcome is null
    or p_outcome not in ('dismissed', 'actioned')
    or (p_outcome = 'dismissed'
        and (p_note is null or char_length(p_note) not between 1 and 500 or not public.plain_text_ok(p_note)))
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_moderation_request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':resolve_report:' || p_idempotency_key, 0)
  );
  select * into previous
  from public.mutation_requests as request
  where request.actor_id = actor
    and request.operation = 'resolve_report'
    and request.idempotency_key = p_idempotency_key;
  if found then
    if previous.payload_hash <> p_payload_hash then
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  select * into v_report from public.reports as r where r.id = p_report_id;
  if v_report.id is null or not public.is_site_moderator(v_report.site_id, actor) then
    raise exception using errcode = 'P0002', message = 'report_not_found';
  end if;

  select * into v_report from public.reports as r where r.id = p_report_id for update;
  if v_report.state <> 'open' then
    raise exception using errcode = 'FT409', message = 'report_already_resolved';
  end if;

  if p_outcome = 'dismissed' then
    v_event_id := pg_catalog.gen_random_uuid();
    insert into public.moderation_events (
      id, site_id, target_kind, publication_id, comment_id, action, reason, actor_id
    )
    values (
      v_event_id, v_report.site_id, v_report.target_kind, v_report.publication_id,
      v_report.comment_id, 'dismiss', p_note, actor
    );
    v_new_state := 'dismissed';
  else
    -- The event must be a hide or restore of this very target, in the report's site.
    select e.id into v_event_id
    from public.moderation_events as e
    where e.id = p_event_id
      and e.site_id = v_report.site_id
      and e.target_kind = v_report.target_kind
      and e.publication_id = v_report.publication_id
      and e.comment_id is not distinct from v_report.comment_id
      and e.action in ('hide', 'restore')
      and e.created_at >= v_report.created_at;
    if v_event_id is null then
      raise exception using errcode = 'FT422', message = 'report_mismatch';
    end if;
    v_new_state := 'actioned';
  end if;

  update public.reports
  set state = v_new_state, resolved_by = actor, resolved_at = pg_catalog.now(),
      resolution_event_id = v_event_id
  where id = p_report_id;

  result := pg_catalog.jsonb_build_object(
    'reportId', p_report_id, 'state', v_new_state, 'eventId', v_event_id);
  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'resolve_report', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.resolve_report(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.resolve_report(uuid, text, text, uuid, text, text) to authenticated;

create or replace function public.rate_limit_consume(
  p_actor uuid,
  p_action text,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_window integer;
  v_start timestamptz;
  v_count integer;
begin
  select l.max_count, l.window_seconds
  into v_max, v_window
  from public.rate_limits as l
  where l.action = p_action;

  if v_max is null or p_actor is null or p_now is null then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_request';
  end if;

  v_start := pg_catalog.date_bin(
    pg_catalog.make_interval(secs => v_window),
    p_now,
    timestamptz '2000-01-01 00:00:00+00'
  );

  insert into public.rate_windows as w (actor_id, action, window_start, count)
  values (p_actor, p_action, v_start, 1)
  on conflict (actor_id, action, window_start)
  do update set count = w.count + 1
  where w.count < v_max
  returning w.count into v_count;

  if v_count is null then
    raise exception using
      errcode = 'FT429',
      message = 'rate_limited',
      detail = greatest(
        1,
        pg_catalog.ceil(extract(epoch from (v_start + pg_catalog.make_interval(secs => v_window) - p_now)))
      )::integer::text;
  end if;

  -- Old buckets are useless after a day; keep the table small without a scheduler.
  delete from public.rate_windows as old
  where old.actor_id = p_actor
    and old.window_start < p_now - greatest(interval '24 hours', pg_catalog.make_interval(secs => v_window));
end;
$$;

revoke all on function public.rate_limit_consume(uuid, text, timestamptz)
  from public, anon, authenticated;



-- The author of a publication that moderation hid reads the public reason here. The
-- public page answers 404 for hidden content, so this is the only place it can show.
-- Never returns private notes or who reported.
create or replace function public.list_my_hidden_publications()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  return pg_catalog.jsonb_build_object('items', coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'publicationId', p.id,
        'label', p.public_label,
        'reason', e.reason,
        'hiddenAt', e.created_at
      ) order by e.created_at desc, p.id)
    from public.publications as p
    join lateral (
      select ev.reason, ev.created_at
      from public.moderation_events as ev
      where ev.publication_id = p.id and ev.comment_id is null and ev.action = 'hide'
      order by ev.created_at desc, ev.id desc
      limit 1
    ) as e on true
    where p.published_by = actor and p.moderation_state = 'hidden'
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.list_my_hidden_publications() from public, anon;
grant execute on function public.list_my_hidden_publications() to authenticated;
