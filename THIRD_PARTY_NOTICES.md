# Third-party notices

## OpenStreetMap

The pilot boundary is derived from OpenStreetMap data obtained through Nominatim.

© OpenStreetMap contributors. Data is available under the Open Database License (ODbL) 1.0.

- https://www.openstreetmap.org/copyright
- https://opendatacommons.org/licenses/odbl/1-0/

## Software dependencies

Runtime and development dependencies retain their respective licenses. The resolved dependency graph is recorded by `package-lock.json`. Run the release license audit before public distribution and update this file with any attribution requirements that apply to bundled assets.

## MapLibre GL JS

The interactive pilot map uses MapLibre GL JS. Its packaged worker is copied from the pinned npm dependency into `public/maplibre-gl-worker.mjs` for Next.js/Turbopack compatibility.

Copyright MapLibre contributors. MapLibre GL JS is distributed under the BSD 3-Clause License.

- https://github.com/maplibre/maplibre-gl-js

## Atkinson Hyperlegible

The interface uses Atkinson Hyperlegible through Next.js font self-hosting. The typeface is distributed under the SIL Open Font License 1.1.

- https://fonts.google.com/specimen/Atkinson+Hyperlegible
## SunCalc
`scripts/generate-solar-scenarios.mjs` uses SunCalc 1.9.0 (pinned devDependency) at build time to precompute the curated solar scenarios in `data/sites/zocalo-puebla/solar-scenarios.json`. SunCalc is not shipped to the browser or run at request time.
Copyright (c) 2014, Vladimir Agafonkin. SunCalc is distributed under the BSD 2-Clause License (see `node_modules/suncalc/LICENSE`).
- https://github.com/mourner/suncalc
