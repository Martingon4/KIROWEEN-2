-- Cost catalog v1 for the pilot (FT-12). Every price is an illustrative evaluation
-- assumption, not a supplier quote. Source: data/catalogs/zocalo-puebla-v1.json
-- (sha256 debf6ae1aa5503d06cec1ff47dfb936e07b1ebf0c9e523e20207fd7bf6a3e5ce).
-- app.catalog_bootstrap allows the first version to carry its documented past date.
set local app.catalog_bootstrap = 'on';

insert into public.catalog_versions (
  id, site_id, currency, version, effective_from, source, price_date,
  is_illustrative, assumption_owner, checksum
)
values (
  '8f5a6417-0000-4000-8000-0000000000c1',
  '8f5a6417-5f6d-4f02-a50c-76d97167db99',
  'MXN',
  'v1',
  '2026-11-22T00:00:00Z',
  'Illustrative evaluation prices, not a supplier quote',
  '2026-11-22',
  true,
  'Equipo del piloto Fork the City',
  'debf6ae1aa5503d06cec1ff47dfb936e07b1ebf0c9e523e20207fd7bf6a3e5ce'
)
on conflict (site_id, version) do nothing;

insert into public.catalog_items (
  catalog_version_id, code, kind, unit, quantity_formula,
  price_low_cents, price_high_cents, is_assumption, assumption_owner, assumption_date
)
values
  ('8f5a6417-0000-4000-8000-0000000000c1', 'shade-tree-unit', 'shade_tree', 'u',
   '1 per tree', 450000, 1200000, true, 'Equipo del piloto Fork the City', '2026-11-22'),
  ('8f5a6417-0000-4000-8000-0000000000c1', 'shade-canopy-m2', 'shade_canopy', 'm2',
   'polygon area in m²', 180000, 350000, true, 'Equipo del piloto Fork the City', '2026-11-22'),
  ('8f5a6417-0000-4000-8000-0000000000c1', 'market-stall-session', 'temporary_market', 'jornada',
   'stallCount per session', 15000, 40000, true, 'Equipo del piloto Fork the City', '2026-11-22'),
  ('8f5a6417-0000-4000-8000-0000000000c1', 'crossing-m2', 'proposed_crossing', 'm2',
   'length in m × widthM', 90000, 160000, true, 'Equipo del piloto Fork the City', '2026-11-22')
on conflict (catalog_version_id, code) do nothing;
