-- Dossier reads (FT-13, FT-15), spec 05 task 3. Public reads follow the one visibility
-- rule used everywhere: the publication is visible and its site is published. A hidden
-- publication hides its dossier, its list entry, and (through the export route, which is
-- built on get_public_dossier) its downloads. Restoring the publication brings back the
-- dossier unchanged: events are never touched.

-- Milestones, evidence, and the event timeline of a dossier. Aliases are read live and
-- no account id ever leaves this function.
create or replace function public.dossier_parts(p_dossier_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'milestones', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', m.id, 'position', m.position, 'title', m.title,
          'targetDate', m.target_date, 'status', m.status
        ) order by m.position)
      from public.dossier_milestones as m
      where m.dossier_id = p_dossier_id
    ), '[]'::jsonb),
    'evidence', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', e.id, 'position', e.position, 'url', e.url, 'host', e.host,
          'title', e.title, 'description', e.description,
          'evidenceDate', e.evidence_date,
          'recordedByAlias', coalesce(rp.public_alias, 'participant'),
          'verifiedByTeam', e.verified_by_team,
          'verifiedByAlias', vp.public_alias,
          'verifiedAt', e.verified_at
        ) order by e.position)
      from public.evidence_items as e
      left join public.profiles as rp on rp.id = e.recorded_by
      left join public.profiles as vp on vp.id = e.verified_by
      where e.dossier_id = p_dossier_id
    ), '[]'::jsonb),
    'events', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'seq', ev.seq, 'kind', ev.kind,
          'previousState', ev.previous_state, 'newState', ev.new_state,
          'note', ev.note, 'observation', ev.observation, 'difference', ev.difference,
          'actorAlias', coalesce(ap.public_alias, 'participant'),
          'createdAt', ev.created_at,
          'milestoneId', ev.milestone_id,
          'evidenceId', ev.evidence_id,
          'evidenceIds', coalesce((
            select pg_catalog.jsonb_agg(ee.evidence_id order by ee.evidence_id)
            from public.dossier_event_evidence as ee where ee.event_id = ev.id
          ), '[]'::jsonb),
          'correctsSeq', (select c.seq from public.dossier_events as c where c.id = ev.corrects_event_id)
        ) order by ev.seq)
      from public.dossier_events as ev
      left join public.profiles as ap on ap.id = ev.actor_id
      where ev.dossier_id = p_dossier_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.dossier_parts(uuid) from public, anon, authenticated;

create or replace function public.public_dossier_exists(p_dossier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.dossiers as d
    join public.publications as p on p.id = d.publication_id
    join public.sites as s on s.id = d.site_id
    where d.id = p_dossier_id
      and p.moderation_state = 'visible'
      and s.published
  );
$$;

revoke all on function public.public_dossier_exists(uuid) from public;
grant execute on function public.public_dossier_exists(uuid) to anon, authenticated;

