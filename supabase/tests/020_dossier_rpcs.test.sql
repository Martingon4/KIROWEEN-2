begin;

select plan(217);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction). They run as the calling role
-- unless declared SECURITY DEFINER (read-only fingerprints of the locked-down tables).
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
create function public.t_doc(p text) returns jsonb language sql stable as $$ select doc from ctx where name = p $$;
-- Last 8 hex characters are unique per user: the generated profile alias uses them.
create function public.t_uid(p text) returns text language sql immutable as
$$ select '99020000-0000-4000-8000-0000' || lpad(p, 8, '0') $$;
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
  perform public.t_as('20000002');
  v_pub := public.t_pub(p_name, p_x);
  perform public.t_as('20000001');
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
    'requests', (select pg_catalog.count(*) from public.mutation_requests as r where r.actor_id::text like '99020000-%'))
$$;

-- 1. Setup (as postgres)
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from unnest(array['20000001', '20000002', '20000003', '20000004', '20000005']) as n;
insert into public.sites (id, slug, name_es, name_en, locality_es, locality_en, timezone, currency, metric_srid, completeness, published)
values (public.t_uid('20005a00')::uuid, 'sitio-prueba-20', 'Sitio', 'Site', 'Localidad', 'Locality', 'America/Mexico_City', 'MXN', 32614, 'partial', true);
insert into public.site_roles (site_id, user_id, role) values
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('20000001')::uuid, 'coordinator'),
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('20000005')::uuid, 'coordinator'),
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('20000003')::uuid, 'moderator'),
  (public.t_uid('20005a00')::uuid, public.t_uid('20000004')::uuid, 'coordinator');
update public.profiles set public_alias = 'Coordinadora Veinte' where id = public.t_uid('20000001')::uuid;
update public.profiles set public_alias = 'Verificador Cinco' where id = public.t_uid('20000005')::uuid;

insert into ctx select 'defscenario', null, jsonb_build_object('slug', a.slug)
from public.analysis_scenarios as a where a.site_id = '8f5a6417-5f6d-4f02-a50c-76d97167db99' and a.is_default limit 1;
set local role authenticated;
select public.t_as('20000001');
select public.t_new('DS', -98.19775);
insert into ctx select 'MS', (public.add_milestone(public.t_id('DS'), 'Hito inicial', '2027-01-01', gen_random_uuid()::text, repeat('a', 64)) ->> 'milestoneId')::uuid, null;
insert into ctx select 'ES', (public.add_evidence(public.t_id('DS'), 'https://colectivo.example.org/x', 'Titulo', 'Descripcion', '2024-01-01', gen_random_uuid()::text, repeat('a', 64)) ->> 'evidenceId')::uuid, null;
select public.t_as('20000002');
insert into ctx select 'pubX', public.t_pub('Dossier rpc unpromoted', -98.19700), null;
insert into ctx select 'pA', public.t_pub('Promote A', -98.19710), null;
insert into ctx select 'pB', public.t_pub('Promote B', -98.19720), null;
insert into ctx select 'pC', public.t_pub('Promote C', -98.19730), null;
insert into ctx select 'pD', public.t_pub('Promote D', -98.19740), null;
insert into ctx select 'pH', public.t_pub('Promote hidden', -98.19750), null;
insert into ctx select 'pV', public.t_pub('Promote validation', -98.19760), null;

-- 2. Permission sweep: nothing changes and every denial looks the same.
select public.t_as('20000001');
insert into ctx select 'fp0', null, public.t_fp(public.t_id('DS'), public.t_id('pubX'));
select is(public.t_deny(u.u, c.sql), case when u.u = 'none' then '28000|authentication_required|' else c.expected end,
  c.label || ' as ' || u.label)
from (values
  ('participant without role', '20000002'), ('moderator only', '20000003'),
  ('coordinator of another site', '20000004'), ('no session', 'none')) as u (label, u)
