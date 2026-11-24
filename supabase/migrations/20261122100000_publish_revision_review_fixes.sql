-- Review fixes for publish_revision (FT-06), same signature and behavior otherwise:
-- 1. The lock comment now states that FOR SHARE serializes with save_revision.
-- 2. A unique violation not caused by revision_id is re-raised instead of producing
--    RAISE with a null detail (which itself failed with an unrelated error).

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

  -- FOR SHARE conflicts with the FOR UPDATE taken by save_revision and by a soft-delete,
  -- so publishing serializes with both on this branch. Do not weaken it to FOR KEY SHARE:
  -- a concurrent soft-delete would then no longer be blocked.
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
    -- Any other unique violation is unexpected; re-raise it instead of a null detail.
    if existing_id is null then
      raise;
    end if;
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

