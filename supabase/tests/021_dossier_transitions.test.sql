begin;

select plan(116);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction). They run as the calling role
-- unless declared SECURITY DEFINER (read-only fingerprints of the locked-down tables).
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
create function public.t_doc(p text) returns jsonb language sql stable as $$ select doc from ctx where name = p $$;
-- Last 8 hex characters are unique per user: the generated profile alias uses them.
create function public.t_uid(p text) returns text language sql immutable as
$$ select '99021000-0000-4000-8000-0000' || lpad(p, 8, '0') $$;
create function public.t_as(p text) returns text language sql as
$$ select set_config('request.jwt.claim.sub', case when p = 'none' then '' else public.t_uid(p) end, true) $$;
-- Runs a statement returning one value: the value as text, or sqlstate|message|detail.
create function public.t_call(p_sql text) returns text language plpgsql as $$
declare
  r text;
  m text;
  d text;
begin
  execute p_sql into r;
  return r;
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return sqlstate || '|' || m || '|' || coalesce(d, '');
end;
$$;
create function public.t_err(p_sql text) returns text language plpgsql as $$
declare
  m text;
  d text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return sqlstate || '|' || m || '|' || coalesce(d, '');
end;
$$;
create function public.t_deny(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform public.t_as(p_user);
  return public.t_call(p_sql);
end;
$$;
create function public.t_tree(p_id text, p_x numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'kind', 'shade_tree',
    'properties', jsonb_build_object('label', 'Arbol', 'canopyDiameterM', 6, 'heightM', 8),
    'geometry', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p_x, 19.0436)))
$$;
create function public.t_pub(p_title text, p_x numeric) returns uuid language plpgsql as $$
declare
  b uuid;
  r uuid;
begin
  b := (public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', p_title, gen_random_uuid()::text, repeat('a', 64)) ->> 'branchId')::uuid;
  r := (public.save_revision(b, (public.get_branch_head(b) ->> 'revisionId')::uuid, 'Save',
    jsonb_build_array(public.t_tree(gen_random_uuid()::text, -98.19790 + (abs(hashtext(p_title)) % 40) * 0.00001)), gen_random_uuid()::text, repeat('b', 64)) ->> 'revisionId')::uuid;
  return (public.publish_revision(r, 'Etiqueta', 'Resumen', gen_random_uuid()::text, repeat('c', 64)) ->> 'publicationId')::uuid;
end;
$$;
-- A published publication (by user 2) promoted by coordinator 1. Stores ctx name and name_pub.
create function public.t_new(p_name text, p_x numeric) returns uuid language plpgsql as $$
declare
  v_pub uuid;
  v_d uuid;
  v_prev text := current_setting('request.jwt.claim.sub', true);
begin
  perform public.t_as('21000002');
  v_pub := public.t_pub(p_name, p_x);
  perform public.t_as('21000001');
  v_d := (public.promote_dossier(v_pub, 'Nota ' || p_name, null, false, null, gen_random_uuid()::text, repeat('a', 64)) ->> 'dossierId')::uuid;
  insert into ctx values (p_name, v_d, null), (p_name || '_pub', v_pub, null);
  perform set_config('request.jwt.claim.sub', v_prev, true);
  return v_d;
end;
$$;
create function public.t_pro(p_pub uuid, p_note text, p_name text default null, p_auth boolean default false,
  p_target text default null, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.promote_dossier(%L::uuid, %L, %L, %L::boolean, %L::date, %L, %L)',
    p_pub, p_note, p_name, p_auth, p_target, p_key, p_hash))
