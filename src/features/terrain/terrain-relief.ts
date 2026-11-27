import { z } from "zod";
import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";

export const reliefResolution = 24;
export const photoDepthResolution = 48;
const channel = z.number().int().min(0).max(255);
const reliefSampleSchema = z.object({
  rise: z.number().min(0).max(1),
  color: z.tuple([channel, channel, channel]),
});
export const photoReliefSchema = z.object({
  samples: z.array(reliefSampleSchema).length(reliefResolution ** 2),
  source: z.enum(["color", "depth"]).optional(),
  cameraDepth: z
    .array(z.number().min(0).max(1))
    .length(photoDepthResolution ** 2)
    .optional(),
});

export type PhotoRelief = z.infer<typeof photoReliefSchema>;
type Raster = Pick<ImageData, "data" | "height" | "width">;
type Depth = { data: Float32Array; width: number; height: number };
export type PhotoRegion = { left: number; right: number; top: number; bottom: number };

export function createFlatPhotoRelief(raster: Raster, region: PhotoRegion): PhotoRelief {
  const last = reliefResolution - 1;
  return {
    source: "color",
    samples: Array.from({ length: reliefResolution ** 2 }, (_, i) => {
      const row = Math.floor(i / reliefResolution);
      const col = i % reliefResolution;
      const x = Math.min(raster.width - 1, Math.floor(
        (region.left + (region.right - region.left) * (0.04 + 0.92 * col / last)) * raster.width,
      ));
      const y = Math.min(raster.height - 1, Math.floor(
        (region.top + (region.bottom - region.top) * (0.04 + 0.92 * row / last)) * raster.height,
      ));
      const index = (y * raster.width + x) * 4;
      return {
        rise: 0,
        color: [raster.data[index], raster.data[index + 1], raster.data[index + 2]] as [number, number, number],
      };
    }),
  };
}

export function createPhotoRelief(
  depth: Depth,
  raster: Raster,
  region?: PhotoRegion,
): PhotoRelief | null {
  const samples: { inverse: number; color: [number, number, number] }[] = [];
  function index(row: number, col: number, width: number, height: number) {
    const horizontal = region
      ? region.left + (region.right - region.left) * (0.04 + (0.92 * col) / (reliefResolution - 1))
      : 0.12 + (0.76 * col) / (reliefResolution - 1);
    const vertical = region
      ? region.top + (region.bottom - region.top) * (0.04 + (0.92 * row) / (reliefResolution - 1))
      : 0.12 + (0.76 * row) / (reliefResolution - 1);
    const x = Math.min(
      width - 1,
      Math.floor(horizontal * width),
    );
    const y = Math.min(
      height - 1,
      Math.floor(vertical * height),
    );
    return y * width + x;
  }

  for (let row = 0; row < reliefResolution; row++) {
    for (let col = 0; col < reliefResolution; col++) {
      const inverse = depth.data[index(row, col, depth.width, depth.height)];
      if (!Number.isFinite(inverse)) return null;
      const i = index(row, col, raster.width, raster.height) * 4;
      const color: [number, number, number] = [
        raster.data[i],
        raster.data[i + 1],
        raster.data[i + 2],
      ];
      samples.push({ inverse, color });
    }
  }

  function percentile(values: number[], fraction: number) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * fraction)];
  }

  const depths = samples.map(({ inverse }) => inverse);
  const span = percentile(depths, 0.95) - percentile(depths, 0.05);
  if (span <= 1e-6) return null;

  function floorAt(row: number) {
    return percentile(
      depths.slice(row * reliefResolution, (row + 1) * reliefResolution),
      0.35,
    );
  }

  // With a level ground plane, inverse depth changes linearly along image rows.
  // Estimate that line from the lower part of the photo and keep nearer relief.
  const near = floorAt(21);
  const far = floorAt(14);
  const slope = Math.max(0, Math.min(span / 8, (near - far) / 7));

  const low = percentile(depths, 0.05);
  const cameraDepth = Array.from(
    { length: photoDepthResolution ** 2 },
    (_, i) => {
      const x = Math.round(
        ((i % photoDepthResolution) * (depth.width - 1)) /
          (photoDepthResolution - 1),
      );
      const y = Math.round(
        (Math.floor(i / photoDepthResolution) * (depth.height - 1)) /
          (photoDepthResolution - 1),
      );
      const value = depth.data[y * depth.width + x];
      const normalized = Number.isFinite(value)
        ? Math.max(0, Math.min(1, (value - low) / span))
        : 0;
      return Number(normalized.toFixed(3));
    },
  );

  return {
    source: "depth",
    cameraDepth,
    samples: samples.map(({ inverse, color }, i) => {
      const row = Math.floor(i / reliefResolution);
      const floor = near - (21 - row) * slope;
      const rise = Math.max(0, Math.min(1, (inverse - floor) / span - 0.07));
      return { rise: Number(rise.toFixed(3)), color };
    }),
  };
}

export function terrainBounds(surface: ShadeScene["surface"]) {
  const points = surface.flat(2);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.max(...ys),
    bottom: Math.min(...ys),
  };
}

export function reliefCoordinates(
  surface: ShadeScene["surface"],
  relief: PhotoRelief,
) {
  const { left, right, top, bottom } = terrainBounds(surface);
  const width = right - left;
  const depth = top - bottom;
  const height = Math.min(4, Math.min(width, depth) * 0.42);
  const last = reliefResolution - 1;

  function vertex(row: number, col: number): [number, number, number] {
    return [
      left + (width * col) / last,
      top - (depth * row) / last,
      relief.samples[row * reliefResolution + col].rise * height,
    ];
  }

  function elevation([x, y]: Point) {
    const col = Math.max(0, Math.min(last, ((x - left) * last) / width));
    const row = Math.max(0, Math.min(last, ((top - y) * last) / depth));
    const c = Math.min(last - 1, Math.floor(col));
    const r = Math.min(last - 1, Math.floor(row));
    const u = col - c;
    const v = row - r;
    const a = vertex(r, c)[2];
    const b = vertex(r + 1, c)[2];
    const d = vertex(r, c + 1)[2];
    const z = vertex(r + 1, c + 1)[2];
    return u <= v
      ? a * (1 - v) + b * (v - u) + z * u
      : a * (1 - u) + z * v + d * (u - v);
  }

  return { vertex, elevation };
}
