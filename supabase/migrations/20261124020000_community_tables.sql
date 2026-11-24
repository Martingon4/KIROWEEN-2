-- Community and moderation schema (FT-09, FT-10), spec 04 task 2.
-- No table is readable by anon or authenticated: every read goes through an RPC that
-- applies visibility and permission rules. RLS stays enabled with no policies.

create type public.report_reason as enum ('spam', 'harassment', 'misinformation', 'privacy', 'other');
create type public.report_state as enum ('open', 'actioned', 'dismissed');
create type public.moderation_target_kind as enum ('publication', 'comment');
create type public.moderation_action as enum ('hide', 'restore', 'dismiss');

-- Plain-text rule shared by every community text column: trimmed like JavaScript trim,
-- no C0/C1 control characters except newline, no bidirectional override or isolate
-- characters (they allow spoofing the order of displayed text).
create or replace function public.plain_text_ok(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null
    and p_text = public.js_trim(p_text)
    and p_text !~ '[\x01-\x09\x0B-\x1F\x7F-\x9F\u202A-\u202E\u2066-\u2069]';
$$;

revoke all on function public.plain_text_ok(text) from public, anon, authenticated;

-- Audit trail: append-only. Moderation facts are never edited or removed.
create table public.moderation_events (
  id uuid primary key,
  site_id uuid not null references public.sites (id) on delete restrict,
  target_kind public.moderation_target_kind not null,
  publication_id uuid not null references public.publications (id) on delete restrict,
  comment_id uuid,
  action public.moderation_action not null,
  reason text not null check (char_length(reason) between 1 and 500 and public.plain_text_ok(reason)),
  private_note text check (
    private_note is null
    or (char_length(private_note) between 1 and 500 and public.plain_text_ok(private_note))
  ),
  actor_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint moderation_events_target_shape check ((target_kind = 'comment') = (comment_id is not null))
);

create index moderation_events_target_idx
  on public.moderation_events (site_id, publication_id, comment_id, created_at);

create table public.comments (
  id uuid primary key,
  publication_id uuid not null,
  revision_id uuid not null,
  feature_id uuid,
  author_id uuid not null references auth.users (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 1000 and public.plain_text_ok(body)),
  moderation_state public.publication_moderation_state not null default 'visible',
  retracted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, publication_id),
  -- The publication and the revision it fixed must pair up.
  constraint comments_publication_fk
    foreign key (publication_id, revision_id)
    references public.publications (id, revision_id)
    on delete restrict,
  -- An anchor must be a feature of that exact published revision (MATCH SIMPLE skips null).
  constraint comments_anchor_fk
    foreign key (revision_id, feature_id)
    references public.revision_features (revision_id, feature_id)
    on delete restrict
);

create index comments_public_page_idx
  on public.comments (publication_id, created_at, id)
  where moderation_state = 'visible' and retracted_at is null;

create index comments_author_idx on public.comments (author_id, publication_id);

alter table public.moderation_events
  add constraint moderation_events_comment_fk
    foreign key (comment_id, publication_id)
    references public.comments (id, publication_id)
    on delete restrict;

create table public.supports (
  publication_id uuid not null references public.publications (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (publication_id, user_id)
);

create index supports_user_idx on public.supports (user_id);

create table public.reports (
  id uuid primary key,
  site_id uuid not null references public.sites (id) on delete restrict,
  target_kind public.moderation_target_kind not null,
  publication_id uuid not null references public.publications (id) on delete restrict,
  comment_id uuid,
  reporter_id uuid not null references auth.users (id) on delete restrict,
  reason public.report_reason not null,
  note text check (
    note is null or (char_length(note) between 1 and 500 and public.plain_text_ok(note))
  ),
  state public.report_state not null default 'open',
  resolved_by uuid references auth.users (id) on delete restrict,
  resolved_at timestamptz,
  resolution_event_id uuid references public.moderation_events (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint reports_comment_fk
    foreign key (comment_id, publication_id)
    references public.comments (id, publication_id)
    on delete restrict,
  constraint reports_target_shape check ((target_kind = 'comment') = (comment_id is not null)),
  -- An open report has no resolution; a resolved one always has actor, time, and event.
  constraint reports_resolution_shape check (
    (state = 'open' and resolved_at is null and resolved_by is null and resolution_event_id is null)
    or (state <> 'open' and resolved_at is not null and resolved_by is not null and resolution_event_id is not null)
  )
);

-- One open report per reporter and target; a duplicate returns the existing report.
create unique index reports_one_open_publication_idx
  on public.reports (reporter_id, publication_id)
  where target_kind = 'publication' and state = 'open';

create unique index reports_one_open_comment_idx
  on public.reports (reporter_id, comment_id)
  where target_kind = 'comment' and state = 'open';

create index reports_site_queue_idx on public.reports (site_id, state, created_at, id);

-- Reports and events must name the site that owns the publication.
create or replace function public.community_site_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.publications as p
    join public.revisions as r on r.id = p.revision_id
    where p.id = new.publication_id
      and r.site_id = new.site_id
  ) then
    raise exception using errcode = '23514', message = 'community_site_mismatch';
  end if;
  return new;
end;
$$;

revoke all on function public.community_site_matches() from public, anon, authenticated;

create trigger reports_site_matches
  before insert on public.reports
  for each row execute function public.community_site_matches();

create trigger moderation_events_site_matches
  before insert on public.moderation_events
  for each row execute function public.community_site_matches();

create or replace function public.prevent_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'append_only_audit';
end;
$$;

revoke all on function public.prevent_audit_change() from public, anon, authenticated;

create trigger moderation_events_append_only
  before update or delete on public.moderation_events
  for each row execute function public.prevent_audit_change();

create trigger moderation_events_no_truncate
  before truncate on public.moderation_events
  for each statement execute function public.prevent_audit_change();

-- Comments change only through moderation_state and a one-way retraction.
create or replace function public.limit_comment_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (
      old.id, old.publication_id, old.revision_id, old.feature_id,
      old.author_id, old.body, old.created_at
    ) is not distinct from (
      new.id, new.publication_id, new.revision_id, new.feature_id,
      new.author_id, new.body, new.created_at
    )
    and (old.retracted_at is null or new.retracted_at is not distinct from old.retracted_at)
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'immutable_comment';
end;
$$;

revoke all on function public.limit_comment_change() from public, anon, authenticated;

create trigger comments_limited_change
  before update or delete on public.comments
  for each row execute function public.limit_comment_change();

create trigger comments_no_truncate
  before truncate on public.comments
  for each statement execute function public.limit_comment_change();

-- Reports resolve once: open to actioned or dismissed, resolution columns only.
create or replace function public.limit_report_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.state = 'open'
    and new.state <> 'open'
    and (
      old.id, old.site_id, old.target_kind, old.publication_id, old.comment_id,
      old.reporter_id, old.reason, old.note, old.created_at
    ) is not distinct from (
      new.id, new.site_id, new.target_kind, new.publication_id, new.comment_id,
      new.reporter_id, new.reason, new.note, new.created_at
    )
  then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'immutable_report';
end;
$$;

revoke all on function public.limit_report_change() from public, anon, authenticated;

create trigger reports_limited_change
  before update or delete on public.reports
  for each row execute function public.limit_report_change();

create trigger reports_no_truncate
  before truncate on public.reports
  for each statement execute function public.limit_report_change();

alter table public.comments enable row level security;
alter table public.supports enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_events enable row level security;

revoke all on table public.comments from anon, authenticated;
revoke all on table public.supports from anon, authenticated;
revoke all on table public.reports from anon, authenticated;
revoke all on table public.moderation_events from anon, authenticated;