$$;
create function public.t_resp(p_d uuid, p_name text, p_auth boolean, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.set_dossier_responsible(%L::uuid, %L, %L::boolean, %L, %L)', p_d, p_name, p_auth, p_key, p_hash))
$$;
create function public.t_addms(p_d uuid, p_title text, p_date text, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.add_milestone(%L::uuid, %L, %L::date, %L, %L)', p_d, p_title, p_date, p_key, p_hash))
$$;
create function public.t_updms(p_m uuid, p_exp text, p_title text, p_date text, p_status text,
  p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.update_milestone(%L::uuid, %L::public.milestone_status, %L, %L::date, %L::public.milestone_status, %L, %L)',
    p_m, p_exp, p_title, p_date, p_status, p_key, p_hash))
$$;
create function public.t_addev(p_d uuid, p_url text, p_title text, p_desc text, p_date text,
  p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.add_evidence(%L::uuid, %L, %L, %L, %L::date, %L, %L)', p_d, p_url, p_title, p_desc, p_date, p_key, p_hash))
$$;
create function public.t_ver(p_e uuid, p_v boolean) returns text language sql as $$
  select public.t_call(format('select public.set_evidence_verified(%L::uuid, %L::boolean)', p_e, p_v))
$$;
create function public.t_tr(p_d uuid, p_exp text, p_new text, p_note text default null, p_obs text default null,
  p_diff text default null, p_evs uuid[] default null, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.transition_dossier(%L::uuid, %L::public.dossier_status, %L::public.dossier_status, %L, %L, %L, %L::uuid[], %L, %L)',
    p_d, p_exp, p_new, p_note, p_obs, p_diff, p_evs, p_key, p_hash))
$$;
create function public.t_rev(p_d uuid, p_exp text, p_note text, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.revert_last_status_change(%L::uuid, %L::public.dossier_status, %L, %L, %L)', p_d, p_exp, p_note, p_key, p_hash))
$$;
create function public.t_man(p_d uuid) returns jsonb language sql as $$ select public.get_managed_dossier(p_d) $$;
-- Walks a dossier through the legal path up to p_stage as coordinator 1. Stores name_m1, name_e1, name_e2.
create function public.t_path(p_name text, p_stage text) returns void language plpgsql as $$
declare
  d uuid := public.t_id(p_name);
  e1 uuid;
  e2 uuid;
  m1 uuid;
begin
  perform public.set_dossier_responsible(d, 'Colectivo Plaza', true, gen_random_uuid()::text, repeat('a', 64));
  m1 := (public.add_milestone(d, 'Reunion', '2027-01-15', gen_random_uuid()::text, repeat('a', 64)) ->> 'milestoneId')::uuid;
  insert into ctx values (p_name || '_m1', m1, null);
  perform public.transition_dossier(d, 'en_revision', 'planeado', 'Plan aprobado', null, null, null, gen_random_uuid()::text, repeat('a', 64));
  if p_stage in ('en_ejecucion', 'ejecutado') then
    e1 := (public.add_evidence(d, 'https://colectivo.example.org/inicio', 'Inicio', 'Acta de inicio', '2024-01-01', gen_random_uuid()::text, repeat('a', 64)) ->> 'evidenceId')::uuid;
    insert into ctx values (p_name || '_e1', e1, null);
    perform public.transition_dossier(d, 'planeado', 'en_ejecucion', 'Inicio de obra', null, null, array[e1], gen_random_uuid()::text, repeat('a', 64));
  end if;
  if p_stage = 'ejecutado' then
    e2 := (public.add_evidence(d, 'https://colectivo.example.org/fin', 'Fin', 'Fotos finales', '2024-01-02', gen_random_uuid()::text, repeat('a', 64)) ->> 'evidenceId')::uuid;
    insert into ctx values (p_name || '_e2', e2, null);
    perform public.transition_dossier(d, 'en_ejecucion', 'ejecutado', 'Obra concluida', 'Se construyo', 'Menor al plan', array[e2], gen_random_uuid()::text, repeat('a', 64));
  end if;
end;
$$;
-- Read-only views over the locked tables (run as the function owner).
create function public.t_sd(p_d uuid) returns jsonb language sql security definer set search_path = '' as
$$ select pg_catalog.to_jsonb(d) from public.dossiers as d where d.id = p_d $$;
create function public.t_kinds(p_d uuid) returns text language sql security definer set search_path = '' as
$$ select coalesce(pg_catalog.string_agg(e.kind::text, ',' order by e.seq), '') from public.dossier_events as e where e.dossier_id = p_d $$;
create function public.t_cnt(p_d uuid, p_what text) returns integer language sql security definer set search_path = '' as $$
  select case p_what
    when 'events' then (select pg_catalog.count(*)::integer from public.dossier_events as e where e.dossier_id = p_d)
    when 'milestones' then (select pg_catalog.count(*)::integer from public.dossier_milestones as m where m.dossier_id = p_d)
    when 'evidence' then (select pg_catalog.count(*)::integer from public.evidence_items as e where e.dossier_id = p_d)
    when 'links' then (select pg_catalog.count(*)::integer from public.dossier_event_evidence as e where e.dossier_id = p_d)
    else -1 end
$$;
create function public.t_npub(p_pub uuid) returns integer language sql security definer set search_path = '' as
$$ select pg_catalog.count(*)::integer from public.dossiers as d where d.publication_id = p_pub $$;
-- Everything the dossier RPCs could change for one dossier (and the ledger of the test actors).
create function public.t_fp(p_d uuid, p_pub uuid) returns jsonb language sql security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'dossier', (select pg_catalog.to_jsonb(d) from public.dossiers as d where d.id = p_d),
    'dossiersForPub', (select pg_catalog.count(*) from public.dossiers as d where d.publication_id = p_pub),
    'events', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.seq), '[]'::jsonb) from public.dossier_events as e where e.dossier_id = p_d),
    'milestones', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.position), '[]'::jsonb) from public.dossier_milestones as m where m.dossier_id = p_d),
    'evidence', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v) order by v.position), '[]'::jsonb) from public.evidence_items as v where v.dossier_id = p_d),
    'links', (select pg_catalog.count(*) from public.dossier_event_evidence as l where l.dossier_id = p_d),
    'requests', (select pg_catalog.count(*) from public.mutation_requests as r where r.actor_id::text like '99021000-%'))
