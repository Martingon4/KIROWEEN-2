-- Dossier write RPCs (FT-13, FT-14), spec 05 task 2.
-- Common order: validation, advisory lock and replay (mutation_requests), permission
-- (coordinator of the site derived from the target; a stranger, a coordinator of another
-- site, and a missing target are indistinguishable: P0002), then locks (publication
-- FOR SHARE, site, dossier FOR UPDATE), visibility, closed-state check, event append.
-- No rate limit: the role is assigned by the operator, every write is an audited event,
-- and the caps (20 milestones, 50 evidence items, 500 events) bound growth.

create or replace function public.is_site_coordinator(p_site_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.site_roles as sr
    where sr.site_id = p_site_id and sr.user_id = p_user_id and sr.role = 'coordinator'
  );
$$;

revoke all on function public.is_site_coordinator(uuid, uuid) from public, anon, authenticated;

-- Idempotency ledger helpers shared by the dossier RPCs.
create or replace function public.ledger_replay(
  p_actor uuid, p_operation text, p_key text, p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.mutation_requests%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor::text || ':' || p_operation || ':' || p_key, 0)
  );
  select * into previous
  from public.mutation_requests as request
  where request.actor_id = p_actor
    and request.operation = p_operation
    and request.idempotency_key = p_key;
  if found then
    if previous.payload_hash <> p_hash then
      raise exception using errcode = 'FT001', message = 'idempotency_key_reused';
    end if;
    return previous.response_json;
  end if;
  return null;
end;
$$;

