# ADR 0001: Zócalo pilot with offline baseline

- **Status:** Accepted for the foundation slice
- **Date:** 2026-11-22

## Context

The demo needs an identifiable public place and must remain useful when a tile service or WebGL fails. Available phase-0 evidence establishes an OSM polygon for Plaza de la Constitución but not a complete inventory of the square.

## Decision

Use the OSM way polygon as the versioned study boundary. Render it first through an accessible local schematic and textual list. Store demonstration interventions separately and label them hypothetical. Add MapLibre and PMTiles only after their source, license, Range/CORS behavior, and fallback have tests.

## Consequences

- The first slice is deterministic and works offline after installation.
- It does not imply a surveyed pedestrian area or existing asset inventory.
- Spatial metrics using pedestrian coverage remain incomplete until a defensible denominator is accepted.
- The same public site adapter can later feed MapLibre without changing the source/proposal distinction.
