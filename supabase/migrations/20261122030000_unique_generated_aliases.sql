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
    'participant-' || right(replace(new.id::text, '-', ''), 8)
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