cross join (values
  (1, 'promote_dossier', $q$select public.promote_dossier(public.t_id('pubX'), 'nota', null, false, null, gen_random_uuid()::text, repeat('a', 64))$q$, 'P0002|publication_not_found|'),
  (2, 'set_dossier_responsible', $q$select public.set_dossier_responsible(public.t_id('DS'), 'Colectivo', true, gen_random_uuid()::text, repeat('a', 64))$q$, 'P0002|dossier_not_found|'),
  (3, 'add_milestone', $q$select public.add_milestone(public.t_id('DS'), 'Hito', '2027-01-01', gen_random_uuid()::text, repeat('a', 64))$q$, 'P0002|dossier_not_found|'),
  (4, 'update_milestone', $q$select public.update_milestone(public.t_id('MS'), 'pendiente', 'Hito', '2027-01-01', 'cumplido', gen_random_uuid()::text, repeat('a', 64))$q$, 'P0002|dossier_not_found|'),
  (5, 'add_evidence', $q$select public.add_evidence(public.t_id('DS'), 'https://colectivo.example.org/y', 'Titulo', 'Descripcion', '2024-01-01', gen_random_uuid()::text, repeat('a', 64))$q$, 'P0002|dossier_not_found|'),
  (6, 'set_evidence_verified', $q$select public.set_evidence_verified(public.t_id('ES'), true)$q$, 'P0002|dossier_not_found|'),
  (7, 'transition_dossier', $q$select public.transition_dossier(public.t_id('DS'), 'en_revision', 'descartado', 'Razon', null, null, null, gen_random_uuid()::text, repeat('a', 64))$q$, 'P0002|dossier_not_found|'),
  (8, 'revert_last_status_change', $q$select public.revert_last_status_change(public.t_id('DS'), 'en_revision', 'Nota', gen_random_uuid()::text, repeat('a', 64))$q$, 'P0002|dossier_not_found|'),
  (9, 'get_managed_dossier', $q$select public.get_managed_dossier(public.t_id('DS'))$q$, 'P0002|dossier_not_found|')
) as c (n, label, sql, expected);
select public.t_as('20000001');
insert into ctx select 'fp1', null, public.t_fp(public.t_id('DS'), public.t_id('pubX'));
select is(public.t_doc('fp1'), public.t_doc('fp0'), 'the denied calls changed nothing (dossier, events, milestones, evidence, links, ledger)');
select is(public.t_npub(public.t_id('pubX')), 0, 'no dossier was created for the unpromoted publication');
select is(public.t_man(public.t_id('DS')) ->> 'status', 'en_revision', 'the coordinator still reads the dossier');

-- 3. promote_dossier
insert into ctx select 'r1', null, public.t_pro(public.t_id('pA'), 'Nota original', null, false, null, 'prom-a-key-01', repeat('1', 64))::jsonb;
insert into ctx select 'dA', (public.t_doc('r1') ->> 'dossierId')::uuid, null;
select is(public.t_doc('r1') -> 'created', 'true'::jsonb, 'promote creates the dossier');
select is(public.t_kinds(public.t_id('dA')), 'promoted', 'promote appends exactly one promoted event');
select is(public.t_sd(public.t_id('dA')) ->> 'status', 'en_revision', 'new dossier is en_revision');
select is(public.t_sd(public.t_id('dA')) ->> 'scenario_slug',
  (select doc ->> 'slug' from ctx where name = 'defscenario'),
  'scenario_slug is the default scenario of the site');
select is(public.t_sd(public.t_id('dA')) ->> 'responsible_name', null, 'responsible name is optional');
select is(public.t_sd(public.t_id('dA')) ->> 'responsible_authorized', 'false', 'no responsible means no authorization');
select is(public.t_sd(public.t_id('dA')) ->> 'last_event_seq', '1', 'last_event_seq is 1');
select is(public.t_sd(public.t_id('dA')) ->> 'created_by', public.t_uid('20000001'), 'created_by is the coordinator');
select is(public.t_sd(public.t_id('dA')) ->> 'decision_note', 'Nota original', 'decision note stored');
select is(public.t_pro(public.t_id('pA'), 'Nota original', null, false, null, 'prom-a-key-01', repeat('1', 64))::jsonb, public.t_doc('r1'), 'replay with the same key and payload returns the identical json');
select is(public.t_cnt(public.t_id('dA'), 'events'), 1, 'the replay added no event');
select is(public.t_pro(public.t_id('pA'), 'Otra nota', null, false, null, 'prom-a-key-01', repeat('2', 64)), 'FT001|idempotency_key_reused|', 'same key with a different payload is rejected (FT001)');
select is(public.t_pro(public.t_id('pA'), 'Otra nota', null, false, null, 'prom-a-key-02', repeat('2', 64))::jsonb,
  jsonb_build_object('dossierId', public.t_id('dA'), 'created', false), 'a different key on the same publication returns created:false and the same dossier');
