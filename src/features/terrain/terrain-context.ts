import type { OsmContext } from "@/features/places/site-data";
import { rectangle } from "@/features/compare/shade-geometry";
import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import { beam, prism, type Face } from "./terrain-perspective-model";
import type { TerrainFraming } from "./terrain-perspective-render";
import { terrainBounds } from "./terrain-relief";

type Location = { latitude: number; longitude: number };
type Position = readonly [number, number];
type ContextWay = {
  kind: "building" | "street" | "path";
  points: Position[];
  height?: number;
};
export type TerrainReference = {
  faces: Face[];
  framing: TerrainFraming;
  buildings: number;
  routes: number;
};

const metersPerDegree = 111_195;
const eastScale = (latitude: number) =>
  metersPerDegree * Math.cos((latitude * Math.PI) / 180);

export function referenceRadius(surface: ShadeScene["surface"]) {
  const { left, right, bottom, top } = terrainBounds(surface);
  return Math.max(
    110,
    Math.min(185, Math.max(right - left, top - bottom) / 2 + 70),
  );
}

export function pilotContextWays(
  context: OsmContext,
  { latitude, longitude }: Location,
): ContextWay[] {
  const [west, south, east, north] = context.bbox;
  if (
    longitude < west ||
    longitude > east ||
    latitude < south ||
    latitude > north
  )
    return [];
  return context.features.flatMap(({ geometry, properties }): ContextWay[] => {
    if (geometry.type === "Polygon" && properties.kind === "building")
      return [{ kind: "building", points: geometry.coordinates[0] }];
    if (
      geometry.type === "LineString" &&
      (properties.kind === "street" || properties.kind === "path")
    )
      return [{ kind: properties.kind, points: geometry.coordinates }];
    return [];
  });
}

function numberTag(value: unknown) {
  return typeof value === "string" &&
    /^\d+(?:\.\d+)?(?:\s*m)?$/.test(value.trim())
    ? Number.parseFloat(value)
    : 0;
}

export async function loadContextWays(
  { latitude, longitude }: Location,
  radius: number,
  signal: AbortSignal,
): Promise<ContextWay[]> {
  const queryLat = Number(latitude.toFixed(3));
  const queryLon = Number(longitude.toFixed(3));
  const dp = (radius + 60) / metersPerDegree;
  const dl = (radius + 60) / eastScale(queryLat);
  if (Math.abs(queryLat) + dp >= 90 || Math.abs(queryLon) + dl >= 180)
    return [];
  const bounds = [queryLat - dp, queryLon - dl, queryLat + dp, queryLon + dl]
    .map((coordinate) => coordinate.toFixed(5))
    .join(",");
  const query = `[out:json][timeout:8];(way[building](${bounds});way[highway][area!=yes](${bounds}););out geom 260;`;
  const endpoint = new URL("https://overpass-api.de/api/interpreter");
  endpoint.searchParams.set("data", query);
  const response = await fetch(endpoint, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("OpenStreetMap query failed");
  const data: { elements?: unknown } = await response.json();
  if (!Array.isArray(data.elements))
    throw new Error("OpenStreetMap response is invalid");
  return data.elements.slice(0, 260).flatMap((way): ContextWay[] => {
    if (!Array.isArray(way?.geometry) || !way.tags) return [];
    const closed = way.tags.building && way.tags.building !== "no";
    if (!closed && typeof way.tags.highway !== "string") return [];
    const points: Position[] = [];
    for (const node of way.geometry.slice(0, 1200)) {
      if (!Number.isFinite(node?.lon) || !Number.isFinite(node?.lat)) return [];
      points.push([node.lon, node.lat]);
    }
    const path = /^(footway|path|pedestrian|steps|cycleway|bridleway)$/.test(
      way.tags.highway,
    );
    const height =
      numberTag(way.tags.height) ||
      3 * numberTag(way.tags["building:levels"]) ||
      undefined;
    return [
      { kind: closed ? "building" : path ? "path" : "street", points, height },
    ];
  });
}

function clipSegment(
  a: Point,
  b: Point,
  center: Point,
  radius: number,
): [Point, Point] | null {
  let start = 0;
  let end = 1;
  for (const axis of [0, 1] as const) {
    const low = center[axis] - radius;
    const high = center[axis] + radius;
    const delta = b[axis] - a[axis];
    if (delta === 0) {
      if (a[axis] < low || a[axis] > high) return null;
      continue;
    }
    const first = (low - a[axis]) / delta;
    const last = (high - a[axis]) / delta;
    start = Math.max(start, Math.min(first, last));
    end = Math.min(end, Math.max(first, last));
    if (start >= end) return null;
  }
  const at = (t: number): Point => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  return [at(start), at(end)];
}

export function projectContext(
  ways: ContextWay[],
  location: Location,
  surface: ShadeScene["surface"],
  origin?: Point,
): TerrainReference | null {
  const radius = referenceRadius(surface);
  const { left, right, bottom, top } = terrainBounds(surface);
  const center: Point = [(left + right) / 2, (bottom + top) / 2];
  const [originX, originY] = origin ?? center;
  const scale = eastScale(location.latitude);
  const foundation = rectangle(center, radius);
  const faces: Face[] = prism(foundation, -0.17, -0.12, [194, 201, 200]);
  let tallest = 0;
  let buildings = 0;
  let routes = 0;
  for (const way of ways) {
    const points = way.points.map(([longitude, latitude]): Point => [
      originX + (longitude - location.longitude) * scale,
      originY + (latitude - location.latitude) * metersPerDegree,
    ]);
    if (way.kind === "building") {
      if (points.length < 4) continue;
      const first = points[0];
      const last = points[points.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) continue;
      const ring = points.slice(0, -1);
      const centroid = ring.reduce(
        ([x, y], [u, v]): Point => [x + u / ring.length, y + v / ring.length],
        [0, 0],
      );
      if (
        Math.abs(centroid[0] - center[0]) > radius ||
        Math.abs(centroid[1] - center[1]) > radius
      )
        continue;
      const area = ring.reduce((sum, [x, y], i) => {
        const [u, v] = ring[(i + 1) % ring.length];
        return sum + x * v - y * u;
      }, 0);
      if (Math.abs(area) < 0.5) continue;
      if (area < 0) ring.reverse();
      const height = Math.max(2, Math.min(60, way.height ?? 7));
      faces.push(...prism(ring, -0.11, height, [176, 186, 187]));
      buildings++;
      tallest = Math.max(tallest, height);
      continue;
    }
    const street = way.kind === "street";
    let present = false;
    for (let i = 1; i < points.length; i++) {
      const segment = clipSegment(points[i - 1], points[i], center, radius);
      if (!segment) continue;
      faces.push(
        ...beam(
          ...segment,
          street ? 6 : 1.6,
          -0.11,
          -0.08,
          street ? [137, 150, 156] : [219, 214, 198],
        ),
      );
      present = true;
    }
    if (present) routes++;
  }
  return buildings || routes
    ? { faces, framing: { points: foundation, tallest }, buildings, routes }
    : null;
}
