-- Fork a visible publication into a new private branch (FT-03, plan §5.2.1).
-- The child copies the exact published snapshot, keeps feature IDs, and uses the
-- published revision as the primary parent of its first revision. The source is never
-- modified. Provenance is kept on the branch and cannot be rewritten (no UPDATE grant).

alter table public.branches
  add column source_publication_id uuid references public.publications (id) on delete restrict,
  add constraint branches_source_publication_has_revision check (
    source_publication_id is null or source_revision_id is not null
  );

create or replace function public.fork_publication(
  p_publication_id uuid,
  p_title text,
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
  source_publication uuid;
  source_revision uuid;
  source_site uuid;
  source_baseline uuid;
  new_branch_id uuid := pg_catalog.gen_random_uuid();
  new_revision_id uuid := pg_catalog.gen_random_uuid();
  copied integer;
  baseline_active boolean;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  -- Explicit null and whitespace checks: a blank title must be a 422, never a 500.
  if p_publication_id is null
    or p_title is null
    or p_idempotency_key is null
    or p_payload_hash is null
    or p_title <> pg_catalog.btrim(p_title)
    or char_length(p_title) not between 1 and 100
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_branch_request';
  end if;

  -- Same idempotency namespace as create_branch: one key creates at most one branch,
  -- whichever source it names.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':create_branch:' || p_idempotency_key, 0)
  );

  select *
  into previous
  from public.mutation_requests as request
  where request.actor_id = actor
    and request.operation = 'create_branch'
    and request.idempotency_key = p_idempotency_key;

  if found then
    if previous.payload_hash <> p_payload_hash then
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  -- FOR SHARE on the publication blocks a concurrent moderation hide until this
  -- transaction ends. A future hide must lock the publication row first.
  -- The source branch's soft-delete is irrelevant: a publication outlives it.
  select p.id, r.id, r.site_id, r.baseline_id
  into source_publication, source_revision, source_site, source_baseline
  from public.publications as p
  join public.revisions as r on r.id = p.revision_id
  join public.sites as s on s.id = r.site_id
  where p.id = p_publication_id
    and p.moderation_state = 'visible'
    and s.published
  for share of p;

  if source_publication is null then
    raise exception using errcode = 'P0002', message = 'publication_not_found';
  end if;

  insert into public.branches (
    id, site_id, baseline_id, owner_id, title, source_revision_id, source_publication_id
  )
  values (
    new_branch_id, source_site, source_baseline, actor, p_title, source_revision, source_publication
  );

  insert into public.revisions (
    id, branch_id, site_id, baseline_id, parent_revision_id, merge_parent_revision_id,
    message, author_id
  )
  values (
    new_revision_id, new_branch_id, source_site, source_baseline, source_revision, null,
    'Forked from publication', actor
  );

  -- Exact copy, not revalidated: rules may have tightened since the source was saved,
  -- and the fork must reproduce the published snapshot.
  insert into public.revision_features (revision_id, site_id, feature_id, kind, properties, geometry)
  select new_revision_id, f.site_id, f.feature_id, f.kind, f.properties, f.geometry
  from public.revision_features as f
  where f.revision_id = source_revision
  order by f.feature_id;
  get diagnostics copied = row_count;

  update public.branches
  set current_revision_id = new_revision_id
  where id = new_branch_id;

  select b.is_active into baseline_active
  from public.site_baselines as b
  where b.id = source_baseline;

  result := pg_catalog.jsonb_build_object(
    'branchId', new_branch_id,
    'revisionId', new_revision_id,
    'siteId', source_site,
    'baselineId', source_baseline,
    'baselineIsActive', coalesce(baseline_active, false),
    'title', p_title,
    'sourcePublicationId', source_publication,
    'featureCount', copied
  );

  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'create_branch', p_idempotency_key, p_payload_hash, result);

  return result;
end;
$$;

revoke all on function public.fork_publication(uuid, text, text, text) from public, anon;
grant execute on function public.fork_publication(uuid, text, text, text) to authenticated;

-- Branch head gains its publication provenance. The source is described only by its
-- publication id and current visibility, never by the parent revision's message or author.
create or replace function public.get_branch_head(p_branch_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'branchId', b.id,
    'title', b.title,
    'siteId', b.site_id,
    'baselineId', b.baseline_id,
    'revisionId', r.id,
    'parentRevisionId', r.parent_revision_id,
    'message', r.message,
    'createdAt', r.created_at,
    'sourcePublicationId', b.source_publication_id,
    'sourceVisible', case
      when b.source_publication_id is null then null
      else public.public_publication_exists(b.source_publication_id)
    end,
    'features', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', f.feature_id,
            'kind', f.kind,
            'properties', f.properties,
            'geometry', extensions.st_asgeojson(f.geometry, 6)::jsonb
          )
          order by f.feature_id
        )
        from public.revision_features as f
        where f.revision_id = r.id
      ),
      '[]'::jsonb
    )
  )
  from public.branches as b
  join public.revisions as r on r.id = b.current_revision_id
  where b.id = p_branch_id
    and b.owner_id = (select auth.uid())
    and not b.is_deleted;
$$;

revoke all on function public.get_branch_head(uuid) from public, anon;
grant execute on function public.get_branch_head(uuid) to authenticated;

-- Public reads and the fork share one visibility rule: visible publication on a
-- published site.
create or replace function public.public_publication_exists(p_publication_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.publications as p
    join public.revisions as r on r.id = p.revision_id
    join public.sites as s on s.id = r.site_id
    where p.id = p_publication_id
      and p.moderation_state = 'visible'
      and s.published
  );
$$;

revoke all on function public.public_publication_exists(uuid) from public;
grant execute on function public.public_publication_exists(uuid) to anon, authenticated;

create or replace function public.get_public_publication(p_publication_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'publicationId', p.id,
    'label', p.public_label,
    'summary', p.public_summary,
    'authorAlias', p.public_author_alias,
    'publishedAt', p.published_at,
    'siteId', r.site_id,
    'baselineId', r.baseline_id,
    'scenario', 'hypothetical',
    'features', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', f.feature_id,
            'kind', f.kind,
            'properties', f.properties,
            'geometry', extensions.st_asgeojson(f.geometry, 6)::jsonb
          )
          order by f.feature_id
        )
        from public.revision_features as f
        where f.revision_id = r.id
      ),
      '[]'::jsonb
    )
  )
  from public.publications as p
  join public.revisions as r on r.id = p.revision_id
  join public.sites as s on s.id = r.site_id
  where p.id = p_publication_id
    and p.moderation_state = 'visible'
    and s.published;
$$;

revoke all on function public.get_public_publication(uuid) from public;
grant execute on function public.get_public_publication(uuid) to anon, authenticated;