select is(public.t_sd(public.t_id('dA')) ->> 'decision_note', 'Nota original', 'the original decision note is kept');
select is(public.t_cnt(public.t_id('dA'), 'events'), 1, 'the second promotion added no event');
select is(public.t_npub(public.t_id('pA')), 1, 'exactly one dossier exists for the publication');
insert into ctx select 'rB', null, public.t_pro(public.t_id('pB'), 'Nota B', 'Colectivo Plaza Viva', true, '2027-03-01')::jsonb;
insert into ctx select 'dB', (public.t_doc('rB') ->> 'dossierId')::uuid, null;
select is(public.t_sd(public.t_id('dB')) ->> 'responsible_name', 'Colectivo Plaza Viva', 'authorized responsible name stored');
select is(public.t_sd(public.t_id('dB')) ->> 'responsible_authorized', 'true', 'authorization stored');
select is(public.t_sd(public.t_id('dB')) ->> 'target_date', '2027-03-01', 'target date stored');
select is(public.t_man(public.t_id('dB')) ->> 'responsibleName', 'Colectivo Plaza Viva', 'the coordinator view shows the responsible name');
select is(public.t_pro(public.t_id('pC'), 'x')::jsonb -> 'created', 'true'::jsonb, 'a decision note of 1 char is accepted');
select is(public.t_pro(public.t_id('pD'), repeat('x', 1000))::jsonb -> 'created', 'true'::jsonb, 'a decision note of 1000 chars is accepted');
select is(public.t_pro(public.t_id('pV'), c.note, c.name, c.auth, c.target, c.key, c.hash), '22023|invalid_dossier_request|', 'promote rejects ' || c.label)
from (values
  ('an empty note', '', null, false, null, 'prom-v-key-01', repeat('a', 64)),
  ('a note of 1001 chars', repeat('x', 1001), null, false, null, 'prom-v-key-01', repeat('a', 64)),
  ('a null note', null, null, false, null, 'prom-v-key-01', repeat('a', 64)),
  ('a note that is not plain text', ' nota', null, false, null, 'prom-v-key-01', repeat('a', 64)),
  ('a name without authorization', 'Nota', 'Colectivo', false, null, 'prom-v-key-01', repeat('a', 64)),
  ('a name with a null authorization', 'Nota', 'Colectivo', null, null, 'prom-v-key-01', repeat('a', 64)),
  ('a name with @', 'Nota', 'a@b.org', true, null, 'prom-v-key-01', repeat('a', 64)),
  ('an empty name', 'Nota', '', true, null, 'prom-v-key-01', repeat('a', 64)),
  ('a name of 101 chars', 'Nota', repeat('n', 101), true, null, 'prom-v-key-01', repeat('a', 64)),
  ('a target date before 2000', 'Nota', null, false, '1999-12-31', 'prom-v-key-01', repeat('a', 64)),
  ('a target date after 2100', 'Nota', null, false, '2100-01-02', 'prom-v-key-01', repeat('a', 64)),
  ('a 7-char idempotency key', 'Nota', null, false, null, 'short12', repeat('a', 64)),
  ('an uppercase payload hash', 'Nota', null, false, null, 'prom-v-key-01', repeat('A', 64))
) as c (label, note, name, auth, target, key, hash);
select is(public.t_npub(public.t_id('pV')), 0, 'the validation publication has no dossier');
select is(public.t_pro(gen_random_uuid(), 'Nota'), 'P0002|publication_not_found|', 'unknown publication gives P0002');
reset role;
update public.publications set moderation_state = 'hidden' where id = public.t_id('pH');
set local role authenticated;
select public.t_as('20000001');
select is(public.t_pro(public.t_id('pH'), 'Nota'), 'P0002|publication_not_found|', 'hidden publication gives P0002');
select is(public.t_npub(public.t_id('pH')), 0, 'no dossier for the hidden publication');

