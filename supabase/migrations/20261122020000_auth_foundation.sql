create type public.site_role as enum ('coordinator', 'moderator');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  public_alias text not null unique check (char_length(public_alias) between 3 and 40),
  created_at timestamptz not null default now()
);

create table public.site_roles (
  site_id uuid not null references public.sites (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.site_role not null,
  created_at timestamptz not null default now(),
  primary key (site_id, user_id, role)
);

alter table public.site_baselines
  add constraint site_baselines_id_site_unique unique (id, site_id);

create table public.branches (
  id uuid primary key,
  site_id uuid not null references public.sites (id) on delete restrict,
  baseline_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 100),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint branches_baseline_site_fk
    foreign key (baseline_id, site_id)
    references public.site_baselines (id, site_id)
    on delete restrict
);

create index branches_owner_created_idx on public.branches (owner_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.site_roles enable row level security;
alter table public.branches enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.site_roles from anon, authenticated;
revoke all on table public.branches from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (public_alias) on table public.profiles to authenticated;
grant select on table public.site_roles to authenticated;
grant select on table public.branches to authenticated;

create policy profiles_select_self
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy site_roles_select_self
  on public.site_roles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy branches_select_owner
  on public.branches
  for select
  to authenticated
  using ((select auth.uid()) = owner_id and not is_deleted);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, public_alias)
  values (
    new.id,
    'participant-' || left(replace(new.id::text, '-', ''), 8)
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
