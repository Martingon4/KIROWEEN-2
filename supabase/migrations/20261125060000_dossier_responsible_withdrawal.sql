-- Review fix: a person who withdraws their authorization must be able to remove their name
-- even when the dossier is closed or its publication is hidden. Setting a name stays blocked.
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
  if p_responsible_name is not null then
    v_d := public.dossier_prepare(p_dossier_id, actor, false);
  else
    -- Withdrawal: same lock order (publication, then dossier), no state restrictions.
    select * into v_d from public.dossiers as d where d.id = p_dossier_id;
    if v_d.id is null or not public.is_site_coordinator(v_d.site_id, actor) then
      raise exception using errcode = 'P0002', message = 'dossier_not_found';
    end if;
    perform 1 from public.publications as p where p.id = v_d.publication_id for share;
    select * into v_d from public.dossiers as d where d.id = p_dossier_id for update;
  end if;
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