-- 4. set_dossier_responsible
select public.t_new('DR', -98.19601);
select is(public.t_resp(public.t_id('DR'), 'Colectivo Uno', true, 'resp-key-0001', repeat('1', 64))::jsonb ->> 'hasResponsible', 'true', 'set the responsible');
select is(public.t_sd(public.t_id('DR')) ->> 'responsible_name', 'Colectivo Uno', 'responsible name stored');
select is(public.t_sd(public.t_id('DR')) ->> 'responsible_authorized', 'true', 'authorization stored');
select is(public.t_man(public.t_id('DR')) ->> 'responsibleName', 'Colectivo Uno', 'managed view shows the name');
select is(public.t_resp(public.t_id('DR'), 'Colectivo Uno', true, 'resp-key-0001', repeat('1', 64))::jsonb ->> 'hasResponsible', 'true', 'replay returns the same result');
select is(public.t_kinds(public.t_id('DR')), 'promoted,responsible_changed', 'replay added no event');
select is(public.t_resp(public.t_id('DR'), 'Otro', true, 'resp-key-0001', repeat('2', 64)), 'FT001|idempotency_key_reused|', 'same key, different payload: FT001');
select is(public.t_resp(public.t_id('DR'), 'Colectivo Dos', true)::jsonb ->> 'hasResponsible', 'true', 'replace the responsible');
select is(public.t_man(public.t_id('DR')) ->> 'responsibleName', 'Colectivo Dos', 'managed view shows the new name');
select is(public.t_resp(public.t_id('DR'), null, false)::jsonb ->> 'hasResponsible', 'false', 'remove the responsible with null');
select is(public.t_sd(public.t_id('DR')) ->> 'responsible_name', null, 'name removed');
select is(public.t_sd(public.t_id('DR')) ->> 'responsible_authorized', 'false', 'authorization cleared with the name');
select is(public.t_man(public.t_id('DR')) ->> 'responsibleName', null, 'managed view has no name after removal');
select is(public.t_kinds(public.t_id('DR')), 'promoted,responsible_changed,responsible_changed,responsible_changed', 'each change appends one responsible_changed event');
select is((public.t_man(public.t_id('DR')) -> 'events')::text ~ 'Colectivo', false, 'no event carries the responsible name');
select is(public.t_resp(public.t_id('DR'), c.name, c.auth), '22023|invalid_dossier_request|', 'set_dossier_responsible rejects ' || c.label)
from (values
  ('a name without authorization', 'Colectivo', false), ('a name with @', 'a@b.org', true),
  ('an empty name', '', true), ('a name of 101 chars', repeat('n', 101), true),
  ('a name that is not plain text', ' Colectivo', true)) as c (label, name, auth);

-- 5. add_milestone
select public.t_new('DM', -98.19602);
select is(public.t_addms(public.t_id('DM'), 'Hito 1', '2027-01-01', 'mile-key-0001', repeat('1', 64))::jsonb ->> 'position', '1', 'first milestone has position 1');
select is(public.t_addms(public.t_id('DM'), 'Hito 1', '2027-01-01', 'mile-key-0001', repeat('1', 64))::jsonb ->> 'position', '1', 'replay returns position 1 again');
select is(public.t_cnt(public.t_id('DM'), 'milestones'), 1, 'replay did not add a milestone');
select is(public.t_addms(public.t_id('DM'), 'Otro', '2027-01-01', 'mile-key-0001', repeat('2', 64)), 'FT001|idempotency_key_reused|', 'same key, different payload: FT001');
select is(public.t_addms(public.t_id('DM'), c.title, c.dt), '22023|invalid_milestone_request|', 'add_milestone rejects ' || c.label)
from (values
  ('an empty title', '', '2027-01-01'), ('a title of 101 chars', repeat('t', 101), '2027-01-01'),
  ('a title that is not plain text', ' Hito', '2027-01-01'), ('a null date', 'Hito', null),
  ('a date before 2000', 'Hito', '1999-12-31'), ('a date after 2100', 'Hito', '2100-01-02')) as c (label, title, dt);
select public.t_addms(public.t_id('DM'), 'Hito ' || g, '2027-01-01') from generate_series(2, 20) as g;
select is((select string_agg(m ->> 'position', ',' order by (m ->> 'position')::int) from jsonb_array_elements(public.t_man(public.t_id('DM')) -> 'milestones') as m),
  (select string_agg(g::text, ',' order by g) from generate_series(1, 20) as g), 'positions run 1..20');
select is(public.t_addms(public.t_id('DM'), 'Hito 21', '2027-01-01'), 'FT422|too_many_milestones|', 'the 21st milestone is rejected');
select is(public.t_cnt(public.t_id('DM'), 'milestones'), 20, 'still 20 milestones');
select is(public.t_cnt(public.t_id('DM'), 'events'), 21, 'one event per milestone plus promoted');

