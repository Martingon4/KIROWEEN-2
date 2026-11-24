-- Cheap existence check for public publication pages (FT-06).
-- Proxy calls it before streaming starts so a missing or hidden publication returns a
-- real HTTP 404 instead of a streamed not-found page with status 200. It returns only
-- a boolean, using the same visibility rule as get_public_publication.
create or replace function public.public_publication_exists(p_publication_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.publications as p
    where p.id = p_publication_id
      and p.moderation_state = 'visible'
  );
$$;

revoke all on function public.public_publication_exists(uuid) from public;
grant execute on function public.public_publication_exists(uuid) to anon, authenticated;
