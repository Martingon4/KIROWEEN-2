begin;

select plan(182);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction).
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
create function public.t_doc(p text) returns jsonb language sql stable as $$ select doc from ctx where name = p $$;
-- Last 8 characters are unique per user: the generated profile alias uses them.
create function public.t_uid(p text) returns text language sql immutable as
$$ select '99022000-0000-4000-8000-0000' || lpad(p, 8, '0') $$;
create function public.t_as(p text) returns text language sql as
$$ select set_config('request.jwt.claim.sub', case when p = 'none' then '' else public.t_uid(p) end, true) $$;
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
-- A publication with p_n trees, published by the current user.
create function public.t_pub(p_title text, p_x numeric, p_n integer default 1) returns uuid language plpgsql as $$
declare
  b uuid;
  r uuid;
begin
  b := (public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99', p_title, gen_random_uuid()::text, repeat('a', 64)) ->> 'branchId')::uuid;
  r := (public.save_revision(b, (public.get_branch_head(b) ->> 'revisionId')::uuid, 'Save',
    (select jsonb_agg(public.t_tree(gen_random_uuid()::text, p_x + i * 0.00002)) from generate_series(0, p_n - 1) as i),
    gen_random_uuid()::text, repeat('b', 64)) ->> 'revisionId')::uuid;
  return (public.publish_revision(r, 'Etiqueta', 'Resumen', gen_random_uuid()::text, repeat('c', 64)) ->> 'publicationId')::uuid;
end;
$$;
-- Publication by user 22000002 promoted by coordinator 22000001. Stores ctx p_name and p_name_pub.
create function public.t_new(p_name text, p_x numeric, p_n integer default 1) returns uuid language plpgsql as $$
declare
  v_pub uuid;
  v_d uuid;
  v_prev text := current_setting('request.jwt.claim.sub', true);
begin
  perform public.t_as('22000002');
  v_pub := public.t_pub(p_name, p_x, p_n);
  perform public.t_as('22000001');
  v_d := (public.promote_dossier(v_pub, 'Nota ' || p_name, null, false, null, gen_random_uuid()::text, repeat('a', 64)) ->> 'dossierId')::uuid;
  insert into ctx values (p_name, v_d, null), (p_name || '_pub', v_pub, null);
  perform set_config('request.jwt.claim.sub', v_prev, true);
  return v_d;
end;
$$;
create function public.t_pro(p_pub uuid, p_note text, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.promote_dossier(%L::uuid, %L, null, false, null, %L, %L)', p_pub, p_note, p_key, p_hash))
$$;
create function public.t_resp(p_d uuid, p_name text, p_auth boolean, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.set_dossier_responsible(%L::uuid, %L, %L::boolean, %L, %L)', p_d, p_name, p_auth, p_key, p_hash))
$$;
create function public.t_addms(p_d uuid, p_title text, p_date text, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
returns text language sql as $$
  select public.t_call(format('select public.add_milestone(%L::uuid, %L, %L::date, %L, %L)', p_d, p_title, p_date, p_key, p_hash))
$$;
create function public.t_addev(p_d uuid, p_url text, p_title text, p_desc text, p_date text, p_key text default gen_random_uuid()::text, p_hash text default repeat('a', 64))
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
create function public.t_pd(p_d uuid) returns jsonb language sql as $$ select public.get_public_dossier(p_d) $$;
-- Every object key anywhere in a document.
create function public.t_keys(p_doc jsonb) returns setof text language sql immutable as $$
  select distinct k
  from jsonb_path_query(p_doc, 'strict $.**') as v
  cross join lateral jsonb_object_keys(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) as k
$$;
-- Calls that list public dossiers.
create function public.t_list(p_site uuid, p_ts text, p_id uuid, p_limit integer) returns text language sql as $$
  select public.t_call(format('select public.list_public_dossiers(%L::uuid, %L::timestamptz, %L::uuid, %L::integer)', p_site, p_ts, p_id, p_limit))
$$;

-- Privileged helpers (owner postgres): moderation, site publication, ordering, DDL probes.
create function public.t_mod(p_pub uuid, p_state text) returns void language sql security definer set search_path = '' as $$
  update public.publications set moderation_state = p_state::public.publication_moderation_state where id = p_pub
$$;
create function public.t_sitepub(p_site uuid, p_pub boolean) returns void language sql security definer set search_path = '' as $$
  update public.sites set published = p_pub where id = p_site
$$;
create function public.t_setupd(p_d uuid, p_ts timestamptz) returns void language plpgsql security definer set search_path = '' as $$
begin
  alter table public.dossiers disable trigger user;
  update public.dossiers set updated_at = p_ts where id = p_d;
  alter table public.dossiers enable trigger user;
end;
$$;
create function public.t_asp(p_sql text) returns text language plpgsql security definer set search_path = '' as $$
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
create function public.t_sd(p_d uuid) returns jsonb language sql security definer set search_path = '' as
$$ select pg_catalog.to_jsonb(d) from public.dossiers as d where d.id = p_d $$;
create function public.t_cnt(p_d uuid, p_what text) returns integer language sql security definer set search_path = '' as $$
  select case p_what
    when 'events' then (select pg_catalog.count(*)::integer from public.dossier_events as e where e.dossier_id = p_d)
    when 'milestones' then (select pg_catalog.count(*)::integer from public.dossier_milestones as m where m.dossier_id = p_d)
    when 'evidence' then (select pg_catalog.count(*)::integer from public.evidence_items as e where e.dossier_id = p_d)
    else -1 end
$$;
create function public.t_npub(p_pub uuid) returns integer language sql security definer set search_path = '' as
$$ select pg_catalog.count(*)::integer from public.dossiers as d where d.publication_id = p_pub $$;
create function public.t_nreq(p_actor text, p_key text) returns integer language sql security definer set search_path = '' as
$$ select pg_catalog.count(*)::integer from public.mutation_requests as r where r.actor_id::text = p_actor and r.idempotency_key = p_key $$;
create function public.t_fp(p_d uuid, p_pub uuid) returns jsonb language sql security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'dossier', (select pg_catalog.to_jsonb(d) from public.dossiers as d where d.id = p_d),
    'dossiersForPub', (select pg_catalog.count(*) from public.dossiers as d where d.publication_id = p_pub),
    'events', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.seq), '[]'::jsonb) from public.dossier_events as e where e.dossier_id = p_d),
    'milestones', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.position), '[]'::jsonb) from public.dossier_milestones as m where m.dossier_id = p_d),
    'evidence', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v) order by v.position), '[]'::jsonb) from public.evidence_items as v where v.dossier_id = p_d),
    'links', (select pg_catalog.count(*) from public.dossier_event_evidence as l where l.dossier_id = p_d),
    'requests', (select pg_catalog.count(*) from public.mutation_requests as r where r.actor_id::text like '99022000-%'))
