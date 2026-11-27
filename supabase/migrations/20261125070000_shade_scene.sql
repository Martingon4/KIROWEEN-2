-- Return the geometry of one visible snapshot in the analysis engine's metric CRS.
create function public.get_shade_scene(p_ref text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'surface', extensions.st_asgeojson(
      extensions.st_multi(extensions.st_transform(
        coalesce(b.pedestrian_area, b.boundary), s.metric_srid)), 3, 0
    )::jsonb -> 'coordinates',
    'elements', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', f.feature_id,
          'kind', f.kind,
          'heightM', f.properties -> 'heightM',
          'canopyDiameterM', f.properties -> 'canopyDiameterM',
          'coordinates', extensions.st_asgeojson(
            extensions.st_transform(f.geometry, s.metric_srid), 3, 0
          )::jsonb -> 'coordinates'
        ) order by f.feature_id
      )
      from public.revision_features as f
      where f.revision_id = r.revision_id
        and f.kind in ('shade_canopy', 'shade_tree')
    ), '[]'::jsonb)
  )
  from public.resolve_snapshot_ref(p_ref) as r
  join public.site_baselines as b on b.id = r.baseline_id
  join public.sites as s on s.id = r.site_id;
$$;

revoke all on function public.get_shade_scene(text) from public, anon, authenticated;
grant execute on function public.get_shade_scene(text) to anon, authenticated;
