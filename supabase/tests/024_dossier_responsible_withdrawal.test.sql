begin;

select plan(36);

-- Regression for 20261125060000_dossier_responsible_withdrawal.sql: withdrawing the responsible
-- (name NULL) works for the site coordinator even when the dossier is closed or its publication
-- is hidden. Setting a name in those states stays blocked. Every check runs as `authenticated`.

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
-- Last 8 hex characters are unique per user: the generated profile alias uses them.
create function public.t_uid(p text) returns text language sql immutable as
$$ select '99024000-0000-4000-8000-0000' || lpad(p, 8, '0') $$;
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
create function public.t_resp(p_d uuid, p_name text, p_auth boolean, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.set_dossier_responsible(%L::uuid, %L, %L::boolean, %L, %L)', p_d, p_name, p_auth, p_key, p_hash))
$$;
create function public.t_tr(p_d uuid, p_exp text, p_new text, p_note text default null, p_obs text default null,
  p_diff text default null, p_evs uuid[] default null)
returns text language sql as $$
  select public.t_call(format('select public.transition_dossier(%L::uuid, %L::public.dossier_status, %L::public.dossier_status, %L, %L, %L, %L::uuid[], %L, %L)',
    p_d, p_exp, p_new, p_note, p_obs, p_diff, p_evs, gen_random_uuid()::text, repeat('a', 64)))
$$;
-- Privileged helpers (owner postgres): moderation and read-only views over the locked tables.
create function public.t_mod(p_pub uuid, p_state text) returns void language sql security definer set search_path = '' as $$
  update public.publications set moderation_state = p_state::public.publication_moderation_state where id = p_pub
$$;
create function public.t_name(p_d uuid) returns text language sql security definer set search_path = '' as
$$ select coalesce(d.responsible_name, '<null>') from public.dossiers as d where d.id = p_d $$;
create function public.t_authz(p_d uuid) returns boolean language sql security definer set search_path = '' as
$$ select d.responsible_authorized from public.dossiers as d where d.id = p_d $$;
create function public.t_status(p_d uuid) returns text language sql security definer set search_path = '' as
$$ select d.status::text from public.dossiers as d where d.id = p_d $$;
create function public.t_nev(p_d uuid) returns integer language sql security definer set search_path = '' as
$$ select pg_catalog.count(*)::integer from public.dossier_events as e where e.dossier_id = p_d $$;
create function public.t_lastkind(p_d uuid) returns text language sql security definer set search_path = '' as
$$ select e.kind::text from public.dossier_events as e where e.dossier_id = p_d order by e.seq desc limit 1 $$;
-- Events whose full row text mentions the name (must stay 0 after the withdrawal).
create function public.t_leak(p_d uuid, p_name text) returns integer language sql security definer set search_path = '' as
$$ select pg_catalog.count(*)::integer from public.dossier_events as e
   where e.dossier_id = p_d and pg_catalog.to_jsonb(e)::text like '%' || p_name || '%' $$;

-- 1. Setup (as postgres): coordinator (1), publisher (2) and an unrelated participant (3)
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from unnest(array['24000001', '24000002', '24000003']) as n;
insert into public.site_roles (site_id, user_id, role) values
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('24000001')::uuid, 'coordinator');

set local role authenticated;
select public.t_as('24000002');
insert into ctx select 'pubA', public.t_pub('Retiro A', -98.19790), null;
insert into ctx select 'pubB', public.t_pub('Retiro B', -98.19780), null;
insert into ctx select 'pubC', public.t_pub('Retiro C', -98.19770), null;
select public.t_as('24000001');
insert into ctx select 'A', (public.promote_dossier(public.t_id('pubA'), 'Nota A', null, false, null, gen_random_uuid()::text, repeat('a', 64)) ->> 'dossierId')::uuid, null;
insert into ctx select 'B', (public.promote_dossier(public.t_id('pubB'), 'Nota B', null, false, null, gen_random_uuid()::text, repeat('a', 64)) ->> 'dossierId')::uuid, null;
insert into ctx select 'C', (public.promote_dossier(public.t_id('pubC'), 'Nota C', null, false, null, gen_random_uuid()::text, repeat('a', 64)) ->> 'dossierId')::uuid, null;
select public.set_dossier_responsible(public.t_id('A'), 'Colectivo Alfa', true, gen_random_uuid()::text, repeat('a', 64));
select public.set_dossier_responsible(public.t_id('B'), 'Colectivo Beta', true, gen_random_uuid()::text, repeat('a', 64));
select public.set_dossier_responsible(public.t_id('C'), 'Colectivo Gamma', true, gen_random_uuid()::text, repeat('a', 64));