$$;

-- Violations of the transition invariants for one dossier (0 means all hold).
create function public.t_inv(p_d uuid) returns integer language sql security definer set search_path = '' as $$
  select (
    -- status always equals the target of the latest status_change or correction event
    case when (select d.status from public.dossiers as d where d.id = p_d) is distinct from coalesce((
      select e.new_state from public.dossier_events as e
      where e.dossier_id = p_d and e.kind in ('status_change', 'correction') order by e.seq desc limit 1), 'en_revision')
    then 1 else 0 end
  ) + (
    -- ejecutado needs a start (en_ejecucion) before it and an evidence item not cited by that start
    case when (select d.status from public.dossiers as d where d.id = p_d) <> 'ejecutado' then 0
    when not exists (
      select 1 from public.dossier_events as x
      where x.dossier_id = p_d and x.kind = 'status_change' and x.new_state = 'en_ejecucion') then 1
    else (
      with fin as (
        select e.id, e.seq from public.dossier_events as e
        where e.dossier_id = p_d and e.kind = 'status_change' and e.new_state = 'ejecutado' order by e.seq desc limit 1),
      start as (
        select s.id from public.dossier_events as s, fin
        where s.dossier_id = p_d and s.kind = 'status_change' and s.new_state = 'en_ejecucion' and s.seq < fin.seq
        order by s.seq desc limit 1)
      select case
        when not exists (select 1 from start) then 1
        when exists (
          select 1 from public.dossier_event_evidence as l, fin
          where l.event_id = fin.id
            and not exists (select 1 from public.dossier_event_evidence as l2, start where l2.event_id = start.id and l2.evidence_id = l.evidence_id))
        then 0 else 1 end)
    end
  ) + (
    -- every status_change into en_ejecucion or ejecutado cites evidence
    select pg_catalog.count(*)::integer from public.dossier_events as e
    where e.dossier_id = p_d and e.kind = 'status_change' and e.new_state in ('en_ejecucion', 'ejecutado')
      and not exists (select 1 from public.dossier_event_evidence as l where l.event_id = e.id)
  )
$$;
create function public.t_rnd(p_name text, p_i integer, p_salt text, p_mod integer) returns integer language sql immutable as
$$ select abs(hashtext(p_name || ':' || p_i || ':' || p_salt)) % p_mod $$;
-- Applies p_steps deterministic pseudo-random commands (transition or revert) and checks the invariants after each.
create function public.t_model(p_name text, p_steps integer) returns jsonb language plpgsql as $$
declare
  d uuid := public.t_id(p_name);
  states text[] := array['en_revision', 'planeado', 'en_ejecucion', 'ejecutado', 'descartado'];
  i integer;
  st text;
  target text;
  expected text;
  r text;
  k integer;
  evs uuid[];
  applied integer := 0;
  rejected integer := 0;
  violations integer := 0;
  unexpected integer := 0;
  reached integer := 0;
  prev_status text;
begin
  for i in 1..p_steps loop
    st := public.t_sd(d) ->> 'status';
    k := public.t_rnd(p_name, i, 'k', 6);
    evs := case public.t_rnd(p_name, i, 'e', 7)
      when 0 then null
      when 1 then array[]::uuid[]
      when 2 then array[public.t_id(p_name || '_p' || k)]
      when 3 then array[public.t_id(p_name || '_p' || k), public.t_id(p_name || '_p' || ((k + 1) % 6))]
      when 4 then array[gen_random_uuid()]
      else array[public.t_id(p_name || '_p' || ((k + 2) % 6))] end;
    expected := case when public.t_rnd(p_name, i, 'stale', 13) = 0 then states[1 + public.t_rnd(p_name, i, 'stale2', 5)] else st end;
    if public.t_rnd(p_name, i, 'cmd', 10) < (case when st in ('ejecutado', 'descartado') then 5 else 2 end) then
      r := public.t_rev(d, expected, 'Correccion ' || i);
    else
      target := case
        when public.t_rnd(p_name, i, 'tgt', 10) < 7 then
          case st when 'en_revision' then 'planeado' when 'planeado' then 'en_ejecucion' when 'en_ejecucion' then 'ejecutado' else 'descartado' end
        else states[1 + public.t_rnd(p_name, i, 'tgt2', 5)] end;
      r := public.t_tr(d, expected, target,
        case when public.t_rnd(p_name, i, 'note', 5) = 0 then null else 'Nota ' || i end,
        case when public.t_rnd(p_name, i, 'obs', 5) = 0 then null else 'Observacion ' || i end,
        case when public.t_rnd(p_name, i, 'dif', 5) = 0 then null else 'Diferencia ' || i end,
        evs);
    end if;
    if left(r, 1) = '{' then
      applied := applied + 1;
    else
      rejected := rejected + 1;
      if r !~ '^FT(409|422)\|' then
        unexpected := unexpected + 1;
      end if;
    end if;
    violations := violations + public.t_inv(d);
    if (public.t_sd(d) ->> 'status') = 'ejecutado' then
      reached := reached + 1;
    end if;
  end loop;
  return jsonb_build_object('applied', applied, 'rejected', rejected, 'violations', violations, 'unexpected', unexpected, 'reached', reached);
