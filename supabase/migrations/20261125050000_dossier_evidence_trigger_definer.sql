-- The deferred evidence check runs at COMMIT as the calling role, which has no grant on
-- dossier_event_evidence. Run it as the owner, with an empty search_path.
create or replace function public.dossier_event_requires_evidence()
returns trigger
language plpgsql
security definer
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
