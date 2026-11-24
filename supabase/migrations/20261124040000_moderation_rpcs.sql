-- Moderation: report queue, hide and restore with reason, audit (FT-10), spec 04 task 4.
-- Authorization is derived from the target, never from a client-supplied site. A
-- non-moderator, a moderator of another site, and a missing target all get P0002 (404),
-- and the permission check runs before any row lock is taken.

create or replace function public.is_site_moderator(p_site_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.site_roles as sr
    where sr.site_id = p_site_id
      and sr.user_id = p_user_id
      and sr.role = 'moderator'
  );
$$;

revoke all on function public.is_site_moderator(uuid, uuid) from public, anon, authenticated;

-- Internal: the site, publication, and comment a moderation target belongs to.
create or replace function public.moderation_target_site(
  p_kind public.moderation_target_kind,
  p_id uuid
)
returns table (site_id uuid, publication_id uuid, comment_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.site_id, p.id, null::uuid
  from public.publications as p
  join public.revisions as r on r.id = p.revision_id
  where p_kind = 'publication' and p.id = p_id
  union all
  select r.site_id, p.id, c.id
  from public.comments as c
  join public.publications as p on p.id = c.publication_id
  join public.revisions as r on r.id = p.revision_id
  where p_kind = 'comment' and c.id = p_id;
$$;

revoke all on function public.moderation_target_site(public.moderation_target_kind, uuid)
  from public, anon, authenticated;

create or replace function public.list_open_reports(
  p_site_id uuid,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_items jsonb;
  v_next jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or (p_after_created_at is null) <> (p_after_id is null)
  then
    raise exception using errcode = '22023', message = 'invalid_page_request';
  end if;
  if p_site_id is null or not public.is_site_moderator(p_site_id, actor) then
    raise exception using errcode = 'P0002', message = 'site_not_found';
  end if;

  with page as (
    select rp.id, rp.target_kind, rp.publication_id, rp.comment_id, rp.reason, rp.note,
           rp.created_at,
           coalesce(rpr.public_alias, 'participant') as reporter_alias,
           case rp.target_kind when 'publication' then p.moderation_state else c.moderation_state end as target_state,
           case rp.target_kind when 'publication' then p.public_label else pg_catalog.left(c.body, 140) end as preview,
           pg_catalog.row_number() over (order by rp.created_at, rp.id) as rn
    from public.reports as rp
    join public.publications as p on p.id = rp.publication_id
    left join public.comments as c on c.id = rp.comment_id
    left join public.profiles as rpr on rpr.id = rp.reporter_id
    where rp.site_id = p_site_id
      and rp.state = 'open'
      and (p_after_created_at is null or (rp.created_at, rp.id) > (p_after_created_at, p_after_id))
    order by rp.created_at, rp.id
    limit p_limit + 1
  )
  select
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'reportId', page.id,
        'targetKind', page.target_kind,
        'publicationId', page.publication_id,
        'commentId', page.comment_id,
        'reason', page.reason,
        'note', page.note,
        'reporterAlias', page.reporter_alias,
        'targetState', page.target_state,
        'preview', page.preview,
        'createdAt', page.created_at
      ) order by page.rn) filter (where page.rn <= p_limit), '[]'::jsonb),
    (select pg_catalog.jsonb_build_object('createdAt', n.created_at, 'id', n.id)
     from page as n where n.rn = p_limit and (select pg_catalog.count(*) from page) > p_limit)
  into v_items, v_next
  from page;

  return pg_catalog.jsonb_build_object('items', v_items, 'nextCursor', v_next);
end;
$$;

