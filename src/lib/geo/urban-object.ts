import { roundCoordinate } from "./canonical";
import { edgesIntersect, ringCoversPoint } from "./planar";
import type { Intervention } from "@/lib/schemas/intervention";
import {
  terrainObjects,
  type TerrainObjectKind,
} from "@/lib/schemas/terrain-objects";

type Position = readonly [number, number];

export function urbanObjectCenter(ring: readonly Position[]): [number, number] {
  const east = ring.map(([x]) => x);
  const north = ring.map(([, y]) => y);
  return [
    (Math.min(...east) + Math.max(...east)) / 2,
    (Math.min(...north) + Math.max(...north)) / 2,
  ];
}

export function urbanObjectFootprint(
  kind: TerrainObjectKind,
  [longitude, latitude]: Position,
) {
  const { width, depth } = terrainObjects[kind];
  const eastScale = 111_195 * Math.cos((latitude * Math.PI) / 180);
  const at = (east: number, north: number): Position => [
    roundCoordinate(roundCoordinate(longitude) + east / eastScale),
    roundCoordinate(roundCoordinate(latitude) + north / 111_195),
  ];
  const lower = at(-width / 2, -depth / 2);
  const upper = at(width / 2, depth / 2);
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        lower,
        [upper[0], lower[1]] as Position,
        upper,
        [lower[0], upper[1]] as Position,
        lower,
      ],
    ],
  };
}

export function urbanObjectsOverlap(first: Intervention, second: Intervention) {
  const [object, other] =
    first.kind === "urban_object" ? [first, second] : [second, first];
  if (object.kind !== "urban_object") return false;
  const footprint = object.geometry.coordinates[0];
  if (other.kind === "shade_tree")
    return ringCoversPoint(other.geometry.coordinates, footprint);
  if (other.kind !== "urban_object" && other.kind !== "temporary_market")
    return false;
  const ring = other.geometry.coordinates[0];
  return (
    ringCoversPoint(footprint[0], ring) ||
    ringCoversPoint(ring[0], footprint) ||
    footprint
      .slice(1)
      .some((end, i) =>
        ring
          .slice(1)
          .some((otherEnd, j) =>
            edgesIntersect(footprint[i], end, ring[j], otherEnd),
          ),
      )
  );
}
