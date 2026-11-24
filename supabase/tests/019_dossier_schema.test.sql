begin;

select plan(314);

create temp table ctx (name text primary key, id uuid, doc jsonb);
grant all on table ctx to anon, authenticated;

-- Test-only helpers (rolled back with the transaction). They run as the calling role.
create function public.t_id(p text) returns uuid language sql stable as $$ select id from ctx where name = p $$;
-- Last 8 hex characters are unique per user: the generated profile alias uses them.
create function public.t_uid(p text) returns text language sql immutable as
$$ select '99019000-0000-4000-8000-0000' || lpad(p, 8, '0') $$;
create function public.t_as(p text) returns text language sql as
$$ select set_config('request.jwt.claim.sub', public.t_uid(p), true) $$;
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
-- Runs the statement and always rolls it back: 'ok' means the statement was accepted.
create function public.t_chk(p_sql text) returns text language plpgsql as $$
declare
  m text;
begin
  begin
    execute p_sql;
    raise exception using errcode = 'ZZ999', message = 'probe_rollback';
  exception when others then
    if sqlstate = 'ZZ999' then
      return 'ok';
    end if;
    get stacked diagnostics m = message_text;
    return sqlstate || '|' || m;
  end;
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
-- Dossier insert against a publication (run as postgres). p_rev overrides the revision.
create function public.t_dins(p_pub uuid, p_note text default 'Nota', p_name text default null,
  p_auth boolean default false, p_seq integer default 0, p_rev uuid default null) returns text language sql as $$
  select public.t_chk(format(
    'insert into public.dossiers (id, publication_id, revision_id, site_id, decision_note, responsible_name, responsible_authorized, last_event_seq, created_by)
     select gen_random_uuid(), p.id, coalesce(%L::uuid, p.revision_id), r.site_id, %L, %L, %L, %s, %L
     from public.publications as p join public.revisions as r on r.id = p.revision_id where p.id = %L',
    p_rev, p_note, p_name, p_auth, p_seq, public.t_uid('19000001'), p_pub))
$$;
-- Event insert. p_keep keeps the row; otherwise the insert is rolled back.
create function public.t_ev(p_dossier uuid, p_seq integer, p_kind text, p_prev text, p_new text,
  p_note text default null, p_obs text default null, p_diff text default null,
  p_ms uuid default null, p_ev uuid default null, p_corr uuid default null, p_keep boolean default false)
