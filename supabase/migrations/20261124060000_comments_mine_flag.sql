-- list_public_comments gains `mine`: true only for comments written by the caller
-- (auth.uid()), always false for visitors. It reveals nothing about other authors and
-- lets the author's own comments offer "retract" without exposing account ids.

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
           coalesce(c.author_id = auth.uid(), false) as mine,
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
        'mine', page.mine,
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
