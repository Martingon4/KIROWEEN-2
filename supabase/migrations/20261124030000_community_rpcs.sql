-- Comment, support, report, and public community reads (FT-09, FT-10), spec 04 task 3.
-- Mutation order in every function: auth and input, advisory lock on the key, replay,
-- row locks (publication, then comment), visibility, deduplication, rate limit, write,
-- ledger. The visibility rule is the one used by every public read: the publication is
-- visible and its site is published.

-- Internal: locks and returns the visible publication of an id.
create or replace function public.community_lock_publication(p_publication_id uuid)
returns table (publication_id uuid, revision_id uuid, site_id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  select p.id, r.id, r.site_id
  from public.publications as p
  join public.revisions as r on r.id = p.revision_id
  join public.sites as s on s.id = r.site_id
  where p.id = p_publication_id
    and p.moderation_state = 'visible'
    and s.published
  for share of p, s;
$$;

revoke all on function public.community_lock_publication(uuid) from public, anon, authenticated;

create or replace function public.create_comment(
  p_publication_id uuid,
  p_feature_id uuid,
  p_body text,
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
  v_pub record;
  v_comment_id uuid := pg_catalog.gen_random_uuid();
  v_created timestamptz;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_publication_id is null
    or p_body is null
    or char_length(p_body) not between 1 and 1000
    or not public.plain_text_ok(p_body)
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_comment_request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':create_comment:' || p_idempotency_key, 0)
  );
  select * into previous
  from public.mutation_requests as request
  where request.actor_id = actor
    and request.operation = 'create_comment'
    and request.idempotency_key = p_idempotency_key;
  if found then
    if previous.payload_hash <> p_payload_hash then
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  -- FOR SHARE on the publication blocks a concurrent moderation hide until we commit.
  select * into v_pub from public.community_lock_publication(p_publication_id);
  if v_pub.publication_id is null then
    raise exception using errcode = 'P0002', message = 'publication_not_found';
  end if;

  if p_feature_id is not null and not exists (
    select 1 from public.revision_features as f
    where f.revision_id = v_pub.revision_id and f.feature_id = p_feature_id
  ) then
    raise exception using errcode = 'FT422', message = 'invalid_anchor';
  end if;

  perform public.rate_limit_consume(actor, 'comment', pg_catalog.now());

  insert into public.comments (id, publication_id, revision_id, feature_id, author_id, body)
  values (v_comment_id, v_pub.publication_id, v_pub.revision_id, p_feature_id, actor, p_body)
  returning created_at into v_created;

  -- The ledger stores identifiers only, never the comment text.
  result := pg_catalog.jsonb_build_object(
    'commentId', v_comment_id,
    'publicationId', v_pub.publication_id,
    'featureId', p_feature_id,
    'createdAt', v_created
  );
  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'create_comment', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.create_comment(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.create_comment(uuid, uuid, text, text, text) to authenticated;

-- Retracting is naturally idempotent: the first call sets the time, later calls return it.
create or replace function public.retract_comment(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_comment public.comments%rowtype;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_comment_id is null then
    raise exception using errcode = '22023', message = 'invalid_comment_request';
  end if;

  select * into v_comment
  from public.comments as c
  where c.id = p_comment_id and c.author_id = actor
  for no key update;

  -- Missing and someone else's comment are indistinguishable.
  if v_comment.id is null then
    raise exception using errcode = 'P0002', message = 'comment_not_found';
  end if;

  if v_comment.retracted_at is null then
    update public.comments
    set retracted_at = pg_catalog.now()
    where id = v_comment.id
    returning retracted_at into v_comment.retracted_at;
  end if;

  return pg_catalog.jsonb_build_object(
    'commentId', v_comment.id,
    'retractedAt', v_comment.retracted_at
  );
end;
$$;

revoke all on function public.retract_comment(uuid) from public, anon;
grant execute on function public.retract_comment(uuid) to authenticated;

-- Support is current state. A repeated PUT or DELETE changes nothing and costs nothing.
create or replace function public.set_support(p_publication_id uuid, p_supported boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_pub record;
  v_changed integer;
  v_count integer;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_publication_id is null or p_supported is null then
    raise exception using errcode = '22023', message = 'invalid_support_request';
  end if;

  select * into v_pub from public.community_lock_publication(p_publication_id);
  if v_pub.publication_id is null then
    raise exception using errcode = 'P0002', message = 'publication_not_found';
  end if;

  if p_supported then
    insert into public.supports (publication_id, user_id)
    values (v_pub.publication_id, actor)
    on conflict (publication_id, user_id) do nothing;
  else
    delete from public.supports
    where publication_id = v_pub.publication_id and user_id = actor;
  end if;
  get diagnostics v_changed = row_count;

  -- A raise here rolls the change back, so a limited request leaves no trace.
  if v_changed > 0 then
    perform public.rate_limit_consume(actor, 'support', pg_catalog.now());
  end if;

  select pg_catalog.count(*)::integer into v_count
  from public.supports as s
  where s.publication_id = v_pub.publication_id;

  return pg_catalog.jsonb_build_object('supported', p_supported, 'count', v_count);
end;
$$;

revoke all on function public.set_support(uuid, boolean) from public, anon;
grant execute on function public.set_support(uuid, boolean) to authenticated;

create or replace function public.my_support_state(p_publication_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select 1
    from public.publications as p
    join public.revisions as r on r.id = p.revision_id
    join public.sites as s on s.id = r.site_id
    where p.id = p_publication_id and p.moderation_state = 'visible' and s.published
  ) then
    return null;
  end if;
  return exists (
    select 1 from public.supports as sp
    where sp.publication_id = p_publication_id and sp.user_id = actor
  );
end;
$$;

revoke all on function public.my_support_state(uuid) from public, anon;
grant execute on function public.my_support_state(uuid) to authenticated;

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

-- The author's own comments that moderation hid or that they retracted, with the
-- public moderation reason. Never includes reports or private notes.
create or replace function public.list_my_moderation_notices(p_publication_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select 1
    from public.publications as p
    join public.revisions as r on r.id = p.revision_id
    join public.sites as s on s.id = r.site_id
    where p.id = p_publication_id and p.moderation_state = 'visible' and s.published
  ) then
    return null;
  end if;

  return pg_catalog.jsonb_build_object('items', coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'commentId', c.id,
        'body', c.body,
        'state', case when c.moderation_state = 'hidden' then 'hidden' else 'retracted' end,
        'reason', (
          select e.reason
          from public.moderation_events as e
          where e.comment_id = c.id and e.action = 'hide'
          order by e.created_at desc, e.id desc
          limit 1
        ),
        'createdAt', c.created_at
      )
      order by c.created_at, c.id
    )
    from public.comments as c
    where c.publication_id = p_publication_id
      and c.author_id = actor
      and (c.moderation_state = 'hidden' or c.retracted_at is not null)
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.list_my_moderation_notices(uuid) from public, anon;
grant execute on function public.list_my_moderation_notices(uuid) to authenticated;

-- Public comment list: visible, not retracted, flat, keyset-paginated (created_at, id).
-- Returns null for a publication that is not publicly visible. Never returns account
-- ids or emails; the alias is read live.
create or replace function public.list_public_comments(
  p_publication_id uuid,
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
  v_items jsonb;
  v_next jsonb;
  v_total integer;
begin
  if p_limit is null or p_limit not between 1 and 50
    or (p_after_created_at is null) <> (p_after_id is null)
  then
    raise exception using errcode = '22023', message = 'invalid_page_request';
  end if;

  if not exists (
    select 1
    from public.publications as p
    join public.revisions as r on r.id = p.revision_id
    join public.sites as s on s.id = r.site_id
    where p.id = p_publication_id and p.moderation_state = 'visible' and s.published
  ) then
    return null;
  end if;

  with page as (
    select c.id, c.body, c.created_at, c.feature_id,
           coalesce(pr.public_alias, 'participant') as alias,
           f.properties ->> 'label' as anchor_label,
           pg_catalog.row_number() over (order by c.created_at, c.id) as rn
    from public.comments as c
    left join public.profiles as pr on pr.id = c.author_id
    left join public.revision_features as f
      on f.revision_id = c.revision_id and f.feature_id = c.feature_id
    where c.publication_id = p_publication_id
      and c.moderation_state = 'visible'
      and c.retracted_at is null
      and (p_after_created_at is null or (c.created_at, c.id) > (p_after_created_at, p_after_id))
    order by c.created_at, c.id
    limit p_limit + 1
  )
  select
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'commentId', page.id,
        'body', page.body,
        'authorAlias', page.alias,
        'createdAt', page.created_at,
        'anchor', case when page.feature_id is null then null
                       else pg_catalog.jsonb_build_object('featureId', page.feature_id, 'label', page.anchor_label) end
      ) order by page.rn) filter (where page.rn <= p_limit), '[]'::jsonb),
    (select pg_catalog.jsonb_build_object('createdAt', n.created_at, 'id', n.id)
     from page as n where n.rn = p_limit and (select pg_catalog.count(*) from page) > p_limit),
    pg_catalog.count(*)::integer
  into v_items, v_next, v_total
  from page;

  return pg_catalog.jsonb_build_object('items', v_items, 'nextCursor', v_next);
end;
$$;

revoke all on function public.list_public_comments(uuid, timestamptz, uuid, integer) from public;
grant execute on function public.list_public_comments(uuid, timestamptz, uuid, integer) to anon, authenticated;

-- Counts for display only; they never trigger any state change anywhere.
create or replace function public.get_public_community_summary(p_publication_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.publications as p
    join public.revisions as r on r.id = p.revision_id
    join public.sites as s on s.id = r.site_id
    where p.id = p_publication_id and p.moderation_state = 'visible' and s.published
  ) then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'supportCount', (select pg_catalog.count(*) from public.supports as sp where sp.publication_id = p_publication_id),
    'commentCount', (
      select pg_catalog.count(*) from public.comments as c
      where c.publication_id = p_publication_id
        and c.moderation_state = 'visible' and c.retracted_at is null
    )
  );
end;
$$;

revoke all on function public.get_public_community_summary(uuid) from public;
grant execute on function public.get_public_community_summary(uuid) to anon, authenticated;