-- A: planeado -> en_ejecucion -> ejecutado (closed)
select public.add_milestone(public.t_id('A'), 'Reunion', '2027-01-15', gen_random_uuid()::text, repeat('a', 64));
select public.transition_dossier(public.t_id('A'), 'en_revision', 'planeado', 'Plan aprobado', null, null, null, gen_random_uuid()::text, repeat('a', 64));
insert into ctx select 'a1', (public.add_evidence(public.t_id('A'), 'https://colectivo.example.org/inicio', 'Inicio', 'Acta de inicio', '2024-01-01', gen_random_uuid()::text, repeat('a', 64)) ->> 'evidenceId')::uuid, null;
insert into ctx select 'a2', (public.add_evidence(public.t_id('A'), 'https://colectivo.example.org/fin', 'Fin', 'Fotos finales', '2024-01-02', gen_random_uuid()::text, repeat('a', 64)) ->> 'evidenceId')::uuid, null;
select public.t_tr(public.t_id('A'), 'planeado', 'en_ejecucion', 'Inicio de obra', null, null, array[public.t_id('a1')]);
select public.t_tr(public.t_id('A'), 'en_ejecucion', 'ejecutado', 'Obra concluida', 'Se construyo', 'Menor al plan', array[public.t_id('a2')]);
-- B: discarded (closed)
select public.t_tr(public.t_id('B'), 'en_revision', 'descartado', 'Sin presupuesto');
-- C: still open, its publication is hidden
select public.t_mod(public.t_id('pubC'), 'hidden');

select is(current_user::text, 'authenticated', 'the session runs as the authenticated role');
select is(public.t_status(public.t_id('A')), 'ejecutado', 'A is ejecutado (closed)');
select is(public.t_status(public.t_id('B')), 'descartado', 'B is descartado (closed)');
select is(public.t_name(public.t_id('A')) || '/' || public.t_name(public.t_id('B')) || '/' || public.t_name(public.t_id('C')),
  'Colectivo Alfa/Colectivo Beta/Colectivo Gamma', 'each dossier starts with its responsible name');

-- 2. A non-coordinator gets dossier_not_found on a withdrawal, closed, discarded or hidden
select public.t_as('24000003');
select is(public.t_resp(public.t_id('A'), null, false), 'P0002|dossier_not_found', 'stranger: withdrawing on closed A is P0002 dossier_not_found');
select is(public.t_resp(public.t_id('B'), null, false), 'P0002|dossier_not_found', 'stranger: withdrawing on discarded B is P0002 dossier_not_found');
select is(public.t_resp(public.t_id('C'), null, false), 'P0002|dossier_not_found', 'stranger: withdrawing on hidden C is P0002 dossier_not_found');
select public.t_as('24000002');
select is(public.t_resp(public.t_id('A'), null, false), 'P0002|dossier_not_found', 'the publisher without a coordinator role gets the same P0002');
select is(public.t_name(public.t_id('A')) || '/' || public.t_name(public.t_id('B')) || '/' || public.t_name(public.t_id('C')),
  'Colectivo Alfa/Colectivo Beta/Colectivo Gamma', 'the rejected withdrawals changed nothing');

