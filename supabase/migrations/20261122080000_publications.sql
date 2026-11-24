-- Explicit, immutable publication of a saved revision (FT-06).
-- A publication fixes its public label, summary, and author alias at publish time.
-- It is independent of later private saves and of branch soft-deletion; withdrawal
-- will be an explicit moderation action, not a side effect.

-- Guarantee that a publication's branch is the branch of its revision.
alter table public.revisions
  add constraint revisions_id_branch_unique unique (id, branch_id);

-- No publication function existed before this migration, so the table is empty.
alter table public.publications
  add column public_author_alias text not null
    check (char_length(public_author_alias) between 3 and 40),
  add constraint publications_revision_branch_fk
    foreign key (revision_id, branch_id)
    references public.revisions (id, branch_id)
    on delete restrict;

create or replace function public.prevent_publication_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only the moderation state may change; every published field stays fixed.
  if tg_op = 'UPDATE'
    and (
      old.id, old.revision_id, old.branch_id, old.public_label, old.public_summary,
      old.public_author_alias, old.published_by, old.published_at
    ) is not distinct from (
      new.id, new.revision_id, new.branch_id, new.public_label, new.public_summary,
      new.public_author_alias, new.published_by, new.published_at
    )
  then
    return new;
  end if;

  raise exception using errcode = '55000', message = 'immutable_publication';
end;
$$;

revoke all on function public.prevent_publication_change() from public, anon, authenticated;

create trigger publications_are_immutable
  before update or delete on public.publications
  for each row execute function public.prevent_publication_change();

create trigger publications_cannot_be_truncated
  before truncate on public.publications
  for each statement execute function public.prevent_publication_change();

create or replace function public.publish_revision(
  p_revision_id uuid,
  p_label text,
  p_summary text,
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
  target_branch_id uuid;
  author_alias text;
  existing_id uuid;
  publication_id uuid := pg_catalog.gen_random_uuid();
  published timestamptz;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;

  -- Explicit null checks: char_length(null) would make every range test null.
  if p_revision_id is null
    or p_label is null
    or p_summary is null
    or p_idempotency_key is null
    or p_payload_hash is null
    or p_label <> pg_catalog.btrim(p_label)
    or char_length(p_label) not between 1 and 100
    or p_summary <> pg_catalog.btrim(p_summary)
    or char_length(p_summary) not between 1 and 1000
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_publication_request';
  end if;

  -- Lock order shared with create_branch and save_revision: key first, then the branch row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':publish_revision:' || p_idempotency_key, 0)
  );

  select *
  into previous
  from public.mutation_requests as request
  where request.actor_id = actor
    and request.operation = 'publish_revision'
    and request.idempotency_key = p_idempotency_key;

  if found then
    if previous.payload_hash <> p_payload_hash then
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;

  -- FOR SHARE blocks a concurrent soft-delete without blocking save_revision.
  select b.id
  into target_branch_id
  from public.revisions as r
  join public.branches as b on b.id = r.branch_id
  where r.id = p_revision_id
    and b.owner_id = actor
    and not b.is_deleted
  for share of b;

  -- Missing, deleted, and another participant's revision are indistinguishable.
  if target_branch_id is null then
    raise exception using errcode = 'P0002', message = 'revision_not_found';
  end if;

  select p.id into existing_id
  from public.publications as p
  where p.revision_id = p_revision_id;

  if existing_id is not null then
    raise exception using errcode = 'FT409', message = 'already_published', detail = existing_id::text;
  end if;

  if not exists (
    select 1 from public.revision_features as f where f.revision_id = p_revision_id
  ) then
    raise exception using errcode = 'FT422', message = 'empty_revision';
  end if;

  select pr.public_alias into author_alias
  from public.profiles as pr
  where pr.id = actor;

  if author_alias is null then
    raise exception using errcode = '22023', message = 'missing_profile';
  end if;

  begin
    insert into public.publications (
      id, revision_id, branch_id, public_label, public_summary, public_author_alias, published_by
    )
    values (
      publication_id, p_revision_id, target_branch_id, p_label, p_summary, author_alias, actor
    )
    returning published_at into published;
  exception when unique_violation then
    -- Two different keys raced for the same revision; report the winner, never a 500.
    select p.id into existing_id
    from public.publications as p
    where p.revision_id = p_revision_id;
    raise exception using errcode = 'FT409', message = 'already_published', detail = existing_id::text;
  end;

  result := pg_catalog.jsonb_build_object(
    'publicationId', publication_id,
    'revisionId', p_revision_id,
    'branchId', target_branch_id,
    'publishedAt', published
  );

  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (actor, 'publish_revision', p_idempotency_key, p_payload_hash, result);

  return result;
end;
$$;

revoke all on function public.publish_revision(uuid, text, text, text, text) from public, anon;
grant execute on function public.publish_revision(uuid, text, text, text, text) to authenticated;

-- The only public path to a published snapshot. Hidden and missing publications both
-- return null. It never returns branch ids, parent ids, revision messages, account ids,
-- or email addresses.
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
  where p.id = p_publication_id
    and p.moderation_state = 'visible';
$$;

revoke all on function public.get_public_publication(uuid) from public;
grant execute on function public.get_public_publication(uuid) to anon, authenticated;