end;
$$;


-- 1. Setup (as postgres)
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from unnest(array['21000001', '21000002']) as n;
insert into public.site_roles (site_id, user_id, role) values
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('21000001')::uuid, 'coordinator');
update public.profiles set public_alias = 'Coordinadora Veintiuno' where id = public.t_uid('21000001')::uuid;

set local role authenticated;
select public.t_as('21000001');
select public.t_new(n, -98.19700) from unnest(array['A', 'B', 'C', 'X', 'D', 'D1', 'D2', 'D3', 'F', 'R1', 'R2', 'R3', 'R4']) as n;
select public.t_path('B', 'planeado');
select public.t_path('C', 'en_ejecucion');
select public.t_path('X', 'ejecutado');
select public.t_path('D', 'planeado');
select public.t_tr(public.t_id('D'), 'planeado', 'descartado', 'Se descarta');
select public.t_path('D2', 'planeado');
select public.t_path('D3', 'en_ejecucion');
select public.t_path('R1', 'ejecutado');
select public.t_path('R3', 'planeado');
select public.t_path('R4', 'planeado');

-- 2. stale_state and the full transition matrix
insert into ctx select 'fpC0', null, public.t_fp(public.t_id('C'), public.t_id('C_pub'));
select is(public.t_tr(public.t_id('A'), s, 'planeado', 'Nota'), 'FT409|stale_state|en_revision', 'stale_state with expected ' || s || ' reports en_revision in DETAIL')
from unnest(array['planeado', 'en_ejecucion', 'ejecutado', 'descartado']) as s;
select is(public.t_tr(public.t_id(c.d), c.cur, c.new, 'Nota', 'Observacion', 'Diferencia', array[public.t_id('C_e1')]), 'FT422|transition_not_allowed|', c.d || ' ' || c.cur || ' -> ' || c.new || ' is not allowed')
from (values
  ('A', 'en_revision', 'en_revision'), ('A', 'en_revision', 'en_ejecucion'), ('A', 'en_revision', 'ejecutado'),
  ('B', 'planeado', 'en_revision'), ('B', 'planeado', 'planeado'), ('B', 'planeado', 'ejecutado'),
  ('C', 'en_ejecucion', 'en_revision'), ('C', 'en_ejecucion', 'planeado'), ('C', 'en_ejecucion', 'en_ejecucion')) as c (d, cur, new);
select is(public.t_tr(public.t_id(c.d), c.cur, s, 'Nota', 'Observacion', 'Diferencia', array[public.t_id('C_e1')]), 'FT409|dossier_closed|', c.d || ' (' || c.cur || ') is closed: to ' || s)
from (values ('X', 'ejecutado'), ('D', 'descartado')) as c (d, cur)
cross join unnest(array['en_revision', 'planeado', 'en_ejecucion', 'ejecutado', 'descartado']) as s;
select is(public.t_doc('fpC0'), public.t_fp(public.t_id('C'), public.t_id('C_pub')), 'the rejected transitions changed nothing on C');
select is(public.t_tr(public.t_id('A'), 'en_revision', 'planeado', c.note, null, null, c.evs, c.key, c.hash), '22023|invalid_transition_request|', 'transition rejects ' || c.label)
from (values
  ('an empty note', '', null::uuid[], 'tran-key-0001', repeat('a', 64)),
  ('a note of 1001 chars', repeat('n', 1001), null, 'tran-key-0001', repeat('a', 64)),
  ('a note that is not plain text', ' Nota', null, 'tran-key-0001', repeat('a', 64)),
  ('51 evidence ids', 'Nota', (select array_agg(gen_random_uuid()) from generate_series(1, 51)), 'tran-key-0001', repeat('a', 64)),
  ('a short key', 'Nota', null, 'short12', repeat('a', 64)),
  ('a bad payload hash', 'Nota', null, 'tran-key-0001', 'xyz')) as c (label, note, evs, key, hash);