$$;

-- 1. Setup (as postgres)
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from unnest(array['22000001', '22000002', '22000003', '22000004', '22000005', '22000006', '22000007', '22000008']) as n;
insert into public.sites (id, slug, name_es, name_en, locality_es, locality_en, timezone, currency, metric_srid, completeness, published)
values (public.t_uid('22005a00')::uuid, 'sitio-prueba-22', 'Sitio', 'Site', 'Localidad', 'Locality', 'America/Mexico_City', 'MXN', 32614, 'partial', true);
insert into public.site_roles (site_id, user_id, role) values
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('22000001')::uuid, 'coordinator'),
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('22000003')::uuid, 'coordinator'),
  ('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_uid('22000005')::uuid, 'moderator'),
  (public.t_uid('22005a00')::uuid, public.t_uid('22000006')::uuid, 'coordinator');

set local role authenticated;
select public.t_as('22000001');
select public.t_new('P', -98.19790, 2);
select public.t_as('22000002');
insert into ctx select 'pubX', public.t_pub('Reads unpromoted', -98.19780), null;

-- 2. get_public_dossier: a fresh dossier without a responsible
select public.t_as('none');
set local role anon;
insert into ctx select 'docAnon0', null, public.t_pd(public.t_id('P'));
set local role authenticated;
select public.t_as('22000004');
insert into ctx select 'docAuth0', null, public.t_pd(public.t_id('P'));
select isnt(public.t_doc('docAnon0'), null, 'anon reads the public dossier');
select is(public.t_doc('docAuth0'), public.t_doc('docAnon0'), 'authenticated and anon get the same document');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(public.t_doc('docAnon0')) as k),
  array['comparison', 'createdAt', 'decisionNote', 'dossierId', 'events', 'evidence', 'milestones', 'publication', 'publicationId', 'responsibleName', 'siteId', 'siteSlug', 'snapshot', 'status', 'supportCount', 'targetDate', 'updatedAt'],
  'the top-level keys are exactly the public contract');
select is(public.t_doc('docAnon0') -> 'responsibleName', 'null'::jsonb, 'no responsible: responsibleName is null');
select is(public.t_doc('docAnon0') ->> 'status', 'en_revision', 'a new dossier is en_revision');
select is(public.t_doc('docAnon0') ->> 'siteSlug', 'zocalo-puebla', 'siteSlug is the pilot');
select is(public.t_doc('docAnon0') ->> 'decisionNote', 'Nota P', 'decisionNote is public');

-- Build a rich dossier P as coordinator 1.
select public.t_as('22000001');
select is(public.t_resp(public.t_id('P'), 'Colectivo Plaza Viva', true)::jsonb ->> 'hasResponsible', 'true', 'P gets a responsible');
set local role anon;
select public.t_as('none');
select is(public.t_pd(public.t_id('P')) ->> 'responsibleName', 'Colectivo Plaza Viva', 'an authorized name is public');
set local role authenticated;
select public.t_as('22000001');
select is(public.t_resp(public.t_id('P'), null, false)::jsonb ->> 'hasResponsible', 'false', 'the responsible is withdrawn');
select is(public.t_pd(public.t_id('P')) -> 'responsibleName', 'null'::jsonb, 'withdrawn: responsibleName is null again');
select is(public.t_man(public.t_id('P')) -> 'responsibleName', 'null'::jsonb, 'withdrawn: the managed read has no name either');
select is(public.t_sd(public.t_id('P')) ->> 'responsible_name', null, 'withdrawn: the name is gone from storage');
select public.t_resp(public.t_id('P'), 'Colectivo Plaza Viva', true);
insert into ctx select 'P_m1', (public.t_addms(public.t_id('P'), 'Reunion con vecinos', '2027-01-15')::jsonb ->> 'milestoneId')::uuid, null;
select is(public.t_tr(public.t_id('P'), 'en_revision', 'planeado', 'Plan aprobado')::jsonb ->> 'status', 'planeado', 'P is planeado');
insert into ctx select 'P_e1', (public.t_addev(public.t_id('P'), 'https://colectivo.example.org/acta', 'Acta de inicio', 'Acta firmada', '2024-01-01')::jsonb ->> 'evidenceId')::uuid, null;
insert into ctx select 'P_e2', (public.t_addev(public.t_id('P'), 'https://colectivo.example.org/fotos', 'Fotos', 'Fotos del sitio', '2024-01-02')::jsonb ->> 'evidenceId')::uuid, null;
select is(public.t_tr(public.t_id('P'), 'planeado', 'en_ejecucion', 'Inicio de obra', null, null, array[public.t_id('P_e1')])::jsonb ->> 'status', 'en_ejecucion', 'P started');
select public.t_as('22000003');
select is(public.t_ver(public.t_id('P_e1'), true)::jsonb ->> 'verified', 'true', 'coordinator 3 verifies P_e1');
select public.t_as('22000001');