-- 6. update_milestone
select public.t_new('DU', -98.19603);
insert into ctx select 'U1', (public.t_addms(public.t_id('DU'), 'Hito U1', '2027-01-01')::jsonb ->> 'milestoneId')::uuid, null;
insert into ctx select 'U2', (public.t_addms(public.t_id('DU'), 'Hito U2', '2027-01-02')::jsonb ->> 'milestoneId')::uuid, null;
select is(public.t_updms(public.t_id('U1'), 'cumplido', 'Hito U1', '2027-01-01', 'cancelado'), 'FT409|stale_milestone|pendiente', 'stale expected status: FT409 with the current status in DETAIL');
select is(public.t_updms(public.t_id('U1'), 'pendiente', 'Hito U1', '2027-01-01', 'cumplido', 'updm-key-0001', repeat('1', 64))::jsonb ->> 'status', 'cumplido', 'pendiente -> cumplido');
select is(public.t_updms(public.t_id('U1'), 'pendiente', 'Hito U1', '2027-01-01', 'cumplido', 'updm-key-0001', repeat('1', 64))::jsonb ->> 'status', 'cumplido', 'replay returns the same result');
select is(public.t_updms(public.t_id('U1'), 'pendiente', 'Hito U1', '2027-01-01', 'cancelado', 'updm-key-0001', repeat('2', 64)), 'FT001|idempotency_key_reused|', 'same key, different payload: FT001');
select is(public.t_kinds(public.t_id('DU')), 'promoted,milestone_added,milestone_added,milestone_updated', 'one milestone_updated event (replay added none)');
select is(public.t_updms(public.t_id('U1'), 'pendiente', 'Hito U1', '2027-01-01', 'cancelado'), 'FT409|stale_milestone|cumplido', 'stale after the change reports cumplido');
select is(public.t_updms(public.t_id('U1'), 'cumplido', 'Hito U1', '2027-01-01', 'pendiente')::jsonb ->> 'status', 'pendiente', 'cumplido -> pendiente');
select is(public.t_updms(public.t_id('U1'), 'pendiente', 'Nuevo titulo', '2027-02-02', 'pendiente')::jsonb ->> 'status', 'pendiente', 'title and date edit with the same status');
select is((select m ->> 'title' || ' ' || (m ->> 'targetDate') from jsonb_array_elements(public.t_man(public.t_id('DU')) -> 'milestones') as m where m ->> 'position' = '1'), 'Nuevo titulo 2027-02-02', 'the edit is visible');
select is(public.t_updms(public.t_id('U1'), 'pendiente', 'Nuevo titulo', '2027-02-02', 'cancelado')::jsonb ->> 'status', 'cancelado', 'pendiente -> cancelado');
select is(public.t_updms(public.t_id('U1'), 'cancelado', 'Nuevo titulo', '2027-02-02', s), 'FT422|milestone_transition_not_allowed|', 'cancelado is terminal: to ' || s)
from unnest(array['pendiente', 'cumplido', 'cancelado']) as s;
select is(public.t_updms(public.t_id('U1'), 'pendiente', 'Nuevo titulo', '2027-02-02', 'cumplido'), 'FT409|stale_milestone|cancelado', 'stale on a cancelled milestone reports cancelado');
select is(public.t_updms(public.t_id('U2'), 'pendiente', 'Hito U2', '2027-01-02', 'cumplido')::jsonb ->> 'status', 'cumplido', 'U2 pendiente -> cumplido');
select is(public.t_updms(public.t_id('U2'), 'cumplido', 'Hito U2', '2027-01-02', 'cancelado'), 'FT422|milestone_transition_not_allowed|', 'cumplido -> cancelado is not allowed');
select is(public.t_updms(gen_random_uuid(), 'pendiente', 'Hito', '2027-01-01', 'cumplido'), 'P0002|milestone_not_found|', 'unknown milestone: P0002');
select is(public.t_updms(public.t_id('U2'), 'cumplido', c.title, c.dt, c.st), '22023|invalid_milestone_request|', 'update_milestone rejects ' || c.label)
from (values ('an empty title', '', '2027-01-01', 'cumplido'), ('a null date', 'Hito', null, 'cumplido'),
  ('a null new status', 'Hito', '2027-01-01', null)) as c (label, title, dt, st);
select is((select count(*)::int from jsonb_array_elements(public.t_man(public.t_id('DU')) -> 'events') as e where e ->> 'kind' = 'milestone_updated'), 5, 'five milestone_updated events in total');