returns text language plpgsql as $$
declare
  q text := format(
    'insert into public.dossier_events (id, dossier_id, seq, kind, previous_state, new_state, milestone_id, evidence_id, corrects_event_id, note, observation, difference, actor_id)
     values (gen_random_uuid(), %L, %s, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    p_dossier, p_seq, p_kind, p_prev, p_new, p_ms, p_ev, p_corr, p_note, p_obs, p_diff, public.t_uid('19000001'));
begin
  if p_keep then
    return public.t_err(q);
  end if;
  return public.t_chk(q);
end;
$$;
create function public.t_ms(p_dossier uuid, p_pos integer, p_title text, p_keep boolean default false)
returns text language plpgsql as $$
declare
  q text := format(
    'insert into public.dossier_milestones (id, dossier_id, position, title, target_date, created_by)
     values (gen_random_uuid(), %L, %s, %L, ''2027-01-01'', %L)', p_dossier, p_pos, p_title, public.t_uid('19000001'));
begin
  if p_keep then
    return public.t_err(q);
  end if;
  return public.t_chk(q);
end;
$$;
create function public.t_evid(p_dossier uuid, p_pos integer, p_url text, p_keep boolean default false)
returns text language plpgsql as $$
declare
  q text := format(
    'insert into public.evidence_items (id, dossier_id, position, url, title, description, evidence_date, recorded_by)
     values (gen_random_uuid(), %L, %s, %L, ''Titulo'', ''Descripcion'', ''2024-01-01'', %L)',
    p_dossier, p_pos, p_url, public.t_uid('19000001'));
begin
  if p_keep then
    return public.t_err(q);
  end if;
  return public.t_chk(q);
end;
$$;
-- Inserts a status_change event (and optionally its evidence link), then forces the
-- deferred constraint trigger to run now. A failure rolls the event back.
create function public.t_def(p_dossier uuid, p_seq integer, p_prev text, p_new text, p_evidence uuid, p_link boolean)
returns text language plpgsql as $$
declare
  m text;
  v_id uuid := gen_random_uuid();
begin
  begin
    insert into public.dossier_events (id, dossier_id, seq, kind, previous_state, new_state, note, observation, difference, actor_id)
    values (v_id, p_dossier, p_seq, 'status_change', p_prev::public.dossier_status, p_new::public.dossier_status, 'Nota',
      case when p_new = 'ejecutado' then 'Observacion' end, case when p_new = 'ejecutado' then 'Diferencia' end,
      public.t_uid('19000001')::uuid);
    if p_link then
      insert into public.dossier_event_evidence (event_id, evidence_id, dossier_id) values (v_id, p_evidence, p_dossier);
    end if;
    set constraints all immediate;
    set constraints all deferred;
    return 'ok';
  exception when others then
    get stacked diagnostics m = message_text;
    set constraints all deferred;
    return sqlstate || '|' || m;
  end;
end;
$$;

-- 1. Setup (as postgres)
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
select public.t_uid(n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
from unnest(array['19000001', '19000002']) as n;

set local role authenticated;
select public.t_as('19000001');
insert into ctx select 'p1', public.t_pub('Dossier schema one', -98.19775), null;
insert into ctx select 'p2', public.t_pub('Dossier schema two', -98.19770), null;
insert into ctx select 'p3', public.t_pub('Dossier schema three', -98.19765), null;
reset role;

with ins as (
  insert into public.dossiers (id, publication_id, revision_id, site_id, scenario_slug, decision_note, created_by)
  select gen_random_uuid(), p.id, p.revision_id, r.site_id, 'equinox-1000', 'Nota D1', public.t_uid('19000001')::uuid
  from public.publications as p join public.revisions as r on r.id = p.revision_id where p.id = public.t_id('p1')
  returning id)
insert into ctx select 'D1', id, null from ins;
with ins as (
  insert into public.dossiers (id, publication_id, revision_id, site_id, scenario_slug, decision_note, created_by)
  select gen_random_uuid(), p.id, p.revision_id, r.site_id, 'equinox-1000', 'Nota D2', public.t_uid('19000001')::uuid
  from public.publications as p join public.revisions as r on r.id = p.revision_id where p.id = public.t_id('p2')
  returning id)
insert into ctx select 'D2', id, null from ins;

-- 2. Tables, RLS, privileges
select has_table('public', t, t || ' exists')
from unnest(array['dossiers', 'dossier_milestones', 'evidence_items', 'dossier_events', 'dossier_event_evidence']) as t;
select is((select c.relrowsecurity from pg_class as c where c.oid = ('public.' || t)::regclass), true, 'RLS enabled on ' || t)
from unnest(array['dossiers', 'dossier_milestones', 'evidence_items', 'dossier_events', 'dossier_event_evidence']) as t;
select is((select count(*)::int from pg_policies as p where p.schemaname = 'public' and p.tablename = t), 0, 'no policies on ' || t)
from unnest(array['dossiers', 'dossier_milestones', 'evidence_items', 'dossier_events', 'dossier_event_evidence']) as t;
select is(
  has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  r || ' has no privilege on ' || t)
from unnest(array['anon', 'authenticated']) as r
cross join unnest(array['dossiers', 'dossier_milestones', 'evidence_items', 'dossier_events', 'dossier_event_evidence']) as t;

set local role anon;
select is(public.t_err('select count(*) from public.' || t), '42501|permission denied for table ' || t, 'anon cannot select ' || t)
from unnest(array['dossiers', 'dossier_milestones', 'evidence_items', 'dossier_events', 'dossier_event_evidence']) as t;
set local role authenticated;
select is(public.t_err('select count(*) from public.' || t), '42501|permission denied for table ' || t, 'authenticated cannot select ' || t)
from unnest(array['dossiers', 'dossier_milestones', 'evidence_items', 'dossier_events', 'dossier_event_evidence']) as t;
select is(public.t_err('insert into public.dossier_events (id) values (gen_random_uuid())'), '42501|permission denied for table dossier_events', 'authenticated cannot insert events');
reset role;

-- 3. Enums
select enum_has_labels('public', 'dossier_status', array['en_revision', 'planeado', 'en_ejecucion', 'ejecutado', 'descartado'], 'dossier_status labels');
select enum_has_labels('public', 'milestone_status', array['pendiente', 'cumplido', 'cancelado'], 'milestone_status labels');
select enum_has_labels('public', 'dossier_event_kind',
  array['promoted', 'status_change', 'milestone_added', 'milestone_updated', 'evidence_added', 'evidence_verified', 'responsible_changed', 'correction'],
  'dossier_event_kind labels');

-- 4. Transition truth table (25 pairs)
select is(
  public.dossier_transition_allowed(a, b),
  (a::text || '>' || b::text) = any (array[
    'en_revision>planeado', 'en_revision>descartado', 'planeado>en_ejecucion', 'planeado>descartado',
    'en_ejecucion>ejecutado', 'en_ejecucion>descartado']),
  'transition ' || a::text || ' > ' || b::text)
from unnest(enum_range(null::public.dossier_status)) as a
cross join unnest(enum_range(null::public.dossier_status)) as b;

-- 5. dossiers constraints
select alike(public.t_dins(public.t_id('p3'), ''), '23514|%dossiers_decision_note_check%', 'decision_note of 0 chars rejected');
select is(public.t_dins(public.t_id('p3'), 'x'), 'ok', 'decision_note of 1 char accepted');
select is(public.t_dins(public.t_id('p3'), repeat('x', 1000)), 'ok', 'decision_note of 1000 chars accepted');
select alike(public.t_dins(public.t_id('p3'), repeat('x', 1001)), '23514|%dossiers_decision_note_check%', 'decision_note of 1001 chars rejected');
select alike(public.t_dins(public.t_id('p3'), ' padded'), '23514|%dossiers_decision_note_check%', 'decision_note with leading space rejected (plain_text_ok)');
select alike(public.t_dins(public.t_id('p3'), 'a' || chr(1) || 'b'), '23514|%dossiers_decision_note_check%', 'decision_note with a control character rejected');
select is(public.t_dins(public.t_id('p3'), 'Nota', 'Colectivo Plaza', true), 'ok', 'responsible name with authorization accepted');
select is(public.t_dins(public.t_id('p3'), 'Nota', repeat('n', 100), true), 'ok', 'responsible_name of 100 chars accepted');
select alike(public.t_dins(public.t_id('p3'), 'Nota', repeat('n', 101), true), '23514|%dossiers_responsible_name_check%', 'responsible_name of 101 chars rejected');
select alike(public.t_dins(public.t_id('p3'), 'Nota', '', true), '23514|%dossiers_responsible_name_check%', 'empty responsible_name rejected');
select alike(public.t_dins(public.t_id('p3'), 'Nota', 'a@b.org', true), '23514|%dossiers_responsible_name_check%', 'responsible_name with @ rejected');
select alike(public.t_dins(public.t_id('p3'), 'Nota', ' Colectivo', true), '23514|%dossiers_responsible_name_check%', 'responsible_name not plain text rejected');
select alike(public.t_dins(public.t_id('p3'), 'Nota', 'Colectivo', false), '23514|%dossiers_name_implies_authorization%', 'a name without authorization rejected');
select alike(public.t_dins(public.t_id('p3'), 'Nota', null, true), '23514|%dossiers_name_implies_authorization%', 'authorization without a name rejected');
select alike(public.t_dins(public.t_id('p3'), 'Nota', null, false, 0, (select revision_id from public.publications where id = public.t_id('p2'))),
  '23503|%dossiers_publication_fk%', 'publication/revision pair must match');
select alike(public.t_dins(public.t_id('p1')), '23505|%dossiers_publication_id_key%', 'one dossier per publication');
select alike(public.t_dins(public.t_id('p3'), 'Nota', null, false, -1), '23514|%dossiers_last_event_seq_check%', 'last_event_seq -1 rejected');
select is(public.t_dins(public.t_id('p3'), 'Nota', null, false, 0), 'ok', 'last_event_seq 0 accepted');
select is(public.t_dins(public.t_id('p3'), 'Nota', null, false, 500), 'ok', 'last_event_seq 500 accepted');
select alike(public.t_dins(public.t_id('p3'), 'Nota', null, false, 501), '23514|%dossiers_last_event_seq_check%', 'last_event_seq 501 rejected');
select is(public.t_dins(public.t_id('p3'), 'Nota', null, false, 0), 'ok', 'a unique publication still accepts a dossier');

-- 6. limit_dossier_change trigger
select is(public.t_err(format('update public.dossiers set %s where id = %L', c, public.t_id('D1'))), '55000|immutable_dossier', 'immutable column ' || c)
from unnest(array[
  'decision_note = ''Otra''', 'target_date = ''2027-01-01''', 'scenario_slug = ''otro''',
  'created_by = ''' || public.t_uid('19000002') || '''', 'created_at = now() + interval ''1 day''',
  'publication_id = ''' || public.t_id('p3') || '''', 'site_id = gen_random_uuid()']) as c;
select is(public.t_err(format('delete from public.dossiers where id = %L', public.t_id('D1'))), '55000|immutable_dossier', 'delete of a dossier blocked');
select is(public.t_err('truncate public.dossiers cascade'), '55000|immutable_dossier', 'truncate of dossiers blocked');
select is(public.t_err(format('update public.dossiers set last_event_seq = 1 where id = %L', public.t_id('D1'))), '55000|immutable_dossier', 'seq cannot advance without an event');
select is(public.t_ev(public.t_id('D1'), 1, 'promoted', null, 'en_revision', p_keep => true), 'ok', 'promoted event seq 1 inserted');
select is(public.t_err(format('update public.dossiers set last_event_seq = 2 where id = %L', public.t_id('D1'))), '55000|immutable_dossier', 'seq cannot skip an event');
select is(public.t_err(format('update public.dossiers set last_event_seq = 1 where id = %L', public.t_id('D1'))), 'ok', 'seq advances by one with an existing event');
select is(public.t_err(format('update public.dossiers set last_event_seq = 0 where id = %L', public.t_id('D1'))), '55000|immutable_dossier', 'seq cannot go backwards');
select is(public.t_err(format('update public.dossiers set status = ''planeado'' where id = %L', public.t_id('D1'))), '55000|immutable_dossier', 'status change without advancing seq blocked');
select is(public.t_err(format('update public.dossiers set status = ''planeado'', last_event_seq = 2 where id = %L', public.t_id('D1'))), '55000|immutable_dossier', 'status change without an event blocked');
select is(public.t_ev(public.t_id('D1'), 2, 'responsible_changed', null, null, p_keep => true), 'ok', 'responsible_changed event seq 2 inserted');
select is(public.t_err(format('update public.dossiers set status = ''planeado'', last_event_seq = 2 where id = %L', public.t_id('D1'))), '55000|immutable_dossier', 'status change explained by a non-status event blocked');
select is(public.t_err(format('update public.dossiers set last_event_seq = 2 where id = %L', public.t_id('D1'))), 'ok', 'seq 2 with unchanged status accepted');
select is(public.t_ev(public.t_id('D1'), 3, 'status_change', 'en_revision', 'planeado', 'Plan', p_keep => true), 'ok', 'status_change event seq 3 inserted');
select is(public.t_err(format('update public.dossiers set status = ''descartado'', last_event_seq = 3 where id = %L', public.t_id('D1'))), '55000|immutable_dossier', 'status not matching the event new_state blocked');
select is(public.t_err(format('update public.dossiers set status = ''planeado'', last_event_seq = 3 where id = %L', public.t_id('D1'))), 'ok', 'status matching the status_change event accepted');
insert into ctx select 'D1e3', id, null from public.dossier_events where dossier_id = public.t_id('D1') and seq = 3;
select is(public.t_ev(public.t_id('D1'), 4, 'correction', 'planeado', 'en_revision', 'Correccion', p_corr => public.t_id('D1e3'), p_keep => true), 'ok', 'correction event seq 4 inserted');
select is(public.t_err(format('update public.dossiers set status = ''en_revision'', last_event_seq = 4 where id = %L', public.t_id('D1'))), 'ok', 'status matching a correction event accepted');
select is(public.t_err(format('update public.dossiers set responsible_name = ''Colectivo'', responsible_authorized = true where id = %L', public.t_id('D1'))), 'ok', 'responsible name and authorization are mutable');
select alike(public.t_err(format('update public.dossiers set responsible_authorized = false where id = %L', public.t_id('D1'))), '23514|%dossiers_name_implies_authorization%', 'withdrawing authorization alone is rejected');
select is((select status::text || ':' || last_event_seq from public.dossiers where id = public.t_id('D1')), 'en_revision:4', 'D1 final status and seq');

-- 7. dossier_milestones
select is(public.t_ms(public.t_id('D1'), 1, 'Hito uno', true), 'ok', 'milestone position 1 inserted');
select alike(public.t_ms(public.t_id('D1'), 1, 'Hito repetido'), '23505%', 'duplicate milestone position rejected');
select alike(public.t_ms(public.t_id('D1'), 0, 'Hito'), '23514|%dossier_milestones_position_check%', 'milestone position 0 rejected');
select is(public.t_ms(public.t_id('D1'), 20, 'Hito'), 'ok', 'milestone position 20 accepted');
select alike(public.t_ms(public.t_id('D1'), 21, 'Hito'), '23514|%dossier_milestones_position_check%', 'milestone position 21 rejected');
select alike(public.t_ms(public.t_id('D1'), 2, ''), '23514|%dossier_milestones_title_check%', 'empty milestone title rejected');
select is(public.t_ms(public.t_id('D1'), 2, repeat('t', 100)), 'ok', 'milestone title of 100 accepted');
select alike(public.t_ms(public.t_id('D1'), 2, repeat('t', 101)), '23514|%dossier_milestones_title_check%', 'milestone title of 101 rejected');
select alike(public.t_ms(public.t_id('D1'), 2, ' Hito'), '23514|%dossier_milestones_title_check%', 'milestone title not plain text rejected');
select is(public.t_ms(public.t_id('D1'), 2, 'Hito dos', true), 'ok', 'milestone position 2 inserted');
select is(public.t_ms(public.t_id('D2'), 1, 'Hito D2', true), 'ok', 'milestone of D2 inserted');
insert into ctx select 'M1', id, null from public.dossier_milestones where dossier_id = public.t_id('D1') and position = 1;
insert into ctx select 'M2', id, null from public.dossier_milestones where dossier_id = public.t_id('D1') and position = 2;
insert into ctx select 'MD2', id, null from public.dossier_milestones where dossier_id = public.t_id('D2') and position = 1;
select is(public.t_err(format('update public.dossier_milestones set status = ''cumplido'' where id = %L', public.t_id('M1'))), 'ok', 'pendiente -> cumplido allowed');
select is(public.t_err(format('update public.dossier_milestones set status = ''pendiente'' where id = %L', public.t_id('M1'))), 'ok', 'cumplido -> pendiente allowed');
select is(public.t_err(format('update public.dossier_milestones set title = ''Nuevo'', target_date = ''2028-01-01'' where id = %L', public.t_id('M1'))), 'ok', 'title and date editable with the same status');
select is(public.t_err(format('update public.dossier_milestones set status = ''cancelado'' where id = %L', public.t_id('M1'))), 'ok', 'pendiente -> cancelado allowed');
select is(public.t_err(format('update public.dossier_milestones set status = ''pendiente'' where id = %L', public.t_id('M1'))), '55000|immutable_milestone', 'cancelado -> pendiente blocked');
select is(public.t_err(format('update public.dossier_milestones set status = ''cumplido'' where id = %L', public.t_id('M1'))), '55000|immutable_milestone', 'cancelado -> cumplido blocked');
select is(public.t_err(format('update public.dossier_milestones set title = ''Edit'' where id = %L', public.t_id('M1'))), '55000|immutable_milestone', 'cancelado is terminal: no edits');
select is(public.t_err(format('update public.dossier_milestones set status = ''cumplido'' where id = %L', public.t_id('M2'))), 'ok', 'M2 pendiente -> cumplido');
select is(public.t_err(format('update public.dossier_milestones set status = ''cancelado'' where id = %L', public.t_id('M2'))), '55000|immutable_milestone', 'cumplido -> cancelado blocked');
select is(public.t_err(format('update public.dossier_milestones set %s where id = %L', c, public.t_id('M2'))), '55000|immutable_milestone', 'immutable milestone column ' || c)
from unnest(array['position = 3', 'dossier_id = ''' || public.t_id('D2') || '''', 'created_by = ''' || public.t_uid('19000002') || '''',
  'created_at = now() + interval ''1 day''', 'id = gen_random_uuid()']) as c;
select is(public.t_err(format('delete from public.dossier_milestones where id = %L', public.t_id('M2'))), '55000|immutable_milestone', 'milestone delete blocked');
select is(public.t_err('truncate public.dossier_milestones cascade'), '55000|immutable_milestone', 'milestone truncate blocked');

-- 8. evidence_items
select is(public.t_evid(public.t_id('D1'), 1, 'https://colectivo.example.org/a?b=c#d', true), 'ok', 'https URL with query and fragment accepted');
select is(public.t_evid(public.t_id('D1'), 2, 'https://Colectivo.Example.ORG:8443/x'), 'ok', 'URL with mixed case host and port accepted');
select is(public.t_evid(public.t_id('D1'), 2, 'https://sub-domain.example.org'), 'ok', 'URL without a path accepted');
select alike(public.t_evid(public.t_id('D1'), 2, 'http://colectivo.example.org/a'), '23514|%evidence_items_url_check%', 'http:// rejected');
select alike(public.t_evid(public.t_id('D1'), 2, 'javascript:alert(1)'), '23514|%evidence_items_url_check%', 'javascript: rejected');
select alike(public.t_evid(public.t_id('D1'), 2, 'data:text/html,x'), '23514|%evidence_items_url_check%', 'data: rejected');
select alike(public.t_evid(public.t_id('D1'), 2, 'ftp://colectivo.example.org/a'), '23514|%evidence_items_url_check%', 'ftp:// rejected');
select alike(public.t_evid(public.t_id('D1'), 2, 'https://a@b.com/x'), '23514|%evidence_items_url_check%', 'userinfo in URL rejected');
select alike(public.t_evid(public.t_id('D1'), 2, 'https://exa mple.org/x'), '23514|%evidence_items_url_check%', 'space in host rejected');
select alike(public.t_evid(public.t_id('D1'), 2, 'https://example.org/a b'), '23514|%evidence_items_url_check%', 'space in path rejected');
select alike(public.t_evid(public.t_id('D1'), 2, 'https://localhost'), '23514|%evidence_items_url_check%', 'host without a dot rejected');
select alike(public.t_evid(public.t_id('D1'), 2, 'https://example.org/a\b'), '23514|%evidence_items_url_check%', 'backslash rejected');
select alike(public.t_evid(public.t_id('D1'), 2, 'https://example.org/<x>'), '23514|%evidence_items_url_check%', 'angle brackets rejected');
select is(public.t_evid(public.t_id('D1'), 2, 'https://example.org/' || repeat('a', 2048 - 20)), 'ok', 'URL of exactly 2048 chars accepted');
select alike(public.t_evid(public.t_id('D1'), 2, 'https://example.org/' || repeat('a', 2048 - 19)), '23514|%evidence_items_url_check%', 'URL of 2049 chars rejected');
select is(public.t_evid(public.t_id('D1'), 2, 'https://Colectivo.Example.ORG/x', true), 'ok', 'second evidence inserted');
select is((select host from public.evidence_items where dossier_id = public.t_id('D1') and position = 2), 'colectivo.example.org', 'generated host is lowercased and has no port or path');
select alike(public.t_chk(format('insert into public.evidence_items (id, dossier_id, position, url, host, title, description, evidence_date, recorded_by) values (gen_random_uuid(), %L, 3, ''https://a.example.org'', ''x'', ''T'', ''D'', ''2024-01-01'', %L)', public.t_id('D1'), public.t_uid('19000001'))),
  '428C9|%', 'the generated host column cannot be written');
select alike(public.t_evid(public.t_id('D1'), 1, 'https://otra.example.org/x'), '23505%', 'duplicate evidence position rejected');
select alike(public.t_evid(public.t_id('D1'), 0, 'https://otra.example.org/x'), '23514|%evidence_items_position_check%', 'evidence position 0 rejected');
select is(public.t_evid(public.t_id('D1'), 50, 'https://otra.example.org/x'), 'ok', 'evidence position 50 accepted');
select alike(public.t_evid(public.t_id('D1'), 51, 'https://otra.example.org/x'), '23514|%evidence_items_position_check%', 'evidence position 51 rejected');
select is(public.t_evid(public.t_id('D2'), 1, 'https://colectivo.example.org/d2', true), 'ok', 'evidence of D2 inserted');
insert into ctx select 'E1', id, null from public.evidence_items where dossier_id = public.t_id('D1') and position = 1;
insert into ctx select 'E2', id, null from public.evidence_items where dossier_id = public.t_id('D1') and position = 2;
insert into ctx select 'ED2', id, null from public.evidence_items where dossier_id = public.t_id('D2') and position = 1;
select alike(public.t_chk(format('insert into public.evidence_items (id, dossier_id, position, url, title, description, evidence_date, recorded_by, verified_by_team) values (gen_random_uuid(), %L, 9, ''https://a.example.org'', '''', ''D'', ''2024-01-01'', %L, false)', public.t_id('D1'), public.t_uid('19000001'))),
  '23514|%evidence_items_title_check%', 'empty evidence title rejected');
select alike(public.t_chk(format('insert into public.evidence_items (id, dossier_id, position, url, title, description, evidence_date, recorded_by, verified_by_team) values (gen_random_uuid(), %L, 9, ''https://a.example.org'', ''T'', repeat(''d'', 1001), ''2024-01-01'', %L, false)', public.t_id('D1'), public.t_uid('19000001'))),
  '23514|%evidence_items_description_check%', 'evidence description of 1001 chars rejected');
select alike(public.t_chk(format('insert into public.evidence_items (id, dossier_id, position, url, title, description, evidence_date, recorded_by, verified_by_team) values (gen_random_uuid(), %L, 9, ''https://a.example.org'', ''T'', ''D'', ''2024-01-01'', %L, true)', public.t_id('D1'), public.t_uid('19000001'))),
  '23514|%evidence_verification_shape%', 'verified without verifier rejected');
select alike(public.t_chk(format('insert into public.evidence_items (id, dossier_id, position, url, title, description, evidence_date, recorded_by, verified_by_team, verified_by, verified_at) values (gen_random_uuid(), %L, 9, ''https://a.example.org'', ''T'', ''D'', ''2024-01-01'', %L, false, %L, now())', public.t_id('D1'), public.t_uid('19000001'), public.t_uid('19000002'))),
  '23514|%evidence_verification_shape%', 'verifier on unverified evidence rejected');
select is(public.t_chk(format('insert into public.evidence_items (id, dossier_id, position, url, title, description, evidence_date, recorded_by, verified_by_team, verified_by, verified_at) values (gen_random_uuid(), %L, 9, ''https://a.example.org'', ''T'', ''D'', ''2024-01-01'', %L, true, %L, now())', public.t_id('D1'), public.t_uid('19000001'), public.t_uid('19000002'))),
  'ok', 'verified evidence with verifier and time accepted');
select is(public.t_err(format('update public.evidence_items set verified_by_team = true, verified_by = %L, verified_at = now() where id = %L', public.t_uid('19000002'), public.t_id('E1'))), 'ok', 'verification is mutable');
select is(public.t_err(format('update public.evidence_items set verified_by_team = false, verified_by = null, verified_at = null where id = %L', public.t_id('E1'))), 'ok', 'unverification is mutable');
select is(public.t_err(format('update public.evidence_items set %s where id = %L', c, public.t_id('E1'))), '55000|immutable_evidence', 'immutable evidence column ' || c)
from unnest(array['url = ''https://otra.example.org/x''', 'title = ''Otro''', 'description = ''Otra''', 'evidence_date = ''2024-02-02''',
  'recorded_by = ''' || public.t_uid('19000002') || '''', 'position = 7', 'dossier_id = ''' || public.t_id('D2') || '''',
  'created_at = now() + interval ''1 day''']) as c;
select is(public.t_err(format('delete from public.evidence_items where id = %L', public.t_id('E1'))), '55000|immutable_evidence', 'evidence delete blocked');
select is(public.t_err('truncate public.evidence_items cascade'), '55000|immutable_evidence', 'evidence truncate blocked');

-- 9. dossier_events shape and foreign keys (rolled-back inserts on D1 seq 99)
select is(public.t_ev(public.t_id('D1'), 99, 'promoted', null, 'en_revision'), 'ok', 'promoted shape accepted');
select alike(public.t_ev(public.t_id('D1'), 99, 'promoted', null, 'planeado'), '23514|%dossier_events_promoted_shape%', 'promoted must land in en_revision');
select alike(public.t_ev(public.t_id('D1'), 99, 'promoted', 'en_revision', 'en_revision'), '23514|%dossier_events_promoted_shape%', 'promoted has no previous state');
select is(public.t_ev(public.t_id('D1'), 99, 'status_change', 'en_revision', 'planeado', 'Nota'), 'ok', 'status_change en_revision -> planeado accepted');
select alike(public.t_ev(public.t_id('D1'), 99, 'status_change', 'en_revision', 'ejecutado', 'Nota', 'Obs', 'Dif'), '23514|%dossier_events_status_change_shape%', 'status_change with a disallowed transition rejected');
select alike(public.t_ev(public.t_id('D1'), 99, 'status_change', 'ejecutado', 'planeado', 'Nota'), '23514|%dossier_events_status_change_shape%', 'status_change out of a closed state rejected');
select alike(public.t_ev(public.t_id('D1'), 99, 'status_change', 'en_revision', 'planeado'), '23514|%dossier_events_status_change_shape%', 'status_change without a note rejected');
select alike(public.t_ev(public.t_id('D1'), 99, 'status_change', null, 'planeado', 'Nota'), '23514|%dossier_events_status_change_shape%', 'status_change without previous state rejected');
select alike(public.t_ev(public.t_id('D1'), 99, 'status_change', 'en_ejecucion', 'ejecutado', 'Nota', null, 'Dif'), '23514|%dossier_events_status_change_shape%', 'ejecutado without observation rejected');
select alike(public.t_ev(public.t_id('D1'), 99, 'status_change', 'en_ejecucion', 'ejecutado', 'Nota', 'Obs', null), '23514|%dossier_events_status_change_shape%', 'ejecutado without difference rejected');
select is(public.t_ev(public.t_id('D1'), 99, 'status_change', 'en_ejecucion', 'ejecutado', 'Nota', 'Obs', 'Dif'), 'ok', 'ejecutado with observation and difference accepted');
select alike(public.t_ev(public.t_id('D1'), 99, 'correction', 'planeado', 'en_revision', 'Nota'), '23514|%dossier_events_correction_shape%', 'correction without corrects_event_id rejected');
select alike(public.t_ev(public.t_id('D1'), 99, 'correction', 'planeado', 'en_revision', null, p_corr => public.t_id('D1e3')), '23514|%dossier_events_correction_shape%', 'correction without note rejected');
select is(public.t_ev(public.t_id('D1'), 99, 'correction', 'planeado', 'en_revision', 'Nota', p_corr => public.t_id('D1e3')), 'ok', 'correction naming an event of the same dossier accepted');
select alike(public.t_ev(public.t_id('D2'), 99, 'correction', 'planeado', 'en_revision', 'Nota', p_corr => public.t_id('D1e3')), '23503|%dossier_events_corrects_fk%', 'correction of another dossier''s event rejected');
select alike(public.t_ev(public.t_id('D1'), 99, 'milestone_added', null, null, p_ms => public.t_id('MD2')), '23503|%dossier_events_milestone_fk%', 'milestone of another dossier rejected');
select is(public.t_ev(public.t_id('D1'), 99, 'milestone_added', null, null, p_ms => public.t_id('M2')), 'ok', 'milestone of the same dossier accepted');
select alike(public.t_ev(public.t_id('D1'), 99, 'evidence_added', null, null, p_ev => public.t_id('ED2')), '23503|%dossier_events_evidence_fk%', 'evidence of another dossier rejected');
select is(public.t_ev(public.t_id('D1'), 99, 'evidence_added', null, null, p_ev => public.t_id('E2')), 'ok', 'evidence of the same dossier accepted');
select alike(public.t_ev(public.t_id('D1'), 0, 'responsible_changed', null, null), '23514|%dossier_events_seq_check%', 'event seq 0 rejected');
select alike(public.t_ev(public.t_id('D1'), 501, 'responsible_changed', null, null), '23514|%dossier_events_seq_check%', 'event seq 501 rejected');
select is(public.t_ev(public.t_id('D1'), 500, 'responsible_changed', null, null), 'ok', 'event seq 500 accepted');
select alike(public.t_ev(public.t_id('D1'), 1, 'responsible_changed', null, null), '23505%', 'duplicate (dossier, seq) rejected');
select alike(public.t_ev(public.t_id('D1'), 99, 'responsible_changed', null, null, repeat('n', 1001)), '23514|%dossier_events_note_check%', 'event note of 1001 chars rejected');
select alike(public.t_ev(public.t_id('D1'), 99, 'responsible_changed', null, null, ' nota'), '23514|%dossier_events_note_check%', 'event note not plain text rejected');
select is(public.t_err(format('update public.dossier_events set note = ''x'' where dossier_id = %L and seq = 1', public.t_id('D1'))), '55000|append_only_audit', 'event update blocked');
select is(public.t_err(format('delete from public.dossier_events where dossier_id = %L and seq = 1', public.t_id('D1'))), '55000|append_only_audit', 'event delete blocked');
select is(public.t_err('truncate public.dossier_events cascade'), '55000|append_only_audit', 'event truncate blocked');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'dossier_events' and column_name ~ 'name|email'), 0, 'dossier_events has no name or email column');

-- 10. dossier_event_evidence and the deferred evidence constraint (on D2)
select is(public.t_ev(public.t_id('D2'), 1, 'promoted', null, 'en_revision', p_keep => true), 'ok', 'D2 promoted event inserted');
select is(public.t_def(public.t_id('D2'), 2, 'en_revision', 'planeado', null, false), 'ok', 'status_change to planeado needs no evidence');
select is(public.t_def(public.t_id('D2'), 3, 'planeado', 'en_ejecucion', null, false), '23514|dossier_event_requires_evidence', 'en_ejecucion without a link fails the deferred check');
select is(public.t_def(public.t_id('D2'), 3, 'planeado', 'en_ejecucion', public.t_id('ED2'), true), 'ok', 'en_ejecucion with a link passes the deferred check');
select is(public.t_def(public.t_id('D2'), 4, 'en_ejecucion', 'ejecutado', null, false), '23514|dossier_event_requires_evidence', 'ejecutado without a link fails the deferred check');
select is(public.t_def(public.t_id('D2'), 4, 'en_ejecucion', 'ejecutado', public.t_id('ED2'), true), 'ok', 'ejecutado with a link passes the deferred check');
select is(public.t_def(public.t_id('D2'), 5, 'en_ejecucion', 'descartado', null, false), 'ok', 'descartado needs no evidence');
select is((select count(*)::int from public.dossier_events where dossier_id = public.t_id('D2')), 5, 'failed events were rolled back: D2 holds 5 events');
select is((select count(*)::int from public.dossier_event_evidence where dossier_id = public.t_id('D2')), 2, 'D2 holds 2 evidence links');
select alike(public.t_chk(format('insert into public.dossier_event_evidence (event_id, evidence_id, dossier_id) select id, %L, %L from public.dossier_events where dossier_id = %L and seq = 3', public.t_id('E1'), public.t_id('D2'), public.t_id('D2'))),
  '23503|%dossier_event_evidence_item_fk%', 'link to evidence of another dossier rejected');
select alike(public.t_chk(format('insert into public.dossier_event_evidence (event_id, evidence_id, dossier_id) select id, %L, %L from public.dossier_events where dossier_id = %L and seq = 1', public.t_id('ED2'), public.t_id('D1'), public.t_id('D2'))),
  '23503|%', 'link with a mismatched dossier id rejected');
select alike(public.t_chk(format('insert into public.dossier_event_evidence (event_id, evidence_id, dossier_id) select id, %L, %L from public.dossier_events where dossier_id = %L and seq = 1', public.t_id('E1'), public.t_id('D1'), public.t_id('D2'))),
  '23503|%', 'link of an event of another dossier rejected');
select is(public.t_err(format('update public.dossier_event_evidence set evidence_id = evidence_id where dossier_id = %L', public.t_id('D2'))), '55000|append_only_audit', 'link update blocked');
select is(public.t_err(format('delete from public.dossier_event_evidence where dossier_id = %L', public.t_id('D2'))), '55000|append_only_audit', 'link delete blocked');
select is(public.t_err('truncate public.dossier_event_evidence cascade'), '55000|append_only_audit', 'link truncate blocked');

-- 11. Function grants, SECURITY DEFINER, search_path
select is(has_function_privilege(r, f::regprocedure, 'EXECUTE'), false, r || ' cannot execute ' || f)
from unnest(array['anon', 'authenticated']) as r
cross join unnest(array[
  'public.is_site_coordinator(uuid,uuid)',
  'public.ledger_replay(uuid,text,text,text)',
  'public.ledger_store(uuid,text,text,text,jsonb)',
  'public.dossier_prepare(uuid,uuid,boolean)',
  'public.dossier_append_event(uuid,public.dossier_event_kind,public.dossier_status,public.dossier_status,uuid,uuid,uuid,text,text,text,uuid)',
  'public.dossier_transition_allowed(public.dossier_status,public.dossier_status)',
  'public.dossier_parts(uuid)',
  'public.limit_dossier_change()', 'public.limit_milestone_change()', 'public.limit_evidence_change()',
  'public.dossier_event_requires_evidence()']) as f;
select is(has_function_privilege('anon', f::regprocedure, 'EXECUTE'), false, 'anon cannot execute ' || f)
from unnest(array[
  'public.promote_dossier(uuid,text,text,boolean,date,text,text)',
  'public.set_dossier_responsible(uuid,text,boolean,text,text)',
  'public.add_milestone(uuid,text,date,text,text)',
  'public.update_milestone(uuid,public.milestone_status,text,date,public.milestone_status,text,text)',
  'public.add_evidence(uuid,text,text,text,date,text,text)',
  'public.set_evidence_verified(uuid,boolean)',
  'public.transition_dossier(uuid,public.dossier_status,public.dossier_status,text,text,text,uuid[],text,text)',
  'public.revert_last_status_change(uuid,public.dossier_status,text,text,text)',
  'public.get_managed_dossier(uuid)']) as f;
select is(has_function_privilege('authenticated', f::regprocedure, 'EXECUTE'), true, 'authenticated can execute ' || f)
from unnest(array[
  'public.promote_dossier(uuid,text,text,boolean,date,text,text)',
  'public.set_dossier_responsible(uuid,text,boolean,text,text)',
  'public.add_milestone(uuid,text,date,text,text)',
  'public.update_milestone(uuid,public.milestone_status,text,date,public.milestone_status,text,text)',
  'public.add_evidence(uuid,text,text,text,date,text,text)',
  'public.set_evidence_verified(uuid,boolean)',
  'public.transition_dossier(uuid,public.dossier_status,public.dossier_status,text,text,text,uuid[],text,text)',
  'public.revert_last_status_change(uuid,public.dossier_status,text,text,text)',
  'public.get_managed_dossier(uuid)']) as f;
select is(has_function_privilege(r, f::regprocedure, 'EXECUTE'), true, r || ' can execute ' || f)
from unnest(array['anon', 'authenticated']) as r
cross join unnest(array[
  'public.public_dossier_exists(uuid)', 'public.get_public_dossier(uuid)',
  'public.get_publication_dossier(uuid)', 'public.list_public_dossiers(uuid,timestamptz,uuid,integer)']) as f;
select is((select p.prosecdef from pg_proc as p where p.oid = f::regprocedure), true, f || ' is SECURITY DEFINER')
from unnest(array[
  'public.is_site_coordinator(uuid,uuid)', 'public.ledger_replay(uuid,text,text,text)',
  'public.ledger_store(uuid,text,text,text,jsonb)', 'public.dossier_prepare(uuid,uuid,boolean)',
  'public.dossier_append_event(uuid,public.dossier_event_kind,public.dossier_status,public.dossier_status,uuid,uuid,uuid,text,text,text,uuid)',
  'public.dossier_parts(uuid)',
  'public.promote_dossier(uuid,text,text,boolean,date,text,text)',
  'public.set_dossier_responsible(uuid,text,boolean,text,text)',
  'public.add_milestone(uuid,text,date,text,text)',
  'public.update_milestone(uuid,public.milestone_status,text,date,public.milestone_status,text,text)',
  'public.add_evidence(uuid,text,text,text,date,text,text)',
  'public.set_evidence_verified(uuid,boolean)',
  'public.transition_dossier(uuid,public.dossier_status,public.dossier_status,text,text,text,uuid[],text,text)',
  'public.revert_last_status_change(uuid,public.dossier_status,text,text,text)',
  'public.get_managed_dossier(uuid)',
  'public.public_dossier_exists(uuid)', 'public.get_public_dossier(uuid)',
  'public.get_publication_dossier(uuid)', 'public.list_public_dossiers(uuid,timestamptz,uuid,integer)']) as f;
select ok('search_path=""' = any (coalesce((select p.proconfig from pg_proc as p where p.oid = f::regprocedure), array[]::text[])), f || ' sets search_path to empty')
from unnest(array[
  'public.is_site_coordinator(uuid,uuid)', 'public.ledger_replay(uuid,text,text,text)',
  'public.ledger_store(uuid,text,text,text,jsonb)', 'public.dossier_prepare(uuid,uuid,boolean)',
  'public.dossier_append_event(uuid,public.dossier_event_kind,public.dossier_status,public.dossier_status,uuid,uuid,uuid,text,text,text,uuid)',
  'public.dossier_transition_allowed(public.dossier_status,public.dossier_status)',
  'public.dossier_parts(uuid)',
  'public.limit_dossier_change()', 'public.limit_milestone_change()', 'public.limit_evidence_change()',
  'public.dossier_event_requires_evidence()',
  'public.promote_dossier(uuid,text,text,boolean,date,text,text)',
  'public.set_dossier_responsible(uuid,text,boolean,text,text)',
  'public.add_milestone(uuid,text,date,text,text)',
  'public.update_milestone(uuid,public.milestone_status,text,date,public.milestone_status,text,text)',
  'public.add_evidence(uuid,text,text,text,date,text,text)',
  'public.set_evidence_verified(uuid,boolean)',
  'public.transition_dossier(uuid,public.dossier_status,public.dossier_status,text,text,text,uuid[],text,text)',
  'public.revert_last_status_change(uuid,public.dossier_status,text,text,text)',
  'public.get_managed_dossier(uuid)',
  'public.public_dossier_exists(uuid)', 'public.get_public_dossier(uuid)',
  'public.get_publication_dossier(uuid)', 'public.list_public_dossiers(uuid,timestamptz,uuid,integer)']) as f;

select * from finish();
rollback;