-- Document without secrets
insert into ctx select 'docP', null, public.t_pd(public.t_id('P'));
select is((select count(*)::int from public.t_keys(public.t_doc('docP')) as k
  where k in ('actor_id', 'author_id', 'email', 'user_id', 'recorded_by', 'created_by', 'verified_by',
              'actorId', 'authorId', 'userId', 'recordedBy', 'createdBy', 'verifiedBy', 'published_by', 'publishedBy')), 0,
  'no account key appears anywhere in the public document');
select ok((select count(*) from public.t_keys(public.t_doc('docP')) as k where k in ('actorAlias', 'recordedByAlias', 'verifiedByAlias', 'seq', 'amountLowCents')) = 5,
  'the walker sees nested keys (alias, seq, cost lines): the key check is not vacuous');
select is((select string_agg(v #>> '{}', ' ## ') from jsonb_path_query(public.t_doc('docP'), 'strict $.**') as v where jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}'), null,
  'no string value in the document looks like an email address (version labels like pkg@1.9.0 are not addresses)');
select is(position('99022000-0000-4000-8000' in public.t_doc('docP')::text), 0, 'no test account id appears in the document');
select is((select count(*)::int from jsonb_path_query(public.t_doc('docP'), 'strict $.events[*].actorAlias') as a where a #>> '{}' !~ '^participant-[0-9a-f]{8}$'), 0,
  'every event actorAlias is a public alias');
select is((select count(*)::int from jsonb_path_query(public.t_doc('docP'), 'strict $.evidence[*].recordedByAlias') as a where a #>> '{}' !~ '^participant-[0-9a-f]{8}$'), 0,
  'every evidence recordedByAlias is a public alias');
select is((select array_agg(distinct e ->> 'actorAlias' order by e ->> 'actorAlias') from jsonb_array_elements(public.t_doc('docP') -> 'events') as e),
  array['participant-22000001', 'participant-22000003'], 'the aliases are the generated ones of coordinators 1 and 3');
select is((select e ->> 'verifiedByAlias' from jsonb_array_elements(public.t_doc('docP') -> 'evidence') as e where e ->> 'id' = public.t_id('P_e1')::text),
  'participant-22000003', 'a verified item names the verifier alias');
select is((select e -> 'verifiedByAlias' from jsonb_array_elements(public.t_doc('docP') -> 'evidence') as e where e ->> 'id' = public.t_id('P_e2')::text),
  'null'::jsonb, 'an unverified item has no verifier');
select is((select e -> 'verifiedAt' from jsonb_array_elements(public.t_doc('docP') -> 'evidence') as e where e ->> 'id' = public.t_id('P_e2')::text),
  'null'::jsonb, 'an unverified item has no verifiedAt');
select is((select e ->> 'verifiedByTeam' from jsonb_array_elements(public.t_doc('docP') -> 'evidence') as e where e ->> 'id' = public.t_id('P_e1')::text), 'true', 'P_e1 is verified by the team');
select cmp_ok(jsonb_array_length(public.t_doc('docP') #> '{snapshot,cost,lines}'), '>', 0, 'the snapshot cost has lines');
select is((public.t_doc('docP') #>> '{snapshot,cost,totalLowCents}')::numeric,
  (select coalesce(sum((l ->> 'amountLowCents')::numeric), 0) from jsonb_array_elements(public.t_doc('docP') #> '{snapshot,cost,lines}') as l),
  'snapshot.cost.totalLowCents equals the sum of the lines amountLowCents');
select is((public.t_doc('docP') #>> '{comparison,counts,added}')::int, 2, 'comparison.counts.added equals the number of features (2)');
select is((select string_agg(e ->> 'seq', ',' order by (e ->> 'seq')::int) from jsonb_array_elements(public.t_doc('docP') -> 'events') as e),
  (select string_agg(g::text, ',' order by g) from generate_series(1, public.t_cnt(public.t_id('P'), 'events')) as g), 'events are contiguous from seq 1');
select is((select e ->> 'kind' from jsonb_array_elements(public.t_doc('docP') -> 'events') as e order by (e ->> 'seq')::int limit 1), 'promoted', 'the promoted event is first');
select is((select jsonb_agg(e ->> 'seq' order by ord) from jsonb_array_elements(public.t_doc('docP') -> 'events') with ordinality as t(e, ord)),
  (select jsonb_agg(e ->> 'seq' order by (e ->> 'seq')::int) from jsonb_array_elements(public.t_doc('docP') -> 'events') as e), 'the events array is already ordered by seq');
select is((select string_agg(e ->> 'kind', ',' order by (e ->> 'seq')::int) from jsonb_array_elements(public.t_doc('docP') -> 'events') as e),
  'promoted,responsible_changed,responsible_changed,responsible_changed,milestone_added,status_change,evidence_added,evidence_added,status_change,evidence_verified',
  'the timeline kinds follow the operations');
select is(public.t_doc('docP') ->> 'supportCount', '0', 'no supports yet');

-- supportCount is context only
insert into ctx select 'fpP0', null, public.t_fp(public.t_id('P'), public.t_id('P_pub'));
select public.t_as('22000007');
select is(public.set_support(public.t_id('P_pub'), true) ->> 'count', '1', 'support 1');
select public.t_as('22000008');
select is(public.set_support(public.t_id('P_pub'), true) ->> 'count', '2', 'support 2');
select is(public.t_pd(public.t_id('P')) ->> 'supportCount', '2', 'supportCount reflects the supports');
select is(public.t_fp(public.t_id('P'), public.t_id('P_pub')) - 'requests', public.t_doc('fpP0') - 'requests', 'supports changed no dossier, event, milestone, or evidence row');
select is(public.t_pd(public.t_id('P')) - 'supportCount', public.t_doc('docP') - 'supportCount', 'the rest of the document is unchanged (status, events, updatedAt)');
select is(public.t_pd(public.t_id('P')) ->> 'status', 'en_ejecucion', 'status did not move');
select is(public.set_support(public.t_id('P_pub'), false) ->> 'count', '1', 'support withdrawn');
select is(public.t_pd(public.t_id('P')) ->> 'supportCount', '1', 'supportCount follows the withdrawal');
select is(public.t_pd(public.t_id('P')) - 'supportCount', public.t_doc('docP') - 'supportCount', 'still nothing else changed');

-- 3. get_publication_dossier, exists, list: visible
select public.t_as('22000001');
select is(public.public_dossier_exists(public.t_id('P')), true, 'public_dossier_exists is true for a visible dossier');
select is(public.public_dossier_exists(gen_random_uuid()), false, 'public_dossier_exists is false for an unknown id');
select is(public.get_publication_dossier(public.t_id('P_pub')), jsonb_build_object('dossierId', public.t_id('P'), 'canManage', true), 'coordinator: dossierId and canManage');
select public.t_as('22000004');
select is(public.get_publication_dossier(public.t_id('P_pub')), jsonb_build_object('dossierId', public.t_id('P'), 'canManage', false), 'participant: dossierId, canManage false');
select public.t_as('22000005');
select is(public.get_publication_dossier(public.t_id('P_pub')) ->> 'canManage', 'false', 'moderator cannot manage');
select public.t_as('22000006');
select is(public.get_publication_dossier(public.t_id('P_pub')) ->> 'canManage', 'false', 'coordinator of another site cannot manage');
select public.t_as('none');
set local role anon;
select is(public.get_publication_dossier(public.t_id('pubX')), jsonb_build_object('dossierId', null, 'canManage', false), 'anon, unpromoted visible publication: no dossier, cannot manage');
select is(public.get_publication_dossier(public.t_id('P_pub')), jsonb_build_object('dossierId', public.t_id('P'), 'canManage', false), 'anon, promoted publication: dossierId set, cannot manage');
select is(public.public_dossier_exists(public.t_id('P')), true, 'anon: exists');
select isnt(public.t_pd(public.t_id('P')), null, 'anon: document');
select is(public.t_pd(gen_random_uuid()), null, 'anon: unknown id gives null');
select is((select count(*)::int from jsonb_array_elements(public.list_public_dossiers('8f5a6417-5f6d-4f02-a50c-76d97167db99') -> 'items') as i where i ->> 'dossierId' = public.t_id('P')::text), 1, 'anon: P is in the list');
select is((select i ->> 'label' || '|' || (i ->> 'status') from jsonb_array_elements(public.list_public_dossiers('8f5a6417-5f6d-4f02-a50c-76d97167db99') -> 'items') as i where i ->> 'dossierId' = public.t_id('P')::text),
  'Etiqueta|en_ejecucion', 'list item label and status');
set local role authenticated;
select public.t_as('22000001');
insert into ctx select 'fpP1', null, public.t_fp(public.t_id('P'), public.t_id('P_pub'));

-- 4. Hidden publication: public reads go dark
select public.t_mod(public.t_id('P_pub'), 'hidden');
select public.t_as('none');
set local role anon;
select is(public.public_dossier_exists(public.t_id('P')), false, 'hidden: exists is false');
select is(public.t_pd(public.t_id('P')), null, 'hidden: get_public_dossier is null');
select is((select count(*)::int from jsonb_array_elements(public.list_public_dossiers('8f5a6417-5f6d-4f02-a50c-76d97167db99') -> 'items') as i where i ->> 'dossierId' = public.t_id('P')::text), 0, 'hidden: absent from the list');
select is(public.get_publication_dossier(public.t_id('P_pub')), null, 'hidden: get_publication_dossier is null for anon');
set local role authenticated;
select public.t_as('22000001');
select is(public.get_publication_dossier(public.t_id('P_pub')), null, 'hidden: get_publication_dossier is null for the coordinator too');
select is(public.public_dossier_exists(public.t_id('P')), false, 'hidden: exists is false for the coordinator');
select is(public.t_pd(public.t_id('P')), null, 'hidden: get_public_dossier is null for the coordinator');
-- Managed reads
insert into ctx select 'manH', null, public.t_man(public.t_id('P'));
select is(public.t_doc('manH') ->> 'moderationState', 'hidden', 'managed: moderationState is hidden');
select is(public.t_doc('manH') ->> 'label', 'Etiqueta', 'managed: the label is present');
select is(public.t_doc('manH') ->> 'responsibleName', 'Colectivo Plaza Viva', 'managed: the stored responsible name');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(public.t_doc('manH')) as k),
  array['decisionNote', 'dossierId', 'events', 'evidence', 'label', 'milestones', 'moderationState', 'publicationId', 'responsibleName', 'siteId', 'status', 'targetDate', 'updatedAt'],
  'managed: exactly the management keys, no features or analysis');
select is(public.t_doc('manH') ->> 'status', 'en_ejecucion', 'managed: status');
select is(public.t_doc('manH') -> 'events', public.t_doc('docP') -> 'events', 'managed events have the public shape and content');
select is(public.t_doc('manH') -> 'evidence', public.t_doc('docP') -> 'evidence', 'managed evidence has the public shape and content');
select is(public.t_doc('manH') -> 'milestones', public.t_doc('docP') -> 'milestones', 'managed milestones have the public shape and content');
select is((select count(*)::int from public.t_keys(public.t_doc('manH')) as k
  where k in ('actor_id', 'author_id', 'email', 'user_id', 'recorded_by', 'created_by', 'actorId', 'userId', 'recordedBy', 'createdBy')), 0, 'managed: no account key either');
select is(public.t_deny(u, format('select public.get_managed_dossier(%L::uuid)', public.t_id('P'))), 'P0002|dossier_not_found|', 'managed (hidden): ' || u || ' gets P0002')
from unnest(array['22000004', '22000002', '22000005', '22000006']) as u;
select is(public.t_deny('none', format('select public.get_managed_dossier(%L::uuid)', public.t_id('P'))), '28000|authentication_required|', 'managed: no auth is 28000');
select is(public.t_deny('22000001', format('select public.get_managed_dossier(%L::uuid)', gen_random_uuid())), 'P0002|dossier_not_found|', 'managed: an unknown id is P0002');
set local role anon;
select is(public.t_call(format('select public.get_managed_dossier(%L::uuid)', public.t_id('P'))) ~ '^42501\|', true, 'managed: the anon role has no EXECUTE (42501)');
set local role authenticated;
select public.t_as('22000001');

-- Hidden: coordinator writes
select is(public.t_pro(public.t_id('P_pub'), 'De nuevo'), 'P0002|publication_not_found|', 'hidden: promote again is publication_not_found (the lock sees only visible publications)');
select is(public.t_resp(public.t_id('P'), 'Otro', true), 'FT409|publication_hidden|', 'hidden: set_dossier_responsible FT409');
select is(public.t_addms(public.t_id('P'), 'Hito', '2027-02-01'), 'FT409|publication_hidden|', 'hidden: add_milestone FT409');
select is(public.t_addev(public.t_id('P'), 'https://colectivo.example.org/z', 'Z', 'Z', '2024-01-03'), 'FT409|publication_hidden|', 'hidden: add_evidence FT409');
select is(public.t_tr(public.t_id('P'), 'en_ejecucion', 'ejecutado', 'Fin', 'Obs', 'Dif', array[public.t_id('P_e2')]), 'FT409|publication_hidden|', 'hidden: transition_dossier FT409');
select is(public.t_ver(public.t_id('P_e2'), true), 'FT409|publication_hidden|', 'hidden: set_evidence_verified FT409 (visibility before closed state)');
select is(public.t_ver(public.t_id('P_e1'), false), 'FT409|publication_hidden|', 'hidden: un-verifying FT409');
select is(public.t_rev(public.t_id('P'), 'en_ejecucion', 'Corrijo'), 'FT409|publication_hidden|', 'hidden: revert_last_status_change FT409');
-- Hidden: strangers
select is(public.t_deny('22000004', format('select public.set_dossier_responsible(%L::uuid, %L, true, gen_random_uuid()::text, repeat(%L, 64))', public.t_id('P'), 'Otro', 'a')), 'P0002|dossier_not_found|', 'hidden: stranger set_dossier_responsible P0002');
select is(public.t_deny('22000004', format('select public.add_milestone(%L::uuid, %L, %L::date, gen_random_uuid()::text, repeat(%L, 64))', public.t_id('P'), 'Hito', '2027-02-01', 'a')), 'P0002|dossier_not_found|', 'hidden: stranger add_milestone P0002');
select is(public.t_deny('22000004', format('select public.add_evidence(%L::uuid, %L, %L, %L, %L::date, gen_random_uuid()::text, repeat(%L, 64))', public.t_id('P'), 'https://colectivo.example.org/z', 'Z', 'Z', '2024-01-03', 'a')), 'P0002|dossier_not_found|', 'hidden: stranger add_evidence P0002');
select is(public.t_deny('22000004', format('select public.transition_dossier(%L::uuid, %L::public.dossier_status, %L::public.dossier_status, %L, null, null, null, gen_random_uuid()::text, repeat(%L, 64))', public.t_id('P'), 'en_ejecucion', 'descartado', 'No', 'a')), 'P0002|dossier_not_found|', 'hidden: stranger transition_dossier P0002');
select is(public.t_deny('22000004', format('select public.set_evidence_verified(%L::uuid, true)', public.t_id('P_e2'))), 'P0002|dossier_not_found|', 'hidden: stranger set_evidence_verified P0002');
select is(public.t_deny('22000004', format('select public.revert_last_status_change(%L::uuid, %L::public.dossier_status, %L, gen_random_uuid()::text, repeat(%L, 64))', public.t_id('P'), 'en_ejecucion', 'Nota', 'a')), 'P0002|dossier_not_found|', 'hidden: stranger revert P0002');
select is(public.t_deny('22000004', format('select public.promote_dossier(%L::uuid, %L, null, false, null, gen_random_uuid()::text, repeat(%L, 64))', public.t_id('P_pub'), 'Nota', 'a')), 'P0002|publication_not_found|', 'hidden: stranger promote P0002');
select public.t_as('22000001');
select is(public.t_fp(public.t_id('P'), public.t_id('P_pub')) - 'requests', public.t_doc('fpP1') - 'requests', 'hidden: events, milestones, evidence, and the dossier row are unchanged');
select is((public.t_fp(public.t_id('P'), public.t_id('P_pub')) -> 'requests'), (public.t_doc('fpP1') -> 'requests'), 'hidden: no ledger row was written');

-- Restore
select public.t_mod(public.t_id('P_pub'), 'visible');
set local role anon;
select public.t_as('none');
select is(public.t_pd(public.t_id('P')), public.t_doc('docP') - 'supportCount' || jsonb_build_object('supportCount', 1), 'restored: the public document is identical to the one before hiding (supportCount 1)');
select is(public.public_dossier_exists(public.t_id('P')), true, 'restored: exists');
select is((select count(*)::int from jsonb_array_elements(public.list_public_dossiers('8f5a6417-5f6d-4f02-a50c-76d97167db99') -> 'items') as i where i ->> 'dossierId' = public.t_id('P')::text), 1, 'restored: back in the list');
set local role authenticated;
select public.t_as('22000001');
select is(public.t_addms(public.t_id('P'), 'Hito tras restaurar', '2027-03-01')::jsonb ->> 'position', '2', 'restored: writes work again');
select is(jsonb_array_length(public.t_pd(public.t_id('P')) -> 'events'), jsonb_array_length(public.t_doc('docP') -> 'events') + 1, 'restored: the write appended exactly one event');

-- 5. Unpublished site: everything is dark
select public.t_sitepub('8f5a6417-5f6d-4f02-a50c-76d97167db99', false);
select is(public.public_dossier_exists(public.t_id('P')), false, 'unpublished site: exists is false');
select is(public.t_pd(public.t_id('P')), null, 'unpublished site: document is null');
select is(public.get_publication_dossier(public.t_id('P_pub')), null, 'unpublished site: get_publication_dossier is null');
select is(public.list_public_dossiers('8f5a6417-5f6d-4f02-a50c-76d97167db99'), '{"items": [], "nextCursor": null}'::jsonb, 'unpublished site: the list is empty');
select is(public.t_man(public.t_id('P')) ->> 'moderationState', 'visible', 'unpublished site: the coordinator still reads the managed dossier');
select is(public.t_addms(public.t_id('P'), 'Hito oculto', '2027-04-01'), 'FT409|publication_hidden|', 'unpublished site: writes are FT409');
select is(public.t_pro(public.t_id('P_pub'), 'Otra vez'), 'P0002|publication_not_found|', 'unpublished site: promote is publication_not_found');
select public.t_sitepub('8f5a6417-5f6d-4f02-a50c-76d97167db99', true);
select is(public.public_dossier_exists(public.t_id('P')), true, 'site republished: exists again');
select isnt(public.t_pd(public.t_id('P')), null, 'site republished: document again');

-- 6. Keyset pagination over three dossiers of one site
select public.t_new('Q1', -98.19770);
select public.t_new('Q2', -98.19765);
select public.t_new('Q3', -98.19760);
select public.t_setupd(public.t_id('Q1'), '2001-01-03 12:00:00+00');
select public.t_setupd(public.t_id('Q2'), '2001-01-02 12:00:00+00');
select public.t_setupd(public.t_id('Q3'), '2001-01-02 12:00:00+00');
insert into ctx select 'qorder', null, (select jsonb_agg(x.id order by x.u desc, x.id desc)
  from (select (t ->> 'id')::uuid as id, (t ->> 'u')::timestamptz as u
        from (select jsonb_build_object('id', public.t_id(n), 'u', (public.t_sd(public.t_id(n)) ->> 'updated_at')) as t from unnest(array['Q1', 'Q2', 'Q3']) as n) s) x);
select is(public.t_doc('qorder') ->> 0, public.t_id('Q1')::text, 'Q1 (newest) is first in the expected order');
select is(public.t_pd(public.t_id('Q1')) ->> 'updatedAt', to_char('2001-01-03 12:00:00+00'::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'), 'setting updated_at shows in the public document');
-- start page: strictly older than (2001-01-04, max uuid)
insert into ctx select 'pg1', null, public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', '2001-01-04 00:00:00+00', 'ffffffff-ffff-4fff-bfff-ffffffffffff', 1)::jsonb;
select is(jsonb_array_length(public.t_doc('pg1') -> 'items'), 1, 'page 1 has 1 item');
select is(public.t_doc('pg1') #>> '{items,0,dossierId}', public.t_doc('qorder') ->> 0, 'page 1 is the newest');
select isnt(public.t_doc('pg1') -> 'nextCursor', 'null'::jsonb, 'page 1 has a nextCursor');
select is(public.t_doc('pg1') #>> '{nextCursor,id}', public.t_doc('qorder') ->> 0, 'nextCursor.id is the last returned id');
insert into ctx select 'pg2', null, public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_doc('pg1') #>> '{nextCursor,updatedAt}', (public.t_doc('pg1') #>> '{nextCursor,id}')::uuid, 1)::jsonb;
select is(jsonb_array_length(public.t_doc('pg2') -> 'items'), 1, 'page 2 has 1 item');
select is(public.t_doc('pg2') #>> '{items,0,dossierId}', public.t_doc('qorder') ->> 1, 'page 2 is second in order (updated_at desc, id desc)');
select isnt(public.t_doc('pg2') -> 'nextCursor', 'null'::jsonb, 'page 2 has a nextCursor');
insert into ctx select 'pg3', null, public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', public.t_doc('pg2') #>> '{nextCursor,updatedAt}', (public.t_doc('pg2') #>> '{nextCursor,id}')::uuid, 1)::jsonb;
select is(jsonb_array_length(public.t_doc('pg3') -> 'items'), 1, 'page 3 has 1 item');
select is(public.t_doc('pg3') #>> '{items,0,dossierId}', public.t_doc('qorder') ->> 2, 'page 3 is third in order (tie broken by id desc)');
select is(public.t_doc('pg3') -> 'nextCursor', 'null'::jsonb, 'page 3 has no nextCursor');
select is((select count(distinct x)::int from unnest(array[public.t_doc('pg1') #>> '{items,0,dossierId}', public.t_doc('pg2') #>> '{items,0,dossierId}', public.t_doc('pg3') #>> '{items,0,dossierId}']) as x), 3, 'the three pages have no repeats');
select is(public.t_doc('pg1') #>> '{items,0,label}', 'Etiqueta', 'list item has the public label');
select is(public.t_doc('pg1') #>> '{items,0,status}', 'en_revision', 'list item has the status');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(public.t_doc('pg1') -> 'items' -> 0) as k), array['dossierId', 'label', 'publicationId', 'status', 'updatedAt'], 'list item keys');
-- a page of 3 from the same start: no next cursor
select is(jsonb_array_length(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', '2001-01-04 00:00:00+00', 'ffffffff-ffff-4fff-bfff-ffffffffffff', 3)::jsonb -> 'items'), 3, 'limit 3 returns the 3 dossiers');
select is(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', '2001-01-04 00:00:00+00', 'ffffffff-ffff-4fff-bfff-ffffffffffff', 3)::jsonb -> 'nextCursor', 'null'::jsonb, 'limit 3: no next cursor');
select is(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', '2001-01-04 00:00:00+00', 'ffffffff-ffff-4fff-bfff-ffffffffffff', 2)::jsonb #>> '{nextCursor,id}', public.t_doc('qorder') ->> 1, 'limit 2: the cursor names the second item');
-- Hidden dossier is skipped by the list and by pagination
select public.t_mod(public.t_id('Q2_pub'), 'hidden');
select is((select jsonb_agg(i ->> 'dossierId' order by ord) from jsonb_array_elements(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', '2001-01-04 00:00:00+00', 'ffffffff-ffff-4fff-bfff-ffffffffffff', 50)::jsonb -> 'items') with ordinality as t(i, ord)),
  (select jsonb_agg(x order by ord) from jsonb_array_elements_text(public.t_doc('qorder')) with ordinality as t(x, ord) where x <> public.t_id('Q2')::text), 'a hidden dossier (Q2) is skipped in the list; the others keep their order');
select public.t_mod(public.t_id('Q2_pub'), 'visible');
-- Validation
select is(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', null, null, 0), '22023|invalid_page_request|', 'limit 0 is 22023');
select is(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', null, null, 51), '22023|invalid_page_request|', 'limit 51 is 22023');
select is(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', null, null, -1), '22023|invalid_page_request|', 'limit -1 is 22023');
select is(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', null, null, null), '22023|invalid_page_request|', 'a null limit is 22023');
select is(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', '2001-01-04 00:00:00+00', null, 1), '22023|invalid_page_request|', 'a cursor with only updatedAt is 22023');
select is(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', null, gen_random_uuid(), 1), '22023|invalid_page_request|', 'a cursor with only id is 22023');
select is(left(public.t_list('8f5a6417-5f6d-4f02-a50c-76d97167db99', null, null, 50), 1), '{', 'limit 50 is accepted');
select is(public.list_public_dossiers(gen_random_uuid(), null, null, 5), '{"items": [], "nextCursor": null}'::jsonb, 'an unknown site lists nothing');
select is(public.list_public_dossiers(public.t_uid('22005a00')::uuid), '{"items": [], "nextCursor": null}'::jsonb, 'a site without dossiers lists nothing');

-- 7. Hidden-content effects end to end on a dossier with a fork
select public.t_new('H', -98.19755);
select public.t_resp(public.t_id('H'), 'Colectivo H', true);
insert into ctx select 'H_m1', (public.t_addms(public.t_id('H'), 'Hito H', '2027-01-01')::jsonb ->> 'milestoneId')::uuid, null;
select public.t_tr(public.t_id('H'), 'en_revision', 'planeado', 'Plan H');
insert into ctx select 'H_e1', (public.t_addev(public.t_id('H'), 'https://colectivo.example.org/h', 'Inicio H', 'Acta H', '2024-01-01')::jsonb ->> 'evidenceId')::uuid, null;
select is(public.t_tr(public.t_id('H'), 'planeado', 'en_ejecucion', 'Inicio H', null, null, array[public.t_id('H_e1')])::jsonb ->> 'status', 'en_ejecucion', 'H started');
select public.t_as('22000004');
insert into ctx select 'H_fork', (public.fork_publication(public.t_id('H_pub'), 'Fork de H', gen_random_uuid()::text, repeat('f', 64)) ->> 'branchId')::uuid, null;
select isnt(public.t_id('H_fork'), null, 'a participant forked the publication');
select public.t_as('22000001');
insert into ctx select 'docH', null, public.t_pd(public.t_id('H'));
insert into ctx select 'fpH', null, public.t_fp(public.t_id('H'), public.t_id('H_pub'));
select public.t_mod(public.t_id('H_pub'), 'hidden');
select is(public.t_pd(public.t_id('H')), null, 'H hidden: public document is null');
select is(public.t_pro(public.t_id('H_pub'), 'otra'), 'P0002|publication_not_found|', 'H hidden: promote is publication_not_found');
select is(public.t_deny('22000004', format('select public.promote_dossier(%L::uuid, %L, null, false, null, gen_random_uuid()::text, repeat(%L, 64))', public.t_id('H_pub'), 'otra', 'a')), 'P0002|publication_not_found|', 'H hidden: a stranger promoting also gets publication_not_found');
select public.t_as('22000001');
select is(public.t_resp(public.t_id('H'), 'Otro nombre', true), 'FT409|publication_hidden|', 'H hidden: setting a new responsible is blocked (withdrawal is covered by 024)');
select is(public.t_rev(public.t_id('H'), 'en_ejecucion', 'Nota'), 'FT409|publication_hidden|', 'H hidden: correction is blocked');
select is(public.t_fp(public.t_id('H'), public.t_id('H_pub')), public.t_doc('fpH'), 'H hidden: every row and the ledger are unchanged');
select public.t_mod(public.t_id('H_pub'), 'visible');
select is(public.t_pd(public.t_id('H')), public.t_doc('docH'), 'H restored: the document is identical, updatedAt included');
select is(public.t_resp(public.t_id('H'), 'Colectivo H2', true)::jsonb ->> 'hasResponsible', 'true', 'H restored: writes work again');

-- 8. Two coordinators promoting the same publication
select public.t_as('22000002');
insert into ctx select 'T_pub', public.t_pub('Doble promocion', -98.19751), null;
select public.t_as('22000001');
insert into ctx select 'T_a', null, public.t_pro(public.t_id('T_pub'), 'Primera nota')::jsonb;
select public.t_as('22000003');
insert into ctx select 'T_b', null, public.t_pro(public.t_id('T_pub'), 'Segunda nota')::jsonb;
select is(public.t_doc('T_a') ->> 'created', 'true', 'the first coordinator creates the dossier');
select is(public.t_doc('T_b') ->> 'created', 'false', 'the second coordinator gets created:false');
select is(public.t_doc('T_b') ->> 'dossierId', public.t_doc('T_a') ->> 'dossierId', 'both get the same dossier id');
select is(public.t_npub(public.t_id('T_pub')), 1, 'one dossier for the publication');
select is(public.t_sd((public.t_doc('T_a') ->> 'dossierId')::uuid) ->> 'decision_note', 'Primera nota', 'the original note is kept');
select is(public.t_sd((public.t_doc('T_a') ->> 'dossierId')::uuid) ->> 'created_by', public.t_uid('22000001'), 'the original creator is kept');
select is(public.t_cnt((public.t_doc('T_a') ->> 'dossierId')::uuid, 'events'), 1, 'only one promoted event');
select public.t_as('22000004');
select is(public.t_pro(public.t_id('T_pub'), 'Tercera'), 'P0002|publication_not_found|', 'a participant cannot promote');

-- 9. Idempotency across operations
select public.t_as('22000001');
insert into ctx select 'T', (public.t_doc('T_a') ->> 'dossierId')::uuid, null;
select is(public.t_addms(public.t_id('T'), 'Hito cruzado', '2027-05-01', 'idem-cross-0001', repeat('1', 64))::jsonb ->> 'position', '1', 'add_milestone with the shared key');
select is(public.t_resp(public.t_id('T'), 'Colectivo T', true, 'idem-cross-0001', repeat('2', 64))::jsonb ->> 'hasResponsible', 'true', 'set_dossier_responsible with the same key and another hash does not collide');
select is(public.t_nreq(public.t_uid('22000001'), 'idem-cross-0001'), 2, 'two ledger rows share the key (operation is part of the key)');
select is(public.t_addms(public.t_id('T'), 'Hito cruzado B', '2027-06-01', 'idem-cross-0001', repeat('3', 64)), 'FT001|idempotency_key_reused|', 'same operation, same key, different payload: FT001');
select is(public.t_resp(public.t_id('T'), 'Colectivo Otro', true, 'idem-cross-0001', repeat('4', 64)), 'FT001|idempotency_key_reused|', 'the second operation also detects its own payload change');
select is(public.t_addms(public.t_id('T'), 'Hito cruzado', '2027-05-01', 'idem-cross-0001', repeat('1', 64))::jsonb ->> 'position', '1', 'same operation, same key, same payload: replay');
select is(public.t_cnt(public.t_id('T'), 'milestones'), 1, 'the replay and the rejected call created no milestone');
select is(public.t_nreq(public.t_uid('22000001'), 'idem-cross-0001'), 2, 'still two ledger rows');
select public.t_as('22000003');
select is(public.t_addms(public.t_id('T'), 'Hito de otro actor', '2027-07-01', 'idem-cross-0001', repeat('9', 64))::jsonb ->> 'position', '2', 'another actor can use the same key and operation (actor is part of the key)');

-- 10. Immutability (as postgres)
reset role;
select is(public.t_asp(format('update public.publications set public_label = %L where id = %L', 'Cambiada', public.t_id('P_pub'))), '55000|immutable_publication', 'publication label is immutable');
select is(public.t_asp(format('update public.publications set public_summary = %L where id = %L', 'Cambiado', public.t_id('P_pub'))), '55000|immutable_publication', 'publication summary is immutable');
select is(public.t_asp(format('update public.publications set public_author_alias = %L where id = %L', 'cambiado', public.t_id('P_pub'))), '55000|immutable_publication', 'publication author alias is immutable');
select is(public.t_asp(format('update public.publications set published_at = now() + interval ''1 day'' where id = %L', public.t_id('P_pub'))), '55000|immutable_publication', 'published_at is immutable');
select is(public.t_asp(format('update public.publications set moderation_state = ''hidden'' where id = %L', public.t_id('P_pub'))), 'ok', 'moderation_state remains the only mutable field');
select is(public.t_asp(format('update public.publications set moderation_state = ''visible'' where id = %L', public.t_id('P_pub'))), 'ok', 'and it can be restored');
select ok(public.t_asp(format('delete from public.publications where id = %L', public.t_id('P_pub'))) ~ '^(55000|23503)\|', 'deleting a publication referenced by a dossier fails (55000 or 23503)');
select is(public.t_npub(public.t_id('P_pub')), 1, 'the dossier still references its publication');
select ok(public.t_asp(format('delete from public.revisions where id = %L', public.t_sd(public.t_id('P')) ->> 'revision_id')) ~ '^(55000|23503)\|', 'deleting a revision referenced by a dossier fails');
select is(public.t_asp(format('update public.revisions set id = id where id = %L', public.t_sd(public.t_id('P')) ->> 'revision_id')), '55000|immutable_revision', 'updating a revision referenced by a dossier fails');
select is(public.t_asp(format('update public.revision_features set kind = kind where revision_id = %L', public.t_sd(public.t_id('P')) ->> 'revision_id')), '55000|immutable_revision', 'updating revision_features fails');
select is(public.t_asp(format('delete from public.revision_features where revision_id = %L', public.t_sd(public.t_id('P')) ->> 'revision_id')), '55000|immutable_revision', 'deleting revision_features fails');
select is(public.t_asp(format('delete from public.dossiers where id = %L', public.t_id('P'))), '55000|immutable_dossier', 'a dossier cannot be deleted');
select ok(public.t_asp(format('delete from public.dossier_events where dossier_id = %L', public.t_id('P'))) ~ '^55000\|', 'dossier events cannot be deleted (55000)');
select is(public.t_cnt(public.t_id('P'), 'events') > 0, true, 'the history is intact');

select * from finish();
rollback;
