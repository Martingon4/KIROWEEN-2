-- Moderators need to find content they already hid in order to restore it: a resolved
-- report leaves the open queue, so the queue alone cannot offer "restore" (FT-10).
-- Returns the site's currently hidden publications and comments, most recently hidden
-- first, with the public reason of the last hide event. Moderators of that site only.

create or replace function public.list_hidden_content(p_site_id uuid, p_limit integer default 50)
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
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = '22023', message = 'invalid_page_request';
  end if;
  if p_site_id is null or not public.is_site_moderator(p_site_id, actor) then
    raise exception using errcode = 'P0002', message = 'site_not_found';
  end if;

  return pg_catalog.jsonb_build_object('items', coalesce((
    select pg_catalog.jsonb_agg(item.doc order by item.hidden_at desc, item.target_id)
    from (
      select e.created_at as hidden_at,
             p.id as target_id,
             pg_catalog.jsonb_build_object(
               'targetKind', 'publication',
               'targetId', p.id,
               'publicationId', p.id,
               'commentId', null,
               'preview', p.public_label,
               'reason', e.reason,
               'hiddenAt', e.created_at
             ) as doc
      from public.publications as p
      join public.revisions as r on r.id = p.revision_id
      join lateral (
        select ev.reason, ev.created_at
        from public.moderation_events as ev
        where ev.publication_id = p.id and ev.comment_id is null and ev.action = 'hide'
        order by ev.created_at desc, ev.id desc
        limit 1
      ) as e on true
      where r.site_id = p_site_id and p.moderation_state = 'hidden'
      union all
      select e.created_at,
             c.id,
             pg_catalog.jsonb_build_object(
               'targetKind', 'comment',
               'targetId', c.id,
               'publicationId', c.publication_id,
               'commentId', c.id,
               'preview', pg_catalog.left(c.body, 140),
               'reason', e.reason,
               'hiddenAt', e.created_at
             )
      from public.comments as c
      join public.publications as p on p.id = c.publication_id
      join public.revisions as r on r.id = p.revision_id
      join lateral (
        select ev.reason, ev.created_at
        from public.moderation_events as ev
        where ev.comment_id = c.id and ev.action = 'hide'
        order by ev.created_at desc, ev.id desc
        limit 1
      ) as e on true
      where r.site_id = p_site_id and c.moderation_state = 'hidden'
      order by 1 desc
      limit p_limit
    ) as item
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.list_hidden_content(uuid, integer) from public, anon;
grant execute on function public.list_hidden_content(uuid, integer) to authenticated;