select is(public.t_tr(public.t_id('A'), 'en_revision', 'planeado', null, 'Obs', 'Dif', array[public.t_id('C_e1')]), 'FT422|invalid_evidence_reference|', 'evidence of another dossier is rejected before the planeado rules');
select is(public.t_tr(public.t_id('A'), 'en_revision', 'planeado', null, null, null, array[gen_random_uuid()]), 'FT422|invalid_evidence_reference|', 'a random evidence id is rejected');

-- 3. en_revision -> planeado
select is(public.t_tr(public.t_id('A'), 'en_revision', 'planeado'), 'FT422|note_required|', 'planeado needs a note');
select is(public.t_tr(public.t_id('A'), 'en_revision', 'planeado', 'Plan'), 'FT422|plan_requires_responsible|', 'planeado needs a responsible');
select is(public.t_resp(public.t_id('A'), 'Colectivo Plaza', true)::jsonb ->> 'hasResponsible', 'true', 'A gets a responsible');
select is(public.t_tr(public.t_id('A'), 'en_revision', 'planeado', 'Plan'), 'FT422|plan_requires_milestone|', 'planeado needs a milestone');
insert into ctx select 'A_m1', (public.t_addms(public.t_id('A'), 'Hito A1', '2027-01-01')::jsonb ->> 'milestoneId')::uuid, null;
select is(public.t_updms(public.t_id('A_m1'), 'pendiente', 'Hito A1', '2027-01-01', 'cancelado')::jsonb ->> 'status', 'cancelado', 'the only milestone is cancelled');
select is(public.t_tr(public.t_id('A'), 'en_revision', 'planeado', 'Plan'), 'FT422|plan_requires_milestone|', 'a cancelled milestone does not count');
insert into ctx select 'A_m2', (public.t_addms(public.t_id('A'), 'Hito A2', '2027-02-01')::jsonb ->> 'milestoneId')::uuid, null;
select is(public.t_tr(public.t_id('A'), 'en_revision', 'planeado', 'Plan aprobado')::jsonb ->> 'status', 'planeado', 'planeado with note, responsible, and a live milestone');
select is(public.t_sd(public.t_id('A')) ->> 'status', 'planeado', 'A is planeado');

-- 4. planeado -> en_ejecucion
insert into ctx select 'A_e1', (public.t_addev(public.t_id('A'), 'https://colectivo.example.org/a1', 'Inicio', 'Acta de inicio', '2024-01-01')::jsonb ->> 'evidenceId')::uuid, null;
insert into ctx select 'A_e2', (public.t_addev(public.t_id('A'), 'https://colectivo.example.org/a2', 'Fin', 'Fotos finales', '2024-01-02')::jsonb ->> 'evidenceId')::uuid, null;
select is(public.t_tr(public.t_id('A'), 'planeado', 'en_ejecucion', null, null, null, array[public.t_id('A_e1')]), 'FT422|start_requires_note|', 'start needs a note');
select is(public.t_tr(public.t_id('A'), 'planeado', 'en_ejecucion', 'Inicio'), 'FT422|start_requires_evidence|', 'start needs evidence (null list)');
select is(public.t_tr(public.t_id('A'), 'planeado', 'en_ejecucion', 'Inicio', null, null, array[]::uuid[]), 'FT422|start_requires_evidence|', 'start needs evidence (empty list)');
select is(public.t_tr(public.t_id('A'), 'planeado', 'en_ejecucion', 'Inicio', null, null, array[gen_random_uuid()]), 'FT422|invalid_evidence_reference|', 'start with a random evidence id');
select is(public.t_tr(public.t_id('A'), 'planeado', 'en_ejecucion', 'Inicio', null, null, array[public.t_id('C_e1')]), 'FT422|invalid_evidence_reference|', 'start with evidence of another dossier');
select is(public.t_tr(public.t_id('A'), 'planeado', 'en_ejecucion', 'Inicio', null, null, array[public.t_id('A_e1'), public.t_id('C_e1')]), 'FT422|invalid_evidence_reference|', 'one foreign id among valid ones rejects the whole call');
select is(public.t_sd(public.t_id('A')) ->> 'status', 'planeado', 'rejected starts left A planeado');
select is(public.t_tr(public.t_id('A'), 'planeado', 'en_ejecucion', 'Inicio de obra', null, null, array[public.t_id('A_e1'), public.t_id('A_e1')])::jsonb ->> 'status', 'en_ejecucion', 'start with evidence (duplicate ids collapse)');
select is(public.t_cnt(public.t_id('A'), 'links'), 1, 'one evidence link for the start event');

