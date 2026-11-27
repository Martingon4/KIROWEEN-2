import { roundCoordinate } from "@/lib/geo/canonical";
import type { InterventionGeometry } from "@/lib/schemas/intervention";

/**
 * Text form of a geometry for keyboard and screen-reader editing:
 * one "longitude, latitude" vertex per line. Polygon rings are written open
 * and closed automatically.
 */
export type GeometryType = InterventionGeometry["type"];

export type CoordinateParseResult =
  | { ok: true; geometry: InterventionGeometry }
  | { ok: false; reason: "format" | "count" };

const minimumVertices: Record<GeometryType, number> = {
  Point: 1,
  LineString: 2,
  Polygon: 3,
};

function openVertices(geometry: InterventionGeometry) {
  return (
    geometry.type === "Point"
      ? [geometry.coordinates]
      : geometry.type === "LineString"
        ? geometry.coordinates
        : geometry.coordinates[0].slice(0, -1)
  );
}

export function coordinateCenter(
  geometry: InterventionGeometry,
): [number, number] {
  const vertices = openVertices(geometry);
  const lons = vertices.map(([longitude]) => longitude);
  const lats = vertices.map(([, latitude]) => latitude);
  return [
    (Math.min(...lons) + Math.max(...lons)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

export function formatCoordinates(geometry: InterventionGeometry): string {
  return openVertices(geometry)
    .map(([longitude, latitude]) => `${longitude}, ${latitude}`)
    .join("\n");
}

export function parseCoordinates(
  text: string,
  type: GeometryType,
): CoordinateParseResult {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const vertices: [number, number][] = [];

  for (const line of lines) {
    const parts = line.split(/[,;\s]+/).filter(Boolean);
    if (parts.length !== 2) return { ok: false, reason: "format" };
    const [longitude, latitude] = parts.map(Number);
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 ||
      Math.abs(latitude) > 90
    ) {
      return { ok: false, reason: "format" };
    }
    vertices.push([roundCoordinate(longitude), roundCoordinate(latitude)]);
  }

  if (type === "Point") {
    return vertices.length === 1
      ? { ok: true, geometry: { type: "Point", coordinates: vertices[0] } }
      : { ok: false, reason: "count" };
  }

  if (vertices.length < minimumVertices[type]) {
    return { ok: false, reason: "count" };
  }

  if (type === "LineString") {
    return {
      ok: true,
      geometry: { type: "LineString", coordinates: vertices },
    };
  }

  const [first] = vertices;
  const last = vertices.at(-1)!;
  const ring =
    first[0] === last[0] && first[1] === last[1]
      ? vertices
      : [...vertices, first];
  if (ring.length < 4) return { ok: false, reason: "count" };
  return { ok: true, geometry: { type: "Polygon", coordinates: [ring] } };
}

/** Half the side of the starting square, about 11 m at the pilot latitude. */
const SQUARE_HALF = 0.00005;
/**
 * Moves a geometry so its center sits at the picked point and returns the new coordinates
 * text. A point is replaced; a polygon or line keeps its shape. If the current text is not
 * valid, a small square (or a short line) is drawn around the point instead.
 */
export function placeAtPoint(
  text: string,
  type: GeometryType,
  longitude: number,
  latitude: number,
): string {
  const lon = roundCoordinate(longitude);
  const lat = roundCoordinate(latitude);
  if (type === "Point") return `${lon}, ${lat}`;
  const parsed = parseCoordinates(text, type);
  if (parsed.ok) {
    const [x, y] = coordinateCenter(parsed.geometry);
    const dx = lon - x;
    const dy = lat - y;
    return openVertices(parsed.geometry)
      .map(([x, y]) => `${roundCoordinate(x + dx)}, ${roundCoordinate(y + dy)}`)
      .join("\n");
  }
  const h = SQUARE_HALF;
  const shape =
    type === "LineString"
      ? [
          [lon - h, lat],
          [lon + h, lat],
        ]
      : [
          [lon - h, lat - h],
          [lon + h, lat - h],
          [lon + h, lat + h],
          [lon - h, lat + h],
        ];
  return shape
    .map(([x, y]) => `${roundCoordinate(x)}, ${roundCoordinate(y)}`)
    .join("\n");
}
