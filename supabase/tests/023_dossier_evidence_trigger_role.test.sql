begin;

select plan(13);

-- Regression for 20261125050000_dossier_evidence_trigger_definer.sql: the deferred trigger
-- dossier_events_need_evidence runs at COMMIT as the calling role, which has no grant on
-- dossier_event_evidence. pgTAP runs as a superuser, so every check here runs after
-- `set local role authenticated` and forces the deferred trigger with `set constraints all immediate`.

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
-- Last 8 hex characters are unique per user: the generated profile alias uses them.
create function public.t_uid(p text) returns text language sql immutable as
$$ select '99023000-0000-4000-8000-0000' || lpad(p, 8, '0') $$;
create function public.t_as(p text) returns text language sql as
$$ select set_config('request.jwt.claim.sub', public.t_uid(p), true) $$;
create function public.t_call(p_sql text) returns text language plpgsql as $$
declare
  r text;
  m text;
begin
  execute p_sql into r;
  return r;
exception when others then
  get stacked diagnostics m = message_text;
  return sqlstate || '|' || m;
end;
$$;
create function public.t_err(p_sql text) returns text language plpgsql as $$
declare
  m text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics m = message_text;
  return sqlstate || '|' || m;
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
    jsonb_build_array(public.t_tree(gen_random_uuid()::text, p_x)), gen_random_uuid()::text, repeat('b', 64)) ->> 'revisionId')::uuid;
  return (public.publish_revision(r, 'Etiqueta', 'Resumen', gen_random_uuid()::text, repeat('c', 64)) ->> 'publicationId')::uuid;
end;
$$;
create function public.t_tr(p_d uuid, p_exp text, p_new text, p_note text default null, p_obs text default null,
  p_diff text default null, p_evs uuid[] default null)
returns text language sql as $$
  select public.t_call(format('select public.transition_dossier(%L::uuid, %L::public.dossier_status, %L::public.dossier_status, %L, %L, %L, %L::uuid[], %L, %L)',
    p_d, p_exp, p_new, p_note, p_obs, p_diff, p_evs, gen_random_uuid()::text, repeat('a', 64)))
$$;
-- Read-only views over the locked tables (run as the function owner).
create function public.t_status(p_d uuid) returns text language sql security definer set search_path = '' as
$$ select d.status::text from public.dossiers as d where d.id = p_d $$;
create function public.t_links(p_d uuid) returns integer language sql security definer set search_path = '' as
$$ select pg_catalog.count(*)::integer from public.dossier_event_evidence as l where l.dossier_id = p_d $$;

-- 1. Setup (as postgres): a coordinator (1) and a participant who publishes (2)
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from unnest(array['23000001', '23000002']) as n;
insert into public.site_roles (site_id, user_id, role) values
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('23000001')::uuid, 'coordinator');

set local role authenticated;
select public.t_as('23000002');
insert into ctx select 'pub', public.t_pub('Plaza 023', -98.19790), null;
insert into ctx select 'pub2', public.t_pub('Plaza 023 B', -98.19780), null;
select public.t_as('23000001');
insert into ctx select 'N', (public.promote_dossier(public.t_id('pub2'), 'Nota N', null, false, null, gen_random_uuid()::text, repeat('a', 64)) ->> 'dossierId')::uuid, null;
select public.set_dossier_responsible(public.t_id('N'), 'Colectivo Plaza', true, gen_random_uuid()::text, repeat('a', 64));
select public.add_milestone(public.t_id('N'), 'Reunion', '2027-01-15', gen_random_uuid()::text, repeat('a', 64));
select public.transition_dossier(public.t_id('N'), 'en_revision', 'planeado', 'Plan aprobado', null, null, null, gen_random_uuid()::text, repeat('a', 64));
insert into ctx select 'D', (public.promote_dossier(public.t_id('pub'), 'Nota 023', null, false, null, gen_random_uuid()::text, repeat('a', 64)) ->> 'dossierId')::uuid, null;
select public.set_dossier_responsible(public.t_id('D'), 'Colectivo Plaza', true, gen_random_uuid()::text, repeat('a', 64));
select public.add_milestone(public.t_id('D'), 'Reunion', '2027-01-15', gen_random_uuid()::text, repeat('a', 64));
select public.transition_dossier(public.t_id('D'), 'en_revision', 'planeado', 'Plan aprobado', null, null, null, gen_random_uuid()::text, repeat('a', 64));
insert into ctx select 'e1', (public.add_evidence(public.t_id('D'), 'https://colectivo.example.org/inicio', 'Inicio', 'Acta de inicio', '2024-01-01', gen_random_uuid()::text, repeat('a', 64)) ->> 'evidenceId')::uuid, null;
insert into ctx select 'e2', (public.add_evidence(public.t_id('D'), 'https://colectivo.example.org/fin', 'Fin', 'Fotos finales', '2024-01-02', gen_random_uuid()::text, repeat('a', 64)) ->> 'evidenceId')::uuid, null;

