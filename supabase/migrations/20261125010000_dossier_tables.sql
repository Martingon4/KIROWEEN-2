-- Dossiers, milestones, evidence, and the append-only event log (FT-13, FT-14),
-- spec 05 task 1. Like the community tables, nothing here is readable or writable by
-- anon or authenticated: every read and write goes through an RPC that applies
-- permission and visibility rules. RLS stays enabled with no policies.

create type public.dossier_status as enum (
  'en_revision', 'planeado', 'en_ejecucion', 'ejecutado', 'descartado'
);
create type public.milestone_status as enum ('pendiente', 'cumplido', 'cancelado');
create type public.dossier_event_kind as enum (
  'promoted', 'status_change', 'milestone_added', 'milestone_updated',
  'evidence_added', 'evidence_verified', 'responsible_changed', 'correction'
);

-- en_revision -> planeado -> en_ejecucion -> ejecutado; descartado from the first three.
create or replace function public.dossier_transition_allowed(
  p_previous public.dossier_status,
  p_next public.dossier_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_previous = 'en_revision' and p_next in ('planeado', 'descartado') then true
    when p_previous = 'planeado' and p_next in ('en_ejecucion', 'descartado') then true
    when p_previous = 'en_ejecucion' and p_next in ('ejecutado', 'descartado') then true
    else false
  end;
$$;

revoke all on function public.dossier_transition_allowed(public.dossier_status, public.dossier_status)
  from public, anon, authenticated;

create table public.dossiers (
  id uuid primary key,
  publication_id uuid not null unique,
  revision_id uuid not null,
  site_id uuid not null,
  scenario_slug text,
  status public.dossier_status not null default 'en_revision',
  decision_note text not null check (
    char_length(decision_note) between 1 and 1000 and public.plain_text_ok(decision_note)
  ),
  -- A name is stored only with the person's authorization, so a name implies consent.
  -- No address-like names: personal contact data is never collected.
  responsible_name text check (
    responsible_name is null
    or (char_length(responsible_name) between 1 and 100
        and public.plain_text_ok(responsible_name)
        and responsible_name !~ '@')
  ),
  responsible_authorized boolean not null default false,
  target_date date,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_event_seq integer not null default 0 check (last_event_seq between 0 and 500),
  constraint dossiers_name_implies_authorization check (
    responsible_authorized = (responsible_name is not null)
  ),
  constraint dossiers_publication_fk
    foreign key (publication_id, revision_id)
    references public.publications (id, revision_id)
    on delete restrict,
  constraint dossiers_revision_site_fk
    foreign key (revision_id, site_id)
    references public.revisions (id, site_id)
    on delete restrict,
  unique (id, site_id)
);

create index dossiers_site_updated_idx on public.dossiers (site_id, updated_at desc, id);

create table public.dossier_milestones (
  id uuid primary key,
  dossier_id uuid not null references public.dossiers (id) on delete restrict,
  position smallint not null check (position between 1 and 20),
  title text not null check (char_length(title) between 1 and 100 and public.plain_text_ok(title)),
  target_date date not null,
  status public.milestone_status not null default 'pendiente',
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dossier_id, position),
  unique (id, dossier_id)
);

create table public.evidence_items (
  id uuid primary key,
  dossier_id uuid not null references public.dossiers (id) on delete restrict,
  position smallint not null check (position between 1 and 50),
  -- Syntactic check only. The server never requests the URL; it is shown with its host
  -- and opened with noopener noreferrer.
  url text not null check (
    char_length(url) <= 2048
    and url ~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][^[:space:]<>"\\]*)?$'
  ),
  host text generated always as (lower(substring(url from '^https://([^/:?#]+)'))) stored,
  title text not null check (char_length(title) between 1 and 100 and public.plain_text_ok(title)),
  description text not null check (
    char_length(description) between 1 and 1000 and public.plain_text_ok(description)
  ),
  evidence_date date not null,
  recorded_by uuid not null references auth.users (id) on delete restrict,
  verified_by_team boolean not null default false,
  verified_by uuid references auth.users (id) on delete restrict,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (dossier_id, position),
  unique (id, dossier_id),
  constraint evidence_verification_shape check (
    verified_by_team = (verified_by is not null and verified_at is not null)
  )
);

create table public.dossier_events (
  id uuid primary key,
  dossier_id uuid not null references public.dossiers (id) on delete restrict,
  seq integer not null check (seq between 1 and 500),
  kind public.dossier_event_kind not null,
  previous_state public.dossier_status,
  new_state public.dossier_status,
  milestone_id uuid,
  evidence_id uuid,
  corrects_event_id uuid,
  note text check (note is null or (char_length(note) between 1 and 1000 and public.plain_text_ok(note))),
  observation text check (
    observation is null or (char_length(observation) between 1 and 1000 and public.plain_text_ok(observation))
  ),
  difference text check (
    difference is null or (char_length(difference) between 1 and 1000 and public.plain_text_ok(difference))
  ),
  actor_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (dossier_id, seq),
  unique (id, dossier_id),
  constraint dossier_events_milestone_fk
    foreign key (milestone_id, dossier_id) references public.dossier_milestones (id, dossier_id) on delete restrict,
  constraint dossier_events_evidence_fk
    foreign key (evidence_id, dossier_id) references public.evidence_items (id, dossier_id) on delete restrict,
  constraint dossier_events_corrects_fk
    foreign key (corrects_event_id, dossier_id) references public.dossier_events (id, dossier_id) on delete restrict,
  constraint dossier_events_promoted_shape check (
    kind <> 'promoted' or (new_state = 'en_revision' and previous_state is null)
  ),
  constraint dossier_events_status_change_shape check (
    kind <> 'status_change'
    or (
      previous_state is not null
      and new_state is not null
      and public.dossier_transition_allowed(previous_state, new_state)
      and note is not null
      and (new_state <> 'ejecutado' or (observation is not null and difference is not null))
    )
  ),
  constraint dossier_events_correction_shape check (
    kind <> 'correction' or (corrects_event_id is not null and note is not null)
  )
);

