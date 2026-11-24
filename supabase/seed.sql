-- Identified local/demo seed. The boundary is sourced; no scenario feature is an observed fact.
insert into public.sites (
  id,
  slug,
  name_es,
  name_en,
  locality_es,
  locality_en,
  timezone,
  currency,
  metric_srid,
  completeness,
  published
)
values (
  '8f5a6417-5f6d-4f02-a50c-76d97167db99',
  'zocalo-puebla',
  'Plaza de la Constitución',
  'Plaza de la Constitución',
  'Centro Histórico de Puebla, México',
  'Historic Centre of Puebla, Mexico',
  'America/Mexico_City',
  'MXN',
  32614,
  'partial',
  true
)
on conflict (id) do update set
  name_es = excluded.name_es,
  name_en = excluded.name_en,
  locality_es = excluded.locality_es,
  locality_en = excluded.locality_en,
  completeness = excluded.completeness,
  published = excluded.published;

insert into public.site_baselines (
  id,
  site_id,
  version,
  boundary,
  source_url,
  source_license,
  source_attribution,
  capture_date,
  source_checksum,
  coverage_note_es,
  coverage_note_en,
  is_active
)
values (
  'c6548481-726d-453f-a70e-f56db772277d',
  '8f5a6417-5f6d-4f02-a50c-76d97167db99',
  1,
  extensions.st_setsrid(extensions.st_geomfromgeojson($geojson$
    {"type":"Polygon","coordinates":[[[-98.1988758,19.0437283],[-98.1988709,19.0436996],[-98.1988661,19.0436715],[-98.1983477,19.0434168],[-98.1982638,19.043375],[-98.1981777,19.043334],[-98.1976645,19.0430895],[-98.1976278,19.0431046],[-98.1975763,19.0431257],[-98.1973016,19.0435999],[-98.1973138,19.0436673],[-98.197845,19.0439318],[-98.1979451,19.0439817],[-98.1980139,19.0440159],[-98.1985181,19.0442743],[-98.1985809,19.0442518],[-98.1988758,19.0437283]]]}
  $geojson$), 4326),
  'https://www.openstreetmap.org/way/528509571',
  'ODbL-1.0',
  '© OpenStreetMap contributors',
  '2026-11-22',
  '1c2ab5800578895d7a4be092704de1e9bcf9c9e1032b17ca1d34daac10bfa1e7',
  'Cobertura parcial: solo el límite de la plaza; no es un inventario de sitio.',
  'Partial coverage: square boundary only; this is not a site inventory.',
  true
)
on conflict (id) do update set
  source_checksum = excluded.source_checksum,
  coverage_note_es = excluded.coverage_note_es,
  coverage_note_en = excluded.coverage_note_en,
  is_active = excluded.is_active;
