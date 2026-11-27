import { edgesIntersect } from "@/lib/geo/planar";
import SunCalc from "suncalc";
import { photoReliefSchema } from "./terrain-relief";
import { z } from "zod";
import { shadeElementsSchema, type Point } from "@/lib/schemas/shade-scene";

export const planWidth = 500;
export const planHeight = 300;
export const maxCorners = 40;

const cornerSchema = z.tuple([
  z.number().min(0).max(planWidth),
  z.number().min(0).max(planHeight),
]);
const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export const photoAccessSchema = z.object({
  points: z.tuple([cornerSchema, cornerSchema]),
  width: z.number().min(0.5).max(5),
});
const captureSchema = z.object({
  corners: z.array(cornerSchema).min(3).max(maxCorners),
  distance: z.number().min(1).max(500),
  measuredDepth: z.number().min(1).max(500).optional(),
  location: locationSchema.nullable(),
  estimatedScale: z.boolean().optional(),
  utcOffset: z.number().min(-12).max(14),
});

export const terrainDraftSchema = z.object({
  capture: captureSchema,
  example: z.boolean(),
  photoGenerated: z.boolean().optional(),
  photoLayout: z
    .object({
      detected: z.boolean(),
      generation: z.number().int().min(1).optional(),
      fitted: z.boolean().optional(),
      noFit: z
        .array(z.enum(["a", "b"]))
        .max(2)
        .optional(),
      contextTrees: z.array(z.number().min(0).max(1)).max(8).optional(),
      access: photoAccessSchema.optional(),
    })
    .optional(),
  relief: photoReliefSchema.optional(),
  date: z.iso.date(),
  time: z.iso.time({ precision: -1 }),
  alternatives: z.object({
    a: shadeElementsSchema,
    b: shadeElementsSchema,
  }),
});

export type Capture = z.infer<typeof captureSchema>;
export type TerrainDraft = z.infer<typeof terrainDraftSchema>;
export type PhotoAccess = z.infer<typeof photoAccessSchema>;

export function terrainProjection(
  corners: Point[],
  distance: number,
  measuredDepth?: number,
) {
  const [origin, second] = corners;
  const metersPerUnit =
    distance / Math.hypot(second[0] - origin[0], second[1] - origin[1]);
  const yExtent =
    Math.max(...corners.map(([, y]) => y)) -
    Math.min(...corners.map(([, y]) => y));
  const depthPerUnit =
    measuredDepth && yExtent > 0 ? measuredDepth / yExtent : metersPerUnit;
  return ([x, y]: Point): Point => [
    (x - origin[0]) * metersPerUnit,
    (origin[1] - y) * depthPerUnit,
  ];
}

export function buildSurface(
  corners: Point[],
  distance: number,
  measuredDepth?: number,
) {
  if (
    corners.length < 3 ||
    !Number.isFinite(distance) ||
    distance < 1 ||
    distance > 500
  ) {
    return null;
  }

  const [origin, second] = corners;
  const firstSide = Math.hypot(second[0] - origin[0], second[1] - origin[1]);
  if (firstSide < 1) return null;

  const hasRepeatedCorner = corners.some(([x, y], i) =>
    corners
      .slice(i + 1)
      .some(([otherX, otherY]) => x === otherX && y === otherY),
  );
  if (hasRepeatedCorner) return null;

  for (let i = 0; i < corners.length; i++) {
    const [a, b] = [corners[i], corners[(i + 1) % corners.length]];
    for (let j = i + 2; j < corners.length; j++) {
      if (i === 0 && j === corners.length - 1) continue;
      if (edgesIntersect(a, b, corners[j], corners[(j + 1) % corners.length]))
        return null;
    }
  }

  const ring = corners.map(terrainProjection(corners, distance, measuredDepth));
  const metricArea = ring.reduce((sum, [x, y], i) => {
    const [nextX, nextY] = ring[(i + 1) % ring.length];
    return sum + x * nextY - y * nextX;
  }, 0);
  if (
    Math.abs(metricArea) < 2 ||
    ring.some(([x, y]) => Math.hypot(x, y) > 1000)
  ) {
    return null;
  }

  return [[[...ring, ring[0]]]];
}

export function terrainSun(
  { location, utcOffset }: Capture,
  date: string,
  time: string,
) {
  const timestamp = Date.parse(`${date}T${time}:00Z`);
  if (!location || !Number.isFinite(timestamp)) return null;

  const instant = new Date(timestamp - utcOffset * 60 * 60 * 1000);
  const { azimuth, altitude } = SunCalc.getPosition(
    instant,
    location.latitude,
    location.longitude,
  );
  if (altitude < Math.PI / 18) return null;
  return {
    azimuthRad: (azimuth + 3 * Math.PI) % (2 * Math.PI),
    elevationRad: altitude,
  };
}