create index dossier_events_dossier_idx on public.dossier_events (dossier_id, seq);

-- The evidence a transition cites. Append-only.
create table public.dossier_event_evidence (
  event_id uuid not null,
  evidence_id uuid not null,
  dossier_id uuid not null,
  primary key (event_id, evidence_id),
  constraint dossier_event_evidence_event_fk
    foreign key (event_id, dossier_id) references public.dossier_events (id, dossier_id) on delete restrict,
  constraint dossier_event_evidence_item_fk
    foreign key (evidence_id, dossier_id) references public.evidence_items (id, dossier_id) on delete restrict
);

-- Starting or finishing execution without cited evidence is impossible by construction:
-- checked at commit, after the RPC inserted the event and its evidence links.
create or replace function public.dossier_event_requires_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.dossier_event_evidence as e where e.event_id = new.id
  ) then
    raise exception using errcode = '23514', message = 'dossier_event_requires_evidence';
  end if;
  return null;
end;
$$;

revoke all on function public.dossier_event_requires_evidence() from public, anon, authenticated;

create constraint trigger dossier_events_need_evidence
  after insert on public.dossier_events
  deferrable initially deferred
  for each row
  when (new.kind = 'status_change' and new.new_state in ('en_ejecucion', 'ejecutado'))
  execute function public.dossier_event_requires_evidence();

create or replace function public.limit_dossier_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (
      old.id, old.publication_id, old.revision_id, old.site_id, old.scenario_slug,
      old.decision_note, old.target_date, old.created_by, old.created_at
    ) is not distinct from (
      new.id, new.publication_id, new.revision_id, new.site_id, new.scenario_slug,
      new.decision_note, new.target_date, new.created_by, new.created_at
    )
    -- The sequence advances by exactly one and names an existing event; a status change
    -- must be explained by the event with that sequence.
    and (
      (new.last_event_seq = old.last_event_seq and new.status = old.status)
      or (
        new.last_event_seq = old.last_event_seq + 1
        and exists (
          select 1 from public.dossier_events as e
          where e.dossier_id = new.id
            and e.seq = new.last_event_seq
            and (new.status = old.status
                 or (e.new_state = new.status and e.kind in ('status_change', 'correction')))
        )
      )
    )
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'immutable_dossier';
end;
$$;

revoke all on function public.limit_dossier_change() from public, anon, authenticated;

create trigger dossiers_limited_change
  before update or delete on public.dossiers
  for each row execute function public.limit_dossier_change();

create trigger dossiers_no_truncate
  before truncate on public.dossiers
  for each statement execute function public.limit_dossier_change();

create or replace function public.limit_milestone_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (old.id, old.dossier_id, old.position, old.created_by, old.created_at)
        is not distinct from (new.id, new.dossier_id, new.position, new.created_by, new.created_at)
    and old.status <> 'cancelado'
    and (
      new.status = old.status
      or (old.status = 'pendiente' and new.status in ('cumplido', 'cancelado'))
      or (old.status = 'cumplido' and new.status = 'pendiente')
    )
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'immutable_milestone';
end;
$$;

revoke all on function public.limit_milestone_change() from public, anon, authenticated;

create trigger milestones_limited_change
  before update or delete on public.dossier_milestones
  for each row execute function public.limit_milestone_change();

create trigger milestones_no_truncate
  before truncate on public.dossier_milestones
  for each statement execute function public.limit_milestone_change();

-- Evidence is fixed once recorded; only the team verification may change.
create or replace function public.limit_evidence_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (
      old.id, old.dossier_id, old.position, old.url, old.title, old.description,
      old.evidence_date, old.recorded_by, old.created_at
    ) is not distinct from (
      new.id, new.dossier_id, new.position, new.url, new.title, new.description,
      new.evidence_date, new.recorded_by, new.created_at
    )
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'immutable_evidence';
end;
$$;

revoke all on function public.limit_evidence_change() from public, anon, authenticated;

create trigger evidence_limited_change
  before update or delete on public.evidence_items
  for each row execute function public.limit_evidence_change();

create trigger evidence_no_truncate
  before truncate on public.evidence_items
  for each statement execute function public.limit_evidence_change();

create trigger dossier_events_append_only
  before update or delete on public.dossier_events
  for each row execute function public.prevent_audit_change();

create trigger dossier_events_no_truncate
  before truncate on public.dossier_events
  for each statement execute function public.prevent_audit_change();

create trigger dossier_event_evidence_append_only
  before update or delete on public.dossier_event_evidence
  for each row execute function public.prevent_audit_change();

create trigger dossier_event_evidence_no_truncate
  before truncate on public.dossier_event_evidence
  for each statement execute function public.prevent_audit_change();

alter table public.dossiers enable row level security;
alter table public.dossier_milestones enable row level security;
alter table public.evidence_items enable row level security;
alter table public.dossier_events enable row level security;
alter table public.dossier_event_evidence enable row level security;

revoke all on table public.dossiers from anon, authenticated;
revoke all on table public.dossier_milestones from anon, authenticated;
revoke all on table public.evidence_items from anon, authenticated;
revoke all on table public.dossier_events from anon, authenticated;
revoke all on table public.dossier_event_evidence from anon, authenticated;
