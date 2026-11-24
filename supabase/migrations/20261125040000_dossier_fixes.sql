-- Review fixes for the dossier RPCs (spec 05), found by the tester agent:
-- add_evidence validated the link before the replay and permission checks, so a user
-- without the coordinator role got a validation error instead of the uniform 404. The
-- link check now runs after permission, visibility, and the closed-state check.

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
    or p_url is null
    or p_evidence_date is null
    or p_evidence_date < date '2000-01-01'
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_evidence_request';
  end if;

  v_previous := public.ledger_replay(actor, 'add_evidence', p_idempotency_key, p_payload_hash);
  if v_previous is not null then
    return v_previous;
  end if;

  v_d := public.dossier_prepare(p_dossier_id, actor, false);

  -- Checked after permission and visibility, like every other validation that depends on
  -- the caller being allowed to act: a stranger learns nothing from the error code.
  -- A dedicated code: the form needs to say what is wrong with the link.
  if p_url is null
    or char_length(p_url) > 2048
    or p_url !~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][^[:space:]<>"\\]*)?$'
  then
    raise exception using errcode = 'FT422', message = 'invalid_evidence_url';
  end if;

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
