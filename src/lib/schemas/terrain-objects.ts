// These kinds are also accepted by the revision database.
export const revisionObjectKinds = [
  "bench",
  "planter",
  "picnic_table",
  "parasol",
  "lamp",
  "bike_rack",
  "waste_bin",
  "fountain",
  "swing",
  "stall",
  "ramp",
  "bollard",
  "water_station",
  "table_tennis",
  "slide",
  "stage",
] as const;

// Built modules belong to the local terrain simulator, not to published revisions.
export const terrainObjectKinds = [
  ...revisionObjectKinds,
  "community_room",
  "civic_pavilion",
] as const;

export type RevisionObjectKind = (typeof revisionObjectKinds)[number];
export type TerrainObjectKind = (typeof terrainObjectKinds)[number];

export const terrainObjectGroups: Record<
  "shade" | "furniture" | "activity" | "access" | "construction",
  TerrainObjectKind[]
> = {
  shade: ["parasol"],
  furniture: [
    "bench",
    "planter",
    "picnic_table",
    "lamp",
    "bike_rack",
    "waste_bin",
    "water_station",
  ],
  activity: ["stall", "fountain", "swing", "table_tennis", "slide", "stage"],
  access: ["ramp", "bollard"],
  construction: ["community_room", "civic_pavilion"],
};

export const terrainObjects: Record<
  TerrainObjectKind,
  { width: number; depth: number; height: number; round?: boolean }
> = {
  bench: { width: 1.8, depth: 0.65, height: 0.95 },
  planter: { width: 0.95, depth: 0.95, height: 0.7 },
  picnic_table: { width: 1.85, depth: 1.65, height: 0.78 },
  parasol: { width: 2.8, depth: 2.8, height: 2.65, round: true },
  lamp: { width: 0.45, depth: 0.45, height: 3.5, round: true },
  bike_rack: { width: 1.75, depth: 0.55, height: 0.88 },
  waste_bin: { width: 0.52, depth: 0.52, height: 0.88, round: true },
  fountain: { width: 2.8, depth: 2.8, height: 1.25, round: true },
  swing: { width: 3.2, depth: 2.3, height: 2.5 },
  stall: { width: 2.52, depth: 1.36, height: 2.53 },
  ramp: { width: 1.4, depth: 3.2, height: 0.65 },
  bollard: { width: 0.28, depth: 0.28, height: 0.85, round: true },
  water_station: { width: 0.7, depth: 0.65, height: 1.15 },
  table_tennis: { width: 2.74, depth: 1.52, height: 0.92 },
  slide: { width: 1.65, depth: 3.45, height: 2.3 },
  stage: { width: 4.8, depth: 3.1, height: 0.65 },
  community_room: { width: 5.2, depth: 4.2, height: 3.8 },
  civic_pavilion: { width: 5.6, depth: 4.4, height: 4.2 },
};

export function terrainDimensions(kind: TerrainObjectKind, dimensionsM?: readonly [number, number]) {
  const fallback = terrainObjects[kind];
  return {
    width: dimensionsM?.[0] ?? fallback.width,
    depth: dimensionsM?.[1] ?? fallback.depth,
  };
}
