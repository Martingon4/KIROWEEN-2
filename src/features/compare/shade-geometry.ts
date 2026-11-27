import { edgesIntersect, ringCoversPoint } from "@/lib/geo/planar";
import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import {
  terrainObjects,
  terrainDimensions,
  type TerrainObjectKind,
} from "@/lib/schemas/terrain-objects";

export type ShadeSolar = { azimuthRad: number; elevationRad: number };

type ShadeElement = ShadeScene["elements"][number];

export function roundOutline([x, y]: Point, radius: number): Point[] {
  return Array.from({ length: 32 }, (_, i): Point => {
    const angle = (i * Math.PI) / 16;
    return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
  });
}

export function rectangle(
  [x, y]: Point,
  halfWidth: number,
  halfDepth = halfWidth,
): Point[] {
  return [
    [x - halfWidth, y - halfDepth],
    [x + halfWidth, y - halfDepth],
    [x + halfWidth, y + halfDepth],
    [x - halfWidth, y + halfDepth],
  ];
}

export function furnitureFootprint(
  kind: TerrainObjectKind,
  point: Point,
  dimensionsM?: readonly [number, number],
): Point[] {
  const { width, depth } = terrainDimensions(kind, dimensionsM);
  const { round } = terrainObjects[kind];
  return round
    ? roundOutline(point, width / 2)
    : rectangle(point, width / 2, depth / 2);
}

export function canopySupports(outline: Point[]): Point[] {
  const center: Point = [
    outline.reduce((sum, point) => sum + point[0], 0) / outline.length,
    outline.reduce((sum, point) => sum + point[1], 0) / outline.length,
  ];
  return outline
    .filter((_, index) => index % Math.ceil(outline.length / 4) === 0)
    .map(([x, y]) => [x + (center[0] - x) * 0.08, y + (center[1] - y) * 0.08]);
}

function occupiedFootprints(element: ShadeElement): Point[][] {
  switch (element.kind) {
    case "shade_canopy":
      return canopySupports(element.coordinates[0].slice(0, -1)).map((point) =>
        rectangle(point, 0.13),
      );
    case "shade_tree":
      return [
        roundOutline(
          element.coordinates,
          Math.min(0.19, element.heightM * 0.04),
        ),
      ];
    case "parasol":
      return [roundOutline(element.coordinates, 0.25)];
    default:
      return [furnitureFootprint(element.kind, element.coordinates, element.dimensionsM)];
  }
}

export function objectsOverlap(first: ShadeElement, second: ShadeElement) {
  return occupiedFootprints(first).some((a) =>
    occupiedFootprints(second).some((b) => {
      const ringA = [...a, a[0]];
      const ringB = [...b, b[0]];
      return (
        ringCoversPoint(a[0], ringB) ||
        ringCoversPoint(b[0], ringA) ||
        a.some((point, i) =>
          b.some((other, j) =>
            edgesIntersect(point, ringA[i + 1], other, ringB[j + 1]),
          ),
        )
      );
    }),
  );
}

export function shadeRings(element: ShadeElement): Point[][] {
  if (element.kind === "shade_canopy") return element.coordinates;
  if (element.kind === "shade_tree")
    return [roundOutline(element.coordinates, element.canopyDiameterM / 2)];
  return element.kind === "parasol" || element.kind === "stall" ||
      element.kind === "community_room" || element.kind === "civic_pavilion"
    ? [furnitureFootprint(element.kind, element.coordinates, element.dimensionsM)]
    : [];
}

export function projectShadow(
  rings: Point[][],
  height: number,
  solar: ShadeSolar,
): Point[][] {
  const distance = height / Math.tan(solar.elevationRad);
  const xOffset = -distance * Math.sin(solar.azimuthRad);
  const yOffset = -distance * Math.cos(solar.azimuthRad);
  return rings.map((ring) => ring.map(([x, y]) => [x + xOffset, y + yOffset]));
}