-- 7. add_evidence
select public.t_new('DE', -98.19604);
select is(public.t_addev(public.t_id('DE'), 'https://colectivo.example.org/a?b=c#d', 'Titulo', 'Descripcion', '2024-01-01', 'evid-key-0001', repeat('1', 64))::jsonb ->> 'position', '1', 'first evidence has position 1');
select is(public.t_addev(public.t_id('DE'), 'https://colectivo.example.org/a?b=c#d', 'Titulo', 'Descripcion', '2024-01-01', 'evid-key-0001', repeat('1', 64))::jsonb ->> 'position', '1', 'replay returns the same result');
select is(public.t_addev(public.t_id('DE'), 'https://colectivo.example.org/a?b=c#d', 'Otro', 'Descripcion', '2024-01-01', 'evid-key-0001', repeat('2', 64)), 'FT001|idempotency_key_reused|', 'same key, different payload: FT001');
select is(public.t_cnt(public.t_id('DE'), 'evidence'), 1, 'replay added no evidence');
select is(public.t_addev(public.t_id('DE'), 'https://otro.example.org/b', 'Segundo', 'Descripcion', '2024-01-02')::jsonb ->> 'position', '2', 'second evidence has position 2');
select is(public.t_man(public.t_id('DE')) -> 'evidence' -> 0 ->> 'recordedByAlias', 'Coordinadora Veinte', 'recordedByAlias is the public alias of the coordinator');
select is(public.t_man(public.t_id('DE')) -> 'evidence' -> 0 ->> 'host', 'colectivo.example.org', 'host is shown');
select is(public.t_man(public.t_id('DE')) -> 'evidence' -> 0 -> 'verifiedByTeam', 'false'::jsonb, 'new evidence is not verified');
select is(public.t_addev(public.t_id('DE'), u, 'Titulo', 'Descripcion', '2024-01-01'), 'FT422|invalid_evidence_url|', 'add_evidence rejects the URL ' || u)
from unnest(array['javascript:alert(1)', 'http://colectivo.example.org/a', 'https://a@b.com/x', 'https://localhost', 'ftp://colectivo.example.org/a', 'https://example.org/a b']) as u;
select is(public.t_addev(public.t_id('DE'), 'https://colectivo.example.org/z', c.title, c.descr, c.dt), '22023|invalid_evidence_request|', 'add_evidence rejects ' || c.label)
from (values ('an empty title', '', 'Descripcion', '2024-01-01'), ('an empty description', 'Titulo', '', '2024-01-01'),
  ('a description of 1001 chars', 'Titulo', repeat('d', 1001), '2024-01-01'), ('a null date', 'Titulo', 'Descripcion', null),
  ('a date before 2000', 'Titulo', 'Descripcion', '1999-12-31')) as c (label, title, descr, dt);
select is(public.t_addev(public.t_id('DE'), 'https://colectivo.example.org/f', 'Futuro', 'Descripcion',
  ((now() at time zone 'America/Mexico_City')::date + 1)::text), 'FT422|evidence_date_in_future|', 'tomorrow in the site time zone is in the future');
select is(public.t_addev(public.t_id('DE'), 'https://colectivo.example.org/f', 'Futuro', 'Descripcion', '2099-01-01'), 'FT422|evidence_date_in_future|', 'a far future date is rejected');
select is(public.t_addev(public.t_id('DE'), 'https://colectivo.example.org/h', 'Hoy', 'Descripcion',
  (now() at time zone 'America/Mexico_City')::date::text)::jsonb ->> 'position', '3', 'today in the site time zone is accepted');
select is(public.t_cnt(public.t_id('DE'), 'evidence'), 3, 'three evidence items so far');
select public.t_addev(public.t_id('DE'), 'https://colectivo.example.org/m' || g, 'Titulo ' || g, 'Descripcion', '2024-01-01') from generate_series(4, 50) as g;
select is(public.t_cnt(public.t_id('DE'), 'evidence'), 50, '50 evidence items');
select is(public.t_addev(public.t_id('DE'), 'https://colectivo.example.org/m51', 'Titulo 51', 'Descripcion', '2024-01-01'), 'FT422|too_many_evidence|', 'the 51st evidence item is rejected');
select is(public.t_cnt(public.t_id('DE'), 'evidence'), 50, 'still 50 after the rejection');
select is((select string_agg(e ->> 'position', ',' order by (e ->> 'position')::int) from jsonb_array_elements(public.t_man(public.t_id('DE')) -> 'evidence') as e),
  (select string_agg(g::text, ',' order by g) from generate_series(1, 50) as g), 'evidence positions run 1..50');