revoke all on function public.ledger_replay(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.ledger_store(
  p_actor uuid, p_operation text, p_key text, p_hash text, p_result jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.mutation_requests (actor_id, operation, idempotency_key, payload_hash, response_json)
  values (p_actor, p_operation, p_key, p_hash, p_result);
$$;

revoke all on function public.ledger_store(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Resolves a dossier for a coordinator and locks it. Hidden publication: FT409 for the
-- coordinator (writes stop, history stays). Closed dossier: FT409 unless allowed.
create or replace function public.dossier_prepare(
  p_dossier_id uuid, p_actor uuid, p_allow_closed boolean
)
returns public.dossiers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.dossiers%rowtype;
  v_state public.publication_moderation_state;
  v_published boolean;
begin
  select * into v_d from public.dossiers as d where d.id = p_dossier_id;
  if v_d.id is null or not public.is_site_coordinator(v_d.site_id, p_actor) then
    raise exception using errcode = 'P0002', message = 'dossier_not_found';
  end if;

  select p.moderation_state, s.published into v_state, v_published
  from public.publications as p
  join public.revisions as r on r.id = p.revision_id
  join public.sites as s on s.id = r.site_id
  where p.id = v_d.publication_id
  for share of p, s;
  if v_state <> 'visible' or not v_published then
    raise exception using errcode = 'FT409', message = 'publication_hidden';
  end if;

  select * into v_d from public.dossiers as d where d.id = p_dossier_id for update;
  if not p_allow_closed and v_d.status in ('ejecutado', 'descartado') then
    raise exception using errcode = 'FT409', message = 'dossier_closed';
  end if;
  return v_d;
end;
$$;

revoke all on function public.dossier_prepare(uuid, uuid, boolean) from public, anon, authenticated;

-- Appends the next event and advances the dossier. The caller holds the dossier lock.
create or replace function public.dossier_append_event(
  p_dossier_id uuid,
  p_kind public.dossier_event_kind,
  p_previous public.dossier_status,
  p_new public.dossier_status,
  p_milestone_id uuid,
  p_evidence_id uuid,
  p_corrects uuid,
  p_note text,
  p_observation text,
  p_difference text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq integer;
  v_event uuid := pg_catalog.gen_random_uuid();
begin
  select d.last_event_seq + 1 into v_seq from public.dossiers as d where d.id = p_dossier_id;
  if v_seq > 500 then
    raise exception using errcode = 'FT422', message = 'event_limit_reached';
  end if;

  insert into public.dossier_events (
    id, dossier_id, seq, kind, previous_state, new_state, milestone_id, evidence_id,
    corrects_event_id, note, observation, difference, actor_id
  )
  values (
    v_event, p_dossier_id, v_seq, p_kind, p_previous, p_new, p_milestone_id, p_evidence_id,
    p_corrects, p_note, p_observation, p_difference, p_actor
  );

  update public.dossiers
  set last_event_seq = v_seq,
      updated_at = pg_catalog.now(),
      status = coalesce(p_new, status)
  where id = p_dossier_id;

  return v_event;
end;
$$;

revoke all on function public.dossier_append_event(
  uuid, public.dossier_event_kind, public.dossier_status, public.dossier_status,
  uuid, uuid, uuid, text, text, text, uuid
) from public, anon, authenticated;

create or replace function public.promote_dossier(
  p_publication_id uuid,
  p_decision_note text,
  p_responsible_name text,
  p_responsible_authorized boolean,
  p_target_date date,
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
  v_previous jsonb;
  v_site uuid;
  v_pub record;
  v_new uuid;
  v_dossier uuid := pg_catalog.gen_random_uuid();
  v_scenario text;
  v_created boolean;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_publication_id is null
    or p_decision_note is null
    or char_length(p_decision_note) not between 1 and 1000
    or not public.plain_text_ok(p_decision_note)
    or (p_responsible_name is not null and (
         char_length(p_responsible_name) not between 1 and 100
         or not public.plain_text_ok(p_responsible_name)
         or p_responsible_name ~ '@'
         or p_responsible_authorized is distinct from true))
    or (p_target_date is not null and p_target_date not between date '2000-01-01' and date '2100-01-01')
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_dossier_request';
  end if;

  v_previous := public.ledger_replay(actor, 'promote_dossier', p_idempotency_key, p_payload_hash);
  if v_previous is not null then
    return v_previous;
  end if;

  select r.site_id into v_site
  from public.publications as p
  join public.revisions as r on r.id = p.revision_id
  where p.id = p_publication_id;
  if v_site is null or not public.is_site_coordinator(v_site, actor) then
    raise exception using errcode = 'P0002', message = 'publication_not_found';
  end if;

  select * into v_pub from public.community_lock_publication(p_publication_id);
  if v_pub.publication_id is null then
    raise exception using errcode = 'P0002', message = 'publication_not_found';
  end if;

  select a.slug into v_scenario
  from public.analysis_scenarios as a
  where a.site_id = v_pub.site_id and a.is_default
  limit 1;

  -- A concurrent promotion with another key waits on the unique index, then loses.
  insert into public.dossiers (
    id, publication_id, revision_id, site_id, scenario_slug, decision_note,
    responsible_name, responsible_authorized, target_date, created_by
  )
  values (
    v_dossier, v_pub.publication_id, v_pub.revision_id, v_pub.site_id, v_scenario,
    p_decision_note, p_responsible_name, p_responsible_name is not null, p_target_date, actor
  )
  on conflict (publication_id) do nothing
  returning id into v_new;

  v_created := v_new is not null;
  if v_created then
    perform public.dossier_append_event(
      v_new, 'promoted', null, 'en_revision', null, null, null, null, null, null, actor
    );
  else
    select d.id into v_new from public.dossiers as d where d.publication_id = v_pub.publication_id;
  end if;

  result := pg_catalog.jsonb_build_object('dossierId', v_new, 'created', v_created);
  perform public.ledger_store(actor, 'promote_dossier', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.promote_dossier(uuid, text, text, boolean, date, text, text) from public, anon;
grant execute on function public.promote_dossier(uuid, text, text, boolean, date, text, text) to authenticated;

create or replace function public.set_dossier_responsible(
  p_dossier_id uuid,
  p_responsible_name text,
  p_responsible_authorized boolean,
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
  v_previous jsonb;
  v_d public.dossiers%rowtype;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_dossier_id is null
    or (p_responsible_name is not null and (
         char_length(p_responsible_name) not between 1 and 100
         or not public.plain_text_ok(p_responsible_name)
         or p_responsible_name ~ '@'
         or p_responsible_authorized is distinct from true))
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_dossier_request';
  end if;

  v_previous := public.ledger_replay(actor, 'set_dossier_responsible', p_idempotency_key, p_payload_hash);
  if v_previous is not null then
    return v_previous;
  end if;

  v_d := public.dossier_prepare(p_dossier_id, actor, false);

  update public.dossiers
  set responsible_name = p_responsible_name,
      responsible_authorized = p_responsible_name is not null
  where id = v_d.id;

  -- The event never copies the name: withdrawing it removes it from every public view.
  perform public.dossier_append_event(
    v_d.id, 'responsible_changed', null, null, null, null, null, null, null, null, actor
  );

  result := pg_catalog.jsonb_build_object(
    'dossierId', v_d.id, 'hasResponsible', p_responsible_name is not null);
  perform public.ledger_store(actor, 'set_dossier_responsible', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.set_dossier_responsible(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.set_dossier_responsible(uuid, text, boolean, text, text) to authenticated;

create or replace function public.add_milestone(
  p_dossier_id uuid,
  p_title text,
  p_target_date date,
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
  v_previous jsonb;
  v_d public.dossiers%rowtype;
  v_count integer;
  v_id uuid := pg_catalog.gen_random_uuid();
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_dossier_id is null
    or p_title is null
    or char_length(p_title) not between 1 and 100
    or not public.plain_text_ok(p_title)
    or p_target_date is null
    or p_target_date not between date '2000-01-01' and date '2100-01-01'
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_milestone_request';
  end if;

  v_previous := public.ledger_replay(actor, 'add_milestone', p_idempotency_key, p_payload_hash);
  if v_previous is not null then
    return v_previous;
  end if;

  v_d := public.dossier_prepare(p_dossier_id, actor, false);

  select pg_catalog.count(*)::integer into v_count
  from public.dossier_milestones as m where m.dossier_id = v_d.id;
  if v_count >= 20 then
    raise exception using errcode = 'FT422', message = 'too_many_milestones';
  end if;

  insert into public.dossier_milestones (id, dossier_id, position, title, target_date, created_by)
  values (v_id, v_d.id, v_count + 1, p_title, p_target_date, actor);

  perform public.dossier_append_event(
    v_d.id, 'milestone_added', null, null, v_id, null, null, null, null, null, actor
  );

  result := pg_catalog.jsonb_build_object('milestoneId', v_id, 'position', v_count + 1);
  perform public.ledger_store(actor, 'add_milestone', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.add_milestone(uuid, text, date, text, text) from public, anon;
grant execute on function public.add_milestone(uuid, text, date, text, text) to authenticated;

create or replace function public.update_milestone(
  p_milestone_id uuid,
  p_expected_status public.milestone_status,
  p_title text,
  p_target_date date,
  p_status public.milestone_status,
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
  v_previous jsonb;
  v_dossier uuid;
  v_d public.dossiers%rowtype;
  v_m public.dossier_milestones%rowtype;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_milestone_id is null
    or p_expected_status is null
    or p_status is null
    or p_title is null
    or char_length(p_title) not between 1 and 100
    or not public.plain_text_ok(p_title)
    or p_target_date is null
    or p_target_date not between date '2000-01-01' and date '2100-01-01'
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_milestone_request';
  end if;

  v_previous := public.ledger_replay(actor, 'update_milestone', p_idempotency_key, p_payload_hash);
  if v_previous is not null then
    return v_previous;
  end if;

  select m.dossier_id into v_dossier from public.dossier_milestones as m where m.id = p_milestone_id;
  if v_dossier is null then
    raise exception using errcode = 'P0002', message = 'milestone_not_found';
  end if;
  v_d := public.dossier_prepare(v_dossier, actor, false);

  select * into v_m from public.dossier_milestones as m where m.id = p_milestone_id for update;
  if v_m.status <> p_expected_status then
    raise exception using errcode = 'FT409', message = 'stale_milestone', detail = v_m.status::text;
  end if;
  if v_m.status = 'cancelado'
    or (p_status <> v_m.status and not (
         (v_m.status = 'pendiente' and p_status in ('cumplido', 'cancelado'))
         or (v_m.status = 'cumplido' and p_status = 'pendiente')))
  then
    raise exception using errcode = 'FT422', message = 'milestone_transition_not_allowed';
  end if;

  update public.dossier_milestones
  set title = p_title, target_date = p_target_date, status = p_status, updated_at = pg_catalog.now()
  where id = v_m.id;

  perform public.dossier_append_event(
    v_d.id, 'milestone_updated', null, null, v_m.id, null, null, null, null, null, actor
  );

  result := pg_catalog.jsonb_build_object('milestoneId', v_m.id, 'status', p_status);
  perform public.ledger_store(actor, 'update_milestone', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.update_milestone(
  uuid, public.milestone_status, text, date, public.milestone_status, text, text
) from public, anon;
grant execute on function public.update_milestone(
  uuid, public.milestone_status, text, date, public.milestone_status, text, text
) to authenticated;

create or replace function public.add_evidence(
  p_dossier_id uuid,
  p_url text,
  p_title text,
  p_description text,
  p_evidence_date date,
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
  v_previous jsonb;
  v_d public.dossiers%rowtype;
  v_count integer;
  v_today date;
  v_id uuid := pg_catalog.gen_random_uuid();
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_dossier_id is null
    or p_title is null
    or char_length(p_title) not between 1 and 100
    or not public.plain_text_ok(p_title)
    or p_description is null
    or char_length(p_description) not between 1 and 1000
    or not public.plain_text_ok(p_description)
    or p_evidence_date is null
    or p_evidence_date < date '2000-01-01'
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_evidence_request';
  end if;
  -- A dedicated code: the form needs to say what is wrong with the link.
  if p_url is null
    or char_length(p_url) > 2048
    or p_url !~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][^[:space:]<>"\\]*)?$'
  then
    raise exception using errcode = 'FT422', message = 'invalid_evidence_url';
  end if;

  v_previous := public.ledger_replay(actor, 'add_evidence', p_idempotency_key, p_payload_hash);
  if v_previous is not null then
    return v_previous;
  end if;

  v_d := public.dossier_prepare(p_dossier_id, actor, false);

  select pg_catalog.count(*)::integer into v_count
  from public.evidence_items as e where e.dossier_id = v_d.id;
  if v_count >= 50 then
    raise exception using errcode = 'FT422', message = 'too_many_evidence';
  end if;

  -- Compared with today's date in the site's own time zone, not the server's.
  select (pg_catalog.now() at time zone s.timezone)::date into v_today
  from public.sites as s where s.id = v_d.site_id;
  if p_evidence_date > v_today then
    raise exception using errcode = 'FT422', message = 'evidence_date_in_future';
  end if;

  insert into public.evidence_items (
    id, dossier_id, position, url, title, description, evidence_date, recorded_by
  )
  values (v_id, v_d.id, v_count + 1, p_url, p_title, p_description, p_evidence_date, actor);

  perform public.dossier_append_event(
    v_d.id, 'evidence_added', null, null, null, v_id, null, null, null, null, actor
  );

  result := pg_catalog.jsonb_build_object('evidenceId', v_id, 'position', v_count + 1);
  perform public.ledger_store(actor, 'add_evidence', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.add_evidence(uuid, text, text, text, date, text, text) from public, anon;
grant execute on function public.add_evidence(uuid, text, text, text, date, text, text) to authenticated;

-- Naturally idempotent: setting the state it already has changes nothing.
create or replace function public.set_evidence_verified(p_evidence_id uuid, p_verified boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_dossier uuid;
  v_d public.dossiers%rowtype;
  v_e public.evidence_items%rowtype;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_evidence_id is null or p_verified is null then
    raise exception using errcode = '22023', message = 'invalid_evidence_request';
  end if;

  select e.dossier_id into v_dossier from public.evidence_items as e where e.id = p_evidence_id;
  if v_dossier is null then
    raise exception using errcode = 'P0002', message = 'evidence_not_found';
  end if;
  v_d := public.dossier_prepare(v_dossier, actor, true);

  select * into v_e from public.evidence_items as e where e.id = p_evidence_id for update;
  if v_e.verified_by_team is distinct from p_verified then
    update public.evidence_items
    set verified_by_team = p_verified,
        verified_by = case when p_verified then actor end,
        verified_at = case when p_verified then pg_catalog.now() end
    where id = v_e.id;
    perform public.dossier_append_event(
      v_d.id, 'evidence_verified', null, null, null, v_e.id, null, null, null, null, actor
    );
  end if;

  return pg_catalog.jsonb_build_object('evidenceId', v_e.id, 'verified', p_verified);
end;
$$;

revoke all on function public.set_evidence_verified(uuid, boolean) from public, anon;
grant execute on function public.set_evidence_verified(uuid, boolean) to authenticated;

-- The requirement matrix of FT-14. Checks run in this order and every failure rolls
-- back the whole transaction.
create or replace function public.transition_dossier(
  p_dossier_id uuid,
  p_expected_state public.dossier_status,
  p_new_state public.dossier_status,
  p_note text,
  p_observation text,
  p_difference text,
  p_evidence_ids uuid[],
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
  v_previous jsonb;
  v_d public.dossiers%rowtype;
  v_ids uuid[];
  v_valid integer;
  v_start_event uuid;
  v_event uuid;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_dossier_id is null
    or p_expected_state is null
    or p_new_state is null
    or (p_note is not null and (char_length(p_note) not between 1 and 1000 or not public.plain_text_ok(p_note)))
    or (p_observation is not null and (char_length(p_observation) not between 1 and 1000 or not public.plain_text_ok(p_observation)))
    or (p_difference is not null and (char_length(p_difference) not between 1 and 1000 or not public.plain_text_ok(p_difference)))
    or (p_evidence_ids is not null and pg_catalog.cardinality(p_evidence_ids) > 50)
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_transition_request';
  end if;

  v_previous := public.ledger_replay(actor, 'transition_dossier', p_idempotency_key, p_payload_hash);
  if v_previous is not null then
    return v_previous;
  end if;

  v_d := public.dossier_prepare(p_dossier_id, actor, false);

  if v_d.status <> p_expected_state then
    raise exception using errcode = 'FT409', message = 'stale_state', detail = v_d.status::text;
  end if;
  if not public.dossier_transition_allowed(v_d.status, p_new_state) then
    raise exception using errcode = 'FT422', message = 'transition_not_allowed';
  end if;

  select coalesce(pg_catalog.array_agg(distinct x), array[]::uuid[]) into v_ids
  from pg_catalog.unnest(coalesce(p_evidence_ids, array[]::uuid[])) as t(x);
  select pg_catalog.count(*)::integer into v_valid
  from public.evidence_items as e
  where e.dossier_id = v_d.id and e.id = any (v_ids);
  if v_valid <> pg_catalog.cardinality(v_ids) then
    raise exception using errcode = 'FT422', message = 'invalid_evidence_reference';
  end if;

  if p_new_state = 'planeado' then
    if p_note is null then
      raise exception using errcode = 'FT422', message = 'note_required';
    end if;
    if v_d.responsible_name is null then
      raise exception using errcode = 'FT422', message = 'plan_requires_responsible';
    end if;
    if not exists (
      select 1 from public.dossier_milestones as m
      where m.dossier_id = v_d.id and m.status <> 'cancelado'
    ) then
      raise exception using errcode = 'FT422', message = 'plan_requires_milestone';
    end if;
  elsif p_new_state = 'en_ejecucion' then
    if p_note is null then
      raise exception using errcode = 'FT422', message = 'start_requires_note';
    end if;
    if pg_catalog.cardinality(v_ids) = 0 then
      raise exception using errcode = 'FT422', message = 'start_requires_evidence';
    end if;
  elsif p_new_state = 'ejecutado' then
    if p_observation is null or p_difference is null then
      raise exception using errcode = 'FT422', message = 'execute_requires_observation';
    end if;
    if p_note is null then
      raise exception using errcode = 'FT422', message = 'note_required';
    end if;
    -- Evidence cited when execution started proves the start, not the completion.
    select e.id into v_start_event
    from public.dossier_events as e
    where e.dossier_id = v_d.id and e.kind = 'status_change' and e.new_state = 'en_ejecucion'
    order by e.seq desc
    limit 1;
    if not exists (
      select 1
      from pg_catalog.unnest(v_ids) as t(x)
      where not exists (
        select 1 from public.dossier_event_evidence as ee
        where ee.event_id = v_start_event and ee.evidence_id = t.x
      )
    ) then
      raise exception using errcode = 'FT422', message = 'execute_requires_evidence';
    end if;
  elsif p_new_state = 'descartado' then
    if p_note is null then
      raise exception using errcode = 'FT422', message = 'discard_requires_reason';
    end if;
  end if;

  v_event := public.dossier_append_event(
    v_d.id, 'status_change', v_d.status, p_new_state, null, null, null,
    p_note, p_observation, p_difference, actor
  );

  insert into public.dossier_event_evidence (event_id, evidence_id, dossier_id)
  select v_event, x, v_d.id from pg_catalog.unnest(v_ids) as t(x);

  result := pg_catalog.jsonb_build_object('eventId', v_event, 'status', p_new_state);
  perform public.ledger_store(actor, 'transition_dossier', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.transition_dossier(
  uuid, public.dossier_status, public.dossier_status, text, text, text, uuid[], text, text
) from public, anon;
grant execute on function public.transition_dossier(
  uuid, public.dossier_status, public.dossier_status, text, text, text, uuid[], text, text
) to authenticated;

-- The only correction: undo the last status change with an additional event that names
-- it. History is never edited, so a wrong closure stays visible in the timeline.
create or replace function public.revert_last_status_change(
  p_dossier_id uuid,
  p_expected_state public.dossier_status,
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
  v_previous jsonb;
  v_d public.dossiers%rowtype;
  v_last public.dossier_events%rowtype;
  v_event uuid;
  result jsonb;
begin
  if actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_dossier_id is null
    or p_expected_state is null
    or p_note is null
    or char_length(p_note) not between 1 and 1000
    or not public.plain_text_ok(p_note)
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_correction_request';
  end if;

  v_previous := public.ledger_replay(actor, 'revert_last_status_change', p_idempotency_key, p_payload_hash);
  if v_previous is not null then
    return v_previous;
  end if;

  v_d := public.dossier_prepare(p_dossier_id, actor, true);
  if v_d.status <> p_expected_state then
    raise exception using errcode = 'FT409', message = 'stale_state', detail = v_d.status::text;
  end if;

  select * into v_last
  from public.dossier_events as e
  where e.dossier_id = v_d.id and e.kind = 'status_change'
  order by e.seq desc
  limit 1;

  if v_last.id is null
    or v_last.new_state <> v_d.status
    or exists (
      select 1 from public.dossier_events as c
      where c.dossier_id = v_d.id and c.kind = 'correction' and c.corrects_event_id = v_last.id
    )
  then
    raise exception using errcode = 'FT422', message = 'correction_not_allowed';
  end if;

  v_event := public.dossier_append_event(
    v_d.id, 'correction', v_d.status, v_last.previous_state, null, null, v_last.id,
    p_note, null, null, actor
  );

  result := pg_catalog.jsonb_build_object('eventId', v_event, 'status', v_last.previous_state);
  perform public.ledger_store(actor, 'revert_last_status_change', p_idempotency_key, p_payload_hash, result);
  return result;
end;
$$;

revoke all on function public.revert_last_status_change(uuid, public.dossier_status, text, text, text)
  from public, anon;
grant execute on function public.revert_last_status_change(uuid, public.dossier_status, text, text, text)
  to authenticated;
