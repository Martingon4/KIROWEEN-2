create or replace function public.assign_site_role(
  target_site_id uuid,
  target_user_id uuid,
  target_role public.site_role
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.site_roles (site_id, user_id, role)
  values (target_site_id, target_user_id, target_role)
  on conflict (site_id, user_id, role) do nothing;
$$;

revoke all on function public.assign_site_role(uuid, uuid, public.site_role)
  from public, anon, authenticated;
grant execute on function public.assign_site_role(uuid, uuid, public.site_role)
  to service_role;

comment on function public.assign_site_role(uuid, uuid, public.site_role) is
  'Operator-only role assignment used by local provisioning and documented operations.';