revoke all on function public.list_open_reports(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_open_reports(uuid, timestamptz, uuid, integer) to authenticated;

-- Moderators read content in any state directly; no snapshot copies are kept.
create or replace function public.get_moderation_target(
  p_kind public.moderation_target_kind,
  p_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_t record;
  v_content jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_kind is null or p_id is null then
    raise exception using errcode = '22023', message = 'invalid_moderation_request';
  end if;

  select * into v_t from public.moderation_target_site(p_kind, p_id);
  if v_t.site_id is null or not public.is_site_moderator(v_t.site_id, actor) then
    raise exception using errcode = 'P0002', message = 'target_not_found';
  end if;

  if p_kind = 'publication' then
    select pg_catalog.jsonb_build_object(
             'state', p.moderation_state,
             'label', p.public_label,
             'summary', p.public_summary,
             'authorAlias', p.public_author_alias,
             'createdAt', p.published_at)
    into v_content
    from public.publications as p
    where p.id = p_id;
  else
    select pg_catalog.jsonb_build_object(
             'state', c.moderation_state,
             'retracted', c.retracted_at is not null,
             'body', c.body,
             'authorAlias', coalesce(pr.public_alias, 'participant'),
             'createdAt', c.created_at)
    into v_content
    from public.comments as c
    left join public.profiles as pr on pr.id = c.author_id
    where c.id = p_id;
  end if;

  return v_content || pg_catalog.jsonb_build_object(
    'targetKind', p_kind,
    'targetId', p_id,
    'siteId', v_t.site_id,
    'publicationId', v_t.publication_id,
    'openReports', (
      select pg_catalog.count(*) from public.reports as r
      where r.state = 'open'
        and r.publication_id = v_t.publication_id
        and r.comment_id is not distinct from v_t.comment_id
    ),
    'history', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'eventId', e.id,
          'action', e.action,
          'reason', e.reason,
          'privateNote', e.private_note,
          'actorAlias', coalesce(ap.public_alias, 'moderator'),
          'createdAt', e.created_at
        ) order by e.created_at, e.id)
      from public.moderation_events as e
      left join public.profiles as ap on ap.id = e.actor_id
      where e.publication_id = v_t.publication_id
        and e.comment_id is not distinct from v_t.comment_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_moderation_target(public.moderation_target_kind, uuid) from public, anon;
grant execute on function public.get_moderation_target(public.moderation_target_kind, uuid) to authenticated;

create or replace function public.moderate_target(
  p_target_kind public.moderation_target_kind,
  p_target_id uuid,
  p_action public.moderation_action,
  p_reason text,
  p_private_note text,
  p_report_id uuid,
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
  v_t record;
  v_current public.publication_moderation_state;
  v_new public.publication_moderation_state;
  v_report public.reports%rowtype;
  v_event_id uuid := pg_catalog.gen_random_uuid();
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_target_kind is null
    or p_target_id is null
    or p_action is null
    or p_action not in ('hide', 'restore')
    or p_reason is null
    or char_length(p_reason) not between 1 and 500
    or not public.plain_text_ok(p_reason)
    or (p_private_note is not null
        and (char_length(p_private_note) not between 1 and 500 or not public.plain_text_ok(p_private_note)))
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_moderation_request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':moderate_target:' || p_idempotency_key, 0)
  );
  select * into previous
  from public.mutation_requests as request
  where request.actor_id = actor
    and request.operation = 'moderate_target'
    and request.idempotency_key = p_idempotency_key;
  if found then
    if previous.payload_hash <> p_payload_hash then
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  -- Permission first, then locks: a stranger can never hold a lock on someone's content.
  select * into v_t from public.moderation_target_site(p_target_kind, p_target_id);
  if v_t.site_id is null or not public.is_site_moderator(v_t.site_id, actor) then
    raise exception using errcode = 'P0002', message = 'target_not_found';
  end if;

  -- Lock order: publication, then comment. NO KEY UPDATE on a publication conflicts with
  -- the FOR SHARE taken by fork, merge, comment, support, and report, which re-evaluate
  -- their visibility test once this transaction commits.
  if p_target_kind = 'publication' then
    select p.moderation_state into v_current
    from public.publications as p
    where p.id = v_t.publication_id
    for no key update;
  else
    perform 1 from public.publications as p where p.id = v_t.publication_id for share;
    select c.moderation_state into v_current
    from public.comments as c
    where c.id = p_target_id
    for no key update;
  end if;

  v_new := case p_action when 'hide' then 'hidden' else 'visible' end;
  if v_current = v_new then
    raise exception using errcode = 'FT409', message = 'moderation_state_unchanged';
  end if;

  if p_report_id is not null then
    select * into v_report from public.reports as r where r.id = p_report_id for update;
    if v_report.id is null
      or v_report.site_id <> v_t.site_id
      or v_report.target_kind <> p_target_kind
      or v_report.publication_id <> v_t.publication_id
      or v_report.comment_id is distinct from v_t.comment_id
    then
      raise exception using errcode = 'FT422', message = 'report_mismatch';
    end if;
    if v_report.state <> 'open' then
      raise exception using errcode = 'FT409', message = 'report_already_resolved';
    end if;
  end if;

  if p_target_kind = 'publication' then
    update public.publications set moderation_state = v_new where id = v_t.publication_id;
  else
    update public.comments set moderation_state = v_new where id = p_target_id;
  end if;

  insert into public.moderation_events (
    id, site_id, target_kind, publication_id, comment_id, action, reason, private_note, actor_id
  )
  values (
    v_event_id, v_t.site_id, p_target_kind, v_t.publication_id, v_t.comment_id,
    p_action, p_reason, p_private_note, actor
  );

  if p_report_id is not null then
    update public.reports
    set state = 'actioned', resolved_by = actor, resolved_at = pg_catalog.now(),
        resolution_event_id = v_event_id
    where id = p_report_id;
  end if;

  result := pg_catalog.jsonb_build_object(
    'eventId', v_event_id,
    'targetKind', p_target_kind,
    'targetId', p_target_id,
    'state', v_new
  );
  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'moderate_target', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.moderate_target(
  public.moderation_target_kind, uuid, public.moderation_action, text, text, uuid, text, text
) from public, anon;
grant execute on function public.moderate_target(
  public.moderation_target_kind, uuid, public.moderation_action, text, text, uuid, text, text
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
      and e.action in ('hide', 'restore');
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