-- 3. Closed dossier A (ejecutado): the coordinator withdraws the name
select public.t_as('24000001');
insert into ctx select 'nevA', null, to_jsonb(public.t_nev(public.t_id('A')));
select is(public.t_resp(public.t_id('A'), null, false)::jsonb ->> 'hasResponsible', 'false', 'A closed: the coordinator withdraws the responsible');
select is(public.t_name(public.t_id('A')), '<null>', 'A closed: responsible_name is NULL');
select is(public.t_authz(public.t_id('A')), false, 'A closed: responsible_authorized is false');
select is(public.t_nev(public.t_id('A')), (select (doc #>> '{}')::integer + 1 from ctx where name = 'nevA'), 'A closed: exactly one event was added');
select is(public.t_lastkind(public.t_id('A')), 'responsible_changed', 'A closed: the new event is responsible_changed');
select is(public.t_leak(public.t_id('A'), 'Colectivo Alfa'), 0, 'A closed: no event copies the name');
select is(public.t_status(public.t_id('A')), 'ejecutado', 'A closed: the status is unchanged');
select is(public.t_resp(public.t_id('A'), 'Colectivo Nuevo', true), 'FT409|dossier_closed', 'A closed: setting a new name is FT409 dossier_closed');
select is(public.t_name(public.t_id('A')), '<null>', 'A closed: the blocked name was not saved');

-- 4. Idempotent replay of a withdrawal adds no second event
insert into ctx select 'nevR', null, to_jsonb(public.t_nev(public.t_id('B')));
select is(public.t_resp(public.t_id('B'), null, false, 'retiro-b-clave-1', repeat('d', 64))::jsonb ->> 'hasResponsible', 'false', 'B discarded: the coordinator withdraws the responsible');
select is(public.t_resp(public.t_id('B'), null, false, 'retiro-b-clave-1', repeat('d', 64))::jsonb ->> 'hasResponsible', 'false', 'B discarded: the same key replays the stored result');
select is(public.t_nev(public.t_id('B')), (select (doc #>> '{}')::integer + 1 from ctx where name = 'nevR'), 'B discarded: the replay did not add another event');

-- 5. Discarded dossier B
select is(public.t_name(public.t_id('B')), '<null>', 'B discarded: responsible_name is NULL');
select is(public.t_authz(public.t_id('B')), false, 'B discarded: responsible_authorized is false');
select is(public.t_lastkind(public.t_id('B')), 'responsible_changed', 'B discarded: the new event is responsible_changed');
select is(public.t_leak(public.t_id('B'), 'Colectivo Beta'), 0, 'B discarded: no event copies the name');
select is(public.t_status(public.t_id('B')), 'descartado', 'B discarded: the status is unchanged');
select is(public.t_resp(public.t_id('B'), 'Colectivo Nuevo', true), 'FT409|dossier_closed', 'B discarded: setting a new name is FT409 dossier_closed');
select is(public.t_name(public.t_id('B')), '<null>', 'B discarded: the blocked name was not saved');

-- 6. Hidden publication C (dossier still open)
insert into ctx select 'nevC', null, to_jsonb(public.t_nev(public.t_id('C')));
select is(public.t_resp(public.t_id('C'), null, false)::jsonb ->> 'hasResponsible', 'false', 'C hidden: the coordinator withdraws the responsible');
select is(public.t_name(public.t_id('C')), '<null>', 'C hidden: responsible_name is NULL');
select is(public.t_authz(public.t_id('C')), false, 'C hidden: responsible_authorized is false');
select is(public.t_nev(public.t_id('C')), (select (doc #>> '{}')::integer + 1 from ctx where name = 'nevC'), 'C hidden: exactly one event was added');
select is(public.t_lastkind(public.t_id('C')), 'responsible_changed', 'C hidden: the new event is responsible_changed');
select is(public.t_leak(public.t_id('C'), 'Colectivo Gamma'), 0, 'C hidden: no event copies the name');
select is(public.t_resp(public.t_id('C'), 'Colectivo Nuevo', true), 'FT409|publication_hidden', 'C hidden: setting a new name is FT409 publication_hidden');
select is(public.t_name(public.t_id('C')), '<null>', 'C hidden: the blocked name was not saved');

reset role;
select * from finish();
rollback;