-- 5. en_ejecucion -> ejecutado
select is(public.t_tr(public.t_id('A'), 'en_ejecucion', 'ejecutado', 'Fin', null, 'Dif', array[public.t_id('A_e2')]), 'FT422|execute_requires_observation|', 'ejecutado needs an observation');
select is(public.t_tr(public.t_id('A'), 'en_ejecucion', 'ejecutado', 'Fin', 'Obs', null, array[public.t_id('A_e2')]), 'FT422|execute_requires_observation|', 'ejecutado needs a difference');
select is(public.t_tr(public.t_id('A'), 'en_ejecucion', 'ejecutado', null, null, null, array[public.t_id('A_e2')]), 'FT422|execute_requires_observation|', 'ejecutado without observation, difference, and note');
select is(public.t_tr(public.t_id('A'), 'en_ejecucion', 'ejecutado', null, 'Obs', 'Dif', array[public.t_id('A_e2')]), 'FT422|note_required|', 'ejecutado needs a note');
select is(public.t_tr(public.t_id('A'), 'en_ejecucion', 'ejecutado', 'Fin', 'Obs', 'Dif'), 'FT422|execute_requires_evidence|', 'ejecutado needs evidence (null list)');
select is(public.t_tr(public.t_id('A'), 'en_ejecucion', 'ejecutado', 'Fin', 'Obs', 'Dif', array[]::uuid[]), 'FT422|execute_requires_evidence|', 'ejecutado needs evidence (empty list)');
select is(public.t_tr(public.t_id('A'), 'en_ejecucion', 'ejecutado', 'Fin', 'Obs', 'Dif', array[public.t_id('A_e1')]), 'FT422|execute_requires_evidence|', 'only the start evidence does not prove completion');
select is(public.t_sd(public.t_id('A')) ->> 'status', 'en_ejecucion', 'rejected completions left A en_ejecucion');
select is(public.t_tr(public.t_id('A'), 'en_ejecucion', 'ejecutado', 'Obra concluida', 'Se construyo', 'Menor al plan', array[public.t_id('A_e2')])::jsonb ->> 'status', 'ejecutado', 'ejecutado with new evidence');
insert into ctx select 'C_e2', (public.t_addev(public.t_id('C'), 'https://colectivo.example.org/c2', 'Fin', 'Fotos finales', '2024-01-02')::jsonb ->> 'evidenceId')::uuid, null;
select is(public.t_tr(public.t_id('C'), 'en_ejecucion', 'ejecutado', 'Obra concluida', 'Se construyo', 'Menor al plan', array[public.t_id('C_e1'), public.t_id('C_e2')])::jsonb ->> 'status', 'ejecutado', 'ejecutado citing both the start evidence and a new item');
select is(public.t_cnt(public.t_id('C'), 'links'), 3, 'C has 1 start link and 2 completion links');

-- 6. descartado needs a reason from every open state
select is(public.t_tr(public.t_id(c.d), c.cur, 'descartado'), 'FT422|discard_requires_reason|', 'descartado from ' || c.cur || ' needs a reason')
from (values ('D1', 'en_revision'), ('D2', 'planeado'), ('D3', 'en_ejecucion')) as c (d, cur);
select is(public.t_tr(public.t_id(c.d), c.cur, 'descartado', 'Sin presupuesto')::jsonb ->> 'status', 'descartado', 'descartado from ' || c.cur || ' works')
from (values ('D1', 'en_revision'), ('D2', 'planeado'), ('D3', 'en_ejecucion')) as c (d, cur);
select is(public.t_kinds(public.t_id('D1')), 'promoted,status_change', 'D1 timeline: promoted, status_change');

-- 7. Idempotency
insert into ctx select 'fr', null, public.t_tr(public.t_id('F'), 'en_revision', 'descartado', 'Razon', null, null, null, 'tran-idem-001', repeat('1', 64))::jsonb;
select is(public.t_doc('fr') ->> 'status', 'descartado', 'F discarded');
select is(public.t_tr(public.t_id('F'), 'en_revision', 'descartado', 'Razon', null, null, null, 'tran-idem-001', repeat('1', 64))::jsonb, public.t_doc('fr'), 'replay returns the same json even though the dossier is now closed');
select is(public.t_kinds(public.t_id('F')), 'promoted,status_change', 'replay added no event');
select is(public.t_tr(public.t_id('F'), 'en_revision', 'descartado', 'Otra razon', null, null, null, 'tran-idem-001', repeat('2', 64)), 'FT001|idempotency_key_reused|', 'same key with a different payload: FT001');