select is(current_user::text, 'authenticated', 'the session runs as the authenticated role');
select is(public.t_status(public.t_id('D')), 'planeado', 'D is planeado before the transitions');

-- 2. Without evidence the RPC still rejects (FT422) and nothing is left to fail at commit
select is(public.t_tr(public.t_id('D'), 'planeado', 'en_ejecucion', 'Inicio de obra'), 'FT422|start_requires_evidence', 'authenticated: start without evidence is rejected by the RPC');
select is(public.t_err('set constraints all immediate'), 'ok', 'authenticated: the rejected start leaves no event for the deferred trigger');
set constraints all deferred;

-- 3. planeado -> en_ejecucion citing evidence, then the deferred trigger as authenticated
select is(public.t_tr(public.t_id('D'), 'planeado', 'en_ejecucion', 'Inicio de obra', null, null, array[public.t_id('e1')])::jsonb ->> 'status', 'en_ejecucion', 'authenticated coordinator: planeado -> en_ejecucion citing evidence');
select is(public.t_err('set constraints all immediate'), 'ok', 'authenticated: deferred evidence trigger passes for en_ejecucion (no permission denied)');
set constraints all deferred;

-- 4. en_ejecucion -> ejecutado citing new evidence
select is(public.t_tr(public.t_id('D'), 'en_ejecucion', 'ejecutado', 'Obra concluida', 'Se construyo', 'Menor al plan', array[public.t_id('e2')])::jsonb ->> 'status', 'ejecutado', 'authenticated coordinator: en_ejecucion -> ejecutado citing evidence');
select is(public.t_err('set constraints all immediate'), 'ok', 'authenticated: deferred evidence trigger passes for ejecutado (no permission denied)');
set constraints all deferred;
select is(public.t_status(public.t_id('D')), 'ejecutado', 'D ended ejecutado');
select is(public.t_links(public.t_id('D')), 2, 'one evidence link per execution event');

-- 5. Without evidence the trigger still fails with 23514 under the authenticated role
-- Stage the offending event as postgres (the RPCs refuse to create it), then check as authenticated.
reset role;
insert into public.dossier_events (id, dossier_id, seq, kind, previous_state, new_state, note, actor_id)
select gen_random_uuid(), d.id, d.last_event_seq + 1, 'status_change', 'planeado', 'en_ejecucion', 'Sin evidencia', public.t_uid('23000001')::uuid from public.dossiers as d where d.id = public.t_id('N');
set local role authenticated;
select public.t_as('23000001');
select is(current_user::text, 'authenticated', 'the check below runs as authenticated');
select is(public.t_err('set constraints all immediate'), '23514|dossier_event_requires_evidence', 'authenticated: an en_ejecucion event without evidence fails with 23514, not permission denied');
set constraints all deferred;
select is(public.t_links(public.t_id('N')), 0, 'the staged event has no evidence link');

reset role;
select * from finish();
rollback;