create or replace function public.get_public_dossier(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_d public.dossiers%rowtype;
  v_slug text;
  v_baseline uuid;
  v_publication jsonb;
  v_snapshot jsonb;
  v_comparison jsonb;
begin
  select d.* into v_d
  from public.dossiers as d
  join public.publications as p on p.id = d.publication_id
  join public.sites as s on s.id = d.site_id
  where d.id = p_dossier_id
    and p.moderation_state = 'visible'
    and s.published;
  if v_d.id is null then
    return null;
  end if;

  select s.slug, r.baseline_id into v_slug, v_baseline
  from public.sites as s
  join public.revisions as r on r.id = v_d.revision_id
  where s.id = v_d.site_id;

  v_publication := public.get_public_publication(v_d.publication_id);
  v_snapshot := public.get_snapshot_analysis('publication:' || v_d.publication_id, v_d.scenario_slug);
  v_comparison := public.compare_revisions(
    'baseline:' || v_baseline, 'publication:' || v_d.publication_id, v_d.scenario_slug
  );

  return pg_catalog.jsonb_build_object(
    'dossierId', v_d.id,
    'publicationId', v_d.publication_id,
    'siteId', v_d.site_id,
    'siteSlug', v_slug,
    'status', v_d.status,
    'decisionNote', v_d.decision_note,
    -- Published only when the person authorized it; otherwise the page says so.
    'responsibleName', case when v_d.responsible_authorized then v_d.responsible_name end,
    'targetDate', v_d.target_date,
    'createdAt', v_d.created_at,
    'updatedAt', v_d.updated_at,
    'publication', v_publication,
    'snapshot', v_snapshot,
    'comparison', pg_catalog.jsonb_build_object(
      'counts', v_comparison -> 'counts',
      'metricDeltas', v_comparison -> 'metricDeltas',
      'catalogCompatible', v_comparison -> 'catalogCompatible',
      'costDelta', v_comparison -> 'costDelta'
    ),
    -- Context only: nothing in the system reads this count to decide anything.
    'supportCount', (select pg_catalog.count(*) from public.supports as sp where sp.publication_id = v_d.publication_id)
  ) || public.dossier_parts(v_d.id);
end;
$$;

revoke all on function public.get_public_dossier(uuid) from public;
grant execute on function public.get_public_dossier(uuid) to anon, authenticated;

-- Used by the publication page: is there a dossier, and may this caller manage it?
create or replace function public.get_publication_dossier(p_publication_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site uuid;
  v_dossier uuid;
begin
  select r.site_id into v_site
  from public.publications as p
  join public.revisions as r on r.id = p.revision_id
  join public.sites as s on s.id = r.site_id
  where p.id = p_publication_id and p.moderation_state = 'visible' and s.published;
  if v_site is null then
    return null;
  end if;

  select d.id into v_dossier from public.dossiers as d where d.publication_id = p_publication_id;
  return pg_catalog.jsonb_build_object(
    'dossierId', v_dossier,
    'canManage', coalesce(auth.uid() is not null and public.is_site_coordinator(v_site, auth.uid()), false)
  );
end;
$$;

revoke all on function public.get_publication_dossier(uuid) from public;
grant execute on function public.get_publication_dossier(uuid) to anon, authenticated;

-- Coordinators manage a dossier even while its publication is hidden (writes stay
-- blocked), so this read does not apply the public visibility rule.
create or replace function public.get_managed_dossier(p_dossier_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_d public.dossiers%rowtype;
  v_state public.publication_moderation_state;
  v_label text;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  select * into v_d from public.dossiers as d where d.id = p_dossier_id;
  if v_d.id is null or not public.is_site_coordinator(v_d.site_id, actor) then
    raise exception using errcode = 'P0002', message = 'dossier_not_found';
  end if;
  select p.moderation_state, p.public_label into v_state, v_label
  from public.publications as p where p.id = v_d.publication_id;

  return pg_catalog.jsonb_build_object(
    'dossierId', v_d.id,
    'publicationId', v_d.publication_id,
    'siteId', v_d.site_id,
    'status', v_d.status,
    'moderationState', v_state,
    'label', v_label,
    'decisionNote', v_d.decision_note,
    'responsibleName', v_d.responsible_name,
    'targetDate', v_d.target_date,
    'updatedAt', v_d.updated_at
  ) || public.dossier_parts(v_d.id);
end;
$$;

revoke all on function public.get_managed_dossier(uuid) from public, anon;
grant execute on function public.get_managed_dossier(uuid) to authenticated;

create or replace function public.list_public_dossiers(
  p_site_id uuid,
  p_after_updated_at timestamptz default null,
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
begin
  if p_limit is null or p_limit not between 1 and 50
    or (p_after_updated_at is null) <> (p_after_id is null)
  then
    raise exception using errcode = '22023', message = 'invalid_page_request';
  end if;

  with page as (
    select d.id, d.status, d.updated_at, p.public_label, p.id as publication_id,
           pg_catalog.row_number() over (order by d.updated_at desc, d.id desc) as rn
    from public.dossiers as d
    join public.publications as p on p.id = d.publication_id
    join public.sites as s on s.id = d.site_id
    where d.site_id = p_site_id
      and p.moderation_state = 'visible'
      and s.published
      and (p_after_updated_at is null or (d.updated_at, d.id) < (p_after_updated_at, p_after_id))
    order by d.updated_at desc, d.id desc
    limit p_limit + 1
  )
  select
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'dossierId', page.id,
        'publicationId', page.publication_id,
        'label', page.public_label,
        'status', page.status,
        'updatedAt', page.updated_at
      ) order by page.rn) filter (where page.rn <= p_limit), '[]'::jsonb),
    (select pg_catalog.jsonb_build_object('updatedAt', n.updated_at, 'id', n.id)
     from page as n where n.rn = p_limit and (select pg_catalog.count(*) from page) > p_limit)
  into v_items, v_next
  from page;

  return pg_catalog.jsonb_build_object('items', v_items, 'nextCursor', v_next);
end;
$$;

revoke all on function public.list_public_dossiers(uuid, timestamptz, uuid, integer) from public;
grant execute on function public.list_public_dossiers(uuid, timestamptz, uuid, integer) to anon, authenticated;
