import type {
  Intervention,
  InterventionGeometry,
} from "@/lib/schemas/intervention";

/** Canonical coordinate precision (about 0.11 m), shared with the database snap-to-grid. */
export const COORDINATE_DECIMALS = 6;
const SCALE = 10 ** COORDINATE_DECIMALS;

export function roundCoordinate(value: number): number {
  const rounded = Math.round(value * SCALE) / SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

type Position = readonly [number, number];

function roundPosition([longitude, latitude]: Position): [number, number] {
  return [roundCoordinate(longitude), roundCoordinate(latitude)];
}

export function canonicalizeGeometry(
  geometry: InterventionGeometry,
): InterventionGeometry {
  switch (geometry.type) {
    case "Point":
      return {
        type: "Point",
        coordinates: roundPosition(geometry.coordinates),
      };
    case "LineString":
      return {
        type: "LineString",
        coordinates: geometry.coordinates.map(roundPosition),
      };
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map((ring) =>
          ring.map(roundPosition),
        ),
      };
  }
}

/** Rounds coordinates and orders features by id so equal snapshots serialize identically. */
export function canonicalizeFeatures(
  features: readonly Intervention[],
): Intervention[] {
  return [...features]
    .map(
      (feature) =>
        ({
          ...feature,
          // UUIDs are case-insensitive in the database; normalize so duplicates match.
          id: feature.id.toLowerCase(),
          geometry: canonicalizeGeometry(feature.geometry),
        }) as Intervention,
    )
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
}

/** JSON serialization with recursively sorted object keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function sameSnapshot(
  left: readonly Intervention[],
  right: readonly Intervention[],
): boolean {
  return (
    canonicalJson(canonicalizeFeatures(left)) ===
    canonicalJson(canonicalizeFeatures(right))
  );
}