-- 8. Timeline of A
select is((select string_agg(e ->> 'seq', ',' order by (e ->> 'seq')::int) from jsonb_array_elements(public.t_man(public.t_id('A')) -> 'events') as e),
  (select string_agg(g::text, ',' order by g) from generate_series(1, public.t_cnt(public.t_id('A'), 'events')) as g), 'event seq numbers are contiguous from 1');
select is((select string_agg((e ->> 'previousState') || '>' || (e ->> 'newState'), ',' order by (e ->> 'seq')::int)
  from jsonb_array_elements(public.t_man(public.t_id('A')) -> 'events') as e where e ->> 'kind' = 'status_change'),
  'en_revision>planeado,planeado>en_ejecucion,en_ejecucion>ejecutado', 'status_change events follow the path');
select is((select count(*)::int from jsonb_array_elements(public.t_man(public.t_id('A')) -> 'events') as e
  where e ->> 'kind' = 'status_change' and (e ->> 'note') is not null and e ->> 'actorAlias' = 'Coordinadora Veintiuno'), 3, 'every status_change has a note and the actor alias');
select is((select e -> 'evidenceIds' from jsonb_array_elements(public.t_man(public.t_id('A')) -> 'events') as e where e ->> 'newState' = 'en_ejecucion'),
  jsonb_build_array(public.t_id('A_e1')), 'the start event cites A_e1');
select is((select e -> 'evidenceIds' from jsonb_array_elements(public.t_man(public.t_id('A')) -> 'events') as e where e ->> 'newState' = 'ejecutado'),
  jsonb_build_array(public.t_id('A_e2')), 'the completion event cites A_e2');
select is((select e ->> 'observation' || '|' || (e ->> 'difference') from jsonb_array_elements(public.t_man(public.t_id('A')) -> 'events') as e where e ->> 'newState' = 'ejecutado'),
  'Se construyo|Menor al plan', 'observation and difference are stored on the completion event');
select is(public.t_cnt(public.t_id('A'), 'links'), 2, 'A has exactly two evidence links');

-- 9. revert_last_status_change
select is(public.t_rev(public.t_id('R1'), 'planeado', 'Nota'), 'FT409|stale_state|ejecutado', 'revert with a stale expected state: FT409 with the current state');
select is(public.t_rev(public.t_id('R1'), 'ejecutado', '', 'corr-key-0001', repeat('1', 64)), '22023|invalid_correction_request|', 'revert needs a non-empty note');
select is(public.t_rev(public.t_id('R1'), 'ejecutado', 'Nota', 'short12'), '22023|invalid_correction_request|', 'revert rejects a short key');
insert into ctx select 'rv1', null, public.t_rev(public.t_id('R1'), 'ejecutado', 'Se registro por error', 'corr-key-0001', repeat('1', 64))::jsonb;
select is(public.t_doc('rv1') ->> 'status', 'en_ejecucion', 'revert ejecutado -> en_ejecucion');
select is(public.t_sd(public.t_id('R1')) ->> 'status', 'en_ejecucion', 'the dossier is en_ejecucion');
select is(public.t_rev(public.t_id('R1'), 'ejecutado', 'Se registro por error', 'corr-key-0001', repeat('1', 64))::jsonb, public.t_doc('rv1'), 'replay returns the same json');
select is(public.t_rev(public.t_id('R1'), 'ejecutado', 'Otra nota', 'corr-key-0001', repeat('2', 64)), 'FT001|idempotency_key_reused|', 'same key, different payload: FT001');
select is((select count(*)::int from jsonb_array_elements(public.t_man(public.t_id('R1')) -> 'events') as e where e ->> 'kind' = 'correction'), 1, 'exactly one correction event');
select is((select e ->> 'previousState' || '>' || (e ->> 'newState') || '|' || (e ->> 'note') from jsonb_array_elements(public.t_man(public.t_id('R1')) -> 'events') as e where e ->> 'kind' = 'correction'),
  'ejecutado>en_ejecucion|Se registro por error', 'the correction event records the states and the note');
select is((select e ->> 'correctsSeq' from jsonb_array_elements(public.t_man(public.t_id('R1')) -> 'events') as e where e ->> 'kind' = 'correction'),
  (select e ->> 'seq' from jsonb_array_elements(public.t_man(public.t_id('R1')) -> 'events') as e where e ->> 'newState' = 'ejecutado' and e ->> 'kind' = 'status_change'),
  'the correction names the corrected status_change event');