-- 8. set_evidence_verified
select public.t_new('DV', -98.19605);
insert into ctx select 'V1', (public.t_addev(public.t_id('DV'), 'https://colectivo.example.org/v', 'Titulo', 'Descripcion', '2024-01-01')::jsonb ->> 'evidenceId')::uuid, null;
select is(public.t_ver(public.t_id('V1'), true)::jsonb ->> 'verified', 'true', 'verify');
select is(public.t_man(public.t_id('DV')) -> 'evidence' -> 0 -> 'verifiedByTeam', 'true'::jsonb, 'verifiedByTeam is true');
select is(public.t_man(public.t_id('DV')) -> 'evidence' -> 0 ->> 'verifiedByAlias', 'Coordinadora Veinte', 'verifiedByAlias is the verifier alias');
select isnt(public.t_man(public.t_id('DV')) -> 'evidence' -> 0 ->> 'verifiedAt', null, 'verifiedAt is set');
select is(public.t_kinds(public.t_id('DV')), 'promoted,evidence_added,evidence_verified', 'verification appended one event');
select is(public.t_ver(public.t_id('V1'), true)::jsonb ->> 'verified', 'true', 'verifying again succeeds');
select is(public.t_kinds(public.t_id('DV')), 'promoted,evidence_added,evidence_verified', 'repeat verification adds no event');
select public.t_as('20000005');
select is(public.t_ver(public.t_id('V1'), false)::jsonb ->> 'verified', 'false', 'a second coordinator unverifies');
select is(public.t_man(public.t_id('DV')) -> 'evidence' -> 0 -> 'verifiedByTeam', 'false'::jsonb, 'verifiedByTeam is false');
select is(public.t_man(public.t_id('DV')) -> 'evidence' -> 0 ->> 'verifiedByAlias', null, 'no verifier alias after unverify');
select is(public.t_ver(public.t_id('V1'), false)::jsonb ->> 'verified', 'false', 'unverifying again succeeds');
select is(public.t_kinds(public.t_id('DV')), 'promoted,evidence_added,evidence_verified,evidence_verified', 'repeat unverify adds no event');
select is(public.t_ver(public.t_id('V1'), true)::jsonb ->> 'verified', 'true', 'verify by the second coordinator');
select is(public.t_man(public.t_id('DV')) -> 'evidence' -> 0 ->> 'verifiedByAlias', 'Verificador Cinco', 'verifiedByAlias follows the verifier');
select is(public.t_man(public.t_id('DV')) -> 'evidence' -> 0 ->> 'recordedByAlias', 'Coordinadora Veinte', 'recordedByAlias is unchanged');
select is(public.t_ver(gen_random_uuid(), true), 'P0002|evidence_not_found|', 'unknown evidence: P0002');
select is(public.t_call(format('select public.set_evidence_verified(%L::uuid, null)', public.t_id('V1'))), '22023|invalid_evidence_request|', 'null verified flag: 22023');
select public.t_as('20000001');

-- 9. Closed dossiers
select public.t_new('DC1', -98.19606);
select public.t_new('DC2', -98.19607);
select public.t_path('DC1', 'en_ejecucion');
select public.t_path('DC2', 'ejecutado');
select is(public.t_tr(public.t_id('DC1'), 'en_ejecucion', 'descartado', 'Se descarta por falta de presupuesto')::jsonb ->> 'status', 'descartado', 'DC1 discarded');
select is(public.t_sd(public.t_id('DC2')) ->> 'status', 'ejecutado', 'DC2 is ejecutado');
select is(public.t_call(c.sql), 'FT409|dossier_closed|', c.label || ' is blocked on ' || c.d)
from (values
  ('DC1', 'set_dossier_responsible', $q$select public.t_resp(public.t_id('DC1'), 'Otro', true)$q$),
  ('DC1', 'add_milestone', $q$select public.t_addms(public.t_id('DC1'), 'Hito', '2027-01-01')$q$),
  ('DC1', 'update_milestone', $q$select public.t_updms(public.t_id('DC1_m1'), 'pendiente', 'Hito', '2027-01-01', 'cumplido')$q$),
  ('DC1', 'add_evidence', $q$select public.t_addev(public.t_id('DC1'), 'https://colectivo.example.org/n', 'T', 'D', '2024-01-01')$q$),
  ('DC1', 'transition_dossier', $q$select public.t_tr(public.t_id('DC1'), 'descartado', 'planeado', 'Nota')$q$),
  ('DC2', 'set_dossier_responsible', $q$select public.t_resp(public.t_id('DC2'), 'Otro', true)$q$),
  ('DC2', 'add_milestone', $q$select public.t_addms(public.t_id('DC2'), 'Hito', '2027-01-01')$q$),
  ('DC2', 'update_milestone', $q$select public.t_updms(public.t_id('DC2_m1'), 'pendiente', 'Hito', '2027-01-01', 'cumplido')$q$),
  ('DC2', 'add_evidence', $q$select public.t_addev(public.t_id('DC2'), 'https://colectivo.example.org/n', 'T', 'D', '2024-01-01')$q$),
  ('DC2', 'transition_dossier', $q$select public.t_tr(public.t_id('DC2'), 'ejecutado', 'descartado', 'Nota')$q$)
) as c (d, label, sql);
select is(public.t_ver(public.t_id('DC2_e1'), true)::jsonb ->> 'verified', 'true', 'set_evidence_verified still works on an ejecutado dossier');
select is(public.t_ver(public.t_id('DC1_e1'), true)::jsonb ->> 'verified', 'true', 'set_evidence_verified still works on a descartado dossier');
select is(public.t_rev(public.t_id('DC1'), 'descartado', 'Se registro por error')::jsonb ->> 'status', 'en_ejecucion', 'revert works on a descartado dossier');
select is(public.t_rev(public.t_id('DC2'), 'ejecutado', 'Se registro por error')::jsonb ->> 'status', 'en_ejecucion', 'revert works on an ejecutado dossier');
select is(public.t_sd(public.t_id('DC1')) ->> 'status', 'en_ejecucion', 'DC1 reopened');
select is(public.t_addms(public.t_id('DC1'), 'Hito nuevo', '2027-01-01')::jsonb ->> 'position', '2', 'a reopened dossier accepts writes again');