select is(public.t_rev(public.t_id('R1'), 'en_ejecucion', 'Otra vez'), 'FT422|correction_not_allowed|', 'the same change cannot be reverted twice');
insert into ctx select 'R1_e3', (public.t_addev(public.t_id('R1'), 'https://colectivo.example.org/r3', 'Nueva', 'Fotos nuevas', '2024-01-03')::jsonb ->> 'evidenceId')::uuid, null;
select is(public.t_tr(public.t_id('R1'), 'en_ejecucion', 'ejecutado', 'Obra concluida', 'Se construyo', 'Menor al plan', array[public.t_id('R1_e3')])::jsonb ->> 'status', 'ejecutado', 'after the correction the dossier can be marked ejecutado again with new evidence');
select is(public.t_rev(public.t_id('R1'), 'ejecutado', 'Segunda correccion')::jsonb ->> 'status', 'en_ejecucion', 'the new completion can be reverted too');
select is((select count(*)::int from jsonb_array_elements(public.t_man(public.t_id('R1')) -> 'events') as e where e ->> 'kind' = 'correction'), 2, 'two correction events in total');
select is(public.t_rev(public.t_id('R2'), 'en_revision', 'Nota'), 'FT422|correction_not_allowed|', 'a new dossier has no status change to revert');
select is(public.t_tr(public.t_id('R3'), 'planeado', 'descartado', 'Se descarta')::jsonb ->> 'status', 'descartado', 'R3 discarded');
select is(public.t_rev(public.t_id('R3'), 'descartado', 'Fue un error')::jsonb ->> 'status', 'planeado', 'revert of descartado returns to planeado');
select is(public.t_sd(public.t_id('R3')) ->> 'status', 'planeado', 'R3 is planeado again');
select is(public.t_rev(public.t_id('R3'), 'planeado', 'Otra vez'), 'FT422|correction_not_allowed|', 'R3: the discard was already reverted');
select is(public.t_rev(public.t_id('R4'), 'planeado', 'Plan prematuro')::jsonb ->> 'status', 'en_revision', 'revert of the first status change returns to en_revision');
select is(public.t_tr(public.t_id('R4'), 'en_revision', 'planeado', 'Plan confirmado')::jsonb ->> 'status', 'planeado', 'R4 can be planned again');
select is(public.t_kinds(public.t_id('R4')), 'promoted,responsible_changed,milestone_added,status_change,correction,status_change', 'R4 timeline keeps the whole history');

-- 10. The deferred evidence constraint is satisfied by every RPC path used above
reset role;
select is(public.t_err('set constraints all immediate'), 'ok', 'deferred dossier_events_need_evidence checks pass for every event created through the RPCs (no 23514)');
set constraints all deferred;
set local role authenticated;
select public.t_as('21000001');

-- 11. Model check: 4 dossiers x 50 deterministic pseudo-random commands
select public.t_new(n, -98.19700) from unnest(array['M1', 'M2', 'M3', 'M4']) as n;
select public.t_resp(public.t_id(n), 'Colectivo Plaza', true) from unnest(array['M1', 'M2', 'M3', 'M4']) as n;
select public.t_addms(public.t_id(n), 'Hito', '2027-01-01') from unnest(array['M1', 'M2', 'M3', 'M4']) as n;
insert into ctx select n || '_p' || k, (public.t_addev(public.t_id(n), 'https://colectivo.example.org/' || n || k, 'Evidencia ' || k, 'Descripcion', '2024-01-01')::jsonb ->> 'evidenceId')::uuid, null
from unnest(array['M1', 'M2', 'M3', 'M4']) as n cross join generate_series(0, 5) as k;
insert into ctx select 'model_' || n, null, public.t_model(n, 50) from unnest(array['M1', 'M2', 'M3', 'M4']) as n;
select is((public.t_doc('model_' || n) ->> 'applied')::int + (public.t_doc('model_' || n) ->> 'rejected')::int, 50, n || ': all 50 commands were applied or rejected')
from unnest(array['M1', 'M2', 'M3', 'M4']) as n;
select is((public.t_doc('model_' || n) ->> 'violations')::int, 0, n || ': no invariant violation after any command')
from unnest(array['M1', 'M2', 'M3', 'M4']) as n;
select is((public.t_doc('model_' || n) ->> 'unexpected')::int, 0, n || ': every rejection is an FT409 or FT422')
from unnest(array['M1', 'M2', 'M3', 'M4']) as n;
select diag(name || ' ' || doc::text) from ctx where name like 'model\_M%' order by name;
select cmp_ok((select sum((doc ->> 'reached')::int)::int from ctx where name like 'model\_M%'), '>', 0, 'the model reached ejecutado at least once (the invariant is not vacuous)');
select cmp_ok((select sum((doc ->> 'applied')::int)::int from ctx where name like 'model\_M%'), '>', 20, 'the model applied more than 20 commands');
reset role;
select is(public.t_err('set constraints all immediate'), 'ok', 'deferred evidence check also passes for the model sequences');
set constraints all deferred;

select * from finish();
rollback;