-- 10. Hidden publication
select public.t_new('DH', -98.19608);
select public.t_path('DH', 'en_ejecucion');
reset role;
update public.publications set moderation_state = 'hidden' where id = public.t_id('DH_pub');
set local role authenticated;
select public.t_as('20000001');
select is(public.t_call(c.sql), 'FT409|publication_hidden|', c.label || ' is blocked for the coordinator while the publication is hidden')
from (values
  ('set_dossier_responsible', $q$select public.t_resp(public.t_id('DH'), 'Otro', true)$q$),
  ('add_milestone', $q$select public.t_addms(public.t_id('DH'), 'Hito', '2027-01-01')$q$),
  ('update_milestone', $q$select public.t_updms(public.t_id('DH_m1'), 'pendiente', 'Hito', '2027-01-01', 'cumplido')$q$),
  ('add_evidence', $q$select public.t_addev(public.t_id('DH'), 'https://colectivo.example.org/n', 'T', 'D', '2024-01-01')$q$),
  ('set_evidence_verified', $q$select public.t_ver(public.t_id('DH_e1'), true)$q$),
  ('transition_dossier', $q$select public.t_tr(public.t_id('DH'), 'en_ejecucion', 'descartado', 'Razon')$q$),
  ('revert_last_status_change', $q$select public.t_rev(public.t_id('DH'), 'en_ejecucion', 'Nota')$q$)
) as c (label, sql);
select is(public.t_man(public.t_id('DH')) ->> 'moderationState', 'hidden', 'the coordinator can still read the dossier and sees the hidden state');
select is(public.t_deny(u, format('select public.set_dossier_responsible(%L::uuid, %L, true, gen_random_uuid()::text, repeat(%L, 64))', public.t_id('DH'), 'Otro', 'a')), 'P0002|dossier_not_found|', 'hidden: ' || u || ' gets P0002')
from unnest(array['20000002', '20000004', '20000003']) as u;
select public.t_as('20000001');
set local role anon;
select is(public.public_dossier_exists(public.t_id('DH')), false, 'a hidden publication hides the public dossier');
select is(public.get_public_dossier(public.t_id('DH')), null, 'get_public_dossier returns null while hidden');
select is(public.public_dossier_exists(public.t_id('dA')), true, 'a visible dossier exists publicly');
set local role authenticated;
select public.t_as('20000001');

-- 11. Event cap (500)
select public.t_new('DX', -98.19609);
reset role;
insert into public.dossier_events (id, dossier_id, seq, kind, actor_id)
select gen_random_uuid(), public.t_id('DX'), g, 'responsible_changed', public.t_uid('20000001')::uuid from generate_series(2, 499) as g;
alter table public.dossiers disable trigger user;
update public.dossiers set last_event_seq = 499 where id = public.t_id('DX');
alter table public.dossiers enable trigger user;
set local role authenticated;
select public.t_as('20000001');
select is(public.t_cnt(public.t_id('DX'), 'events'), 499, 'DX holds 499 events');
select is(public.t_addms(public.t_id('DX'), 'Hito 500', '2027-01-01')::jsonb ->> 'position', '1', 'event 500 is accepted');
select is(public.t_sd(public.t_id('DX')) ->> 'last_event_seq', '500', 'last_event_seq is 500');
select is(public.t_addms(public.t_id('DX'), 'Hito 501', '2027-01-01'), 'FT422|event_limit_reached|', 'event 501: add_milestone is rejected');
select is(public.t_tr(public.t_id('DX'), 'en_revision', 'descartado', 'Razon'), 'FT422|event_limit_reached|', 'event 501: transition is rejected');
select is(public.t_resp(public.t_id('DX'), 'Colectivo', true), 'FT422|event_limit_reached|', 'event 501: set_dossier_responsible is rejected');
select is(public.t_cnt(public.t_id('DX'), 'milestones'), 1, 'the rejected calls rolled back completely');
select is(public.t_cnt(public.t_id('DX'), 'events'), 500, 'still 500 events');

reset role;
select * from finish();
rollback;
