import { furnitureFootprint, objectsOverlap, roundOutline } from "@/features/compare/shade-geometry";
import { footprintFitsSurface } from "@/lib/geo/planar";
import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import { terrainDimensions, terrainObjects, type TerrainObjectKind } from "@/lib/schemas/terrain-objects";
import {
  planHeight,
  planWidth,
  terrainProjection,
  type Capture,
  type PhotoAccess,
  type TerrainDraft,
} from "./terrain-model";

type Raster = Pick<ImageData, "data" | "height" | "width">;
const sampleSize = 24;
const minCoverSide = 1.5;
const generatedId = (index: number) =>
  `c163ee20-e32f-4e2e-a825-bcbc825b9c${(0x60 + index).toString(16)}`;
const generatedPattern = /^c163ee20-e32f-4e2e-a825-bcbc825b9c[0-9a-f]{2}$/;

function photoPoint(ratio: number, x: number, y: number): Point {
  const width = Math.min(planWidth, planHeight * ratio);
  const height = Math.min(planHeight, planWidth / ratio);
  return [
    Math.round((planWidth - width) / 2 + x * width),
    Math.round((planHeight - height) / 2 + y * height),
  ];
}

export function photoOutline(ratio: number): Point[] {
  return [
    photoPoint(ratio, 0.12, 0.88),
    photoPoint(ratio, 0.88, 0.88),
    photoPoint(ratio, 0.88, 0.12),
    photoPoint(ratio, 0.12, 0.12),
  ];
}

export function photoRegion(corners: Point[], ratio: number) {
  const width = Math.min(planWidth, planHeight * ratio);
  const height = Math.min(planHeight, planWidth / ratio);
  const left = (planWidth - width) / 2;
  const top = (planHeight - height) / 2;
  const xs = corners.map(([x]) => (x - left) / width);
  const ys = corners.map(([, y]) => (y - top) / height);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    left: clamp(Math.min(...xs)),
    right: clamp(Math.max(...xs)),
    top: clamp(Math.min(...ys)),
    bottom: clamp(Math.max(...ys)),
  };
}

/** Trace the contiguous floor-colored region connected to the foreground. */
export function suggestPhotoOutline(
  raster: Raster,
  ratio: number,
): {
  corners: Point[];
  detected: boolean;
} {
  const fallback = { corners: photoOutline(ratio), detected: false };
  const size = sampleSize;
  const seedX = Math.floor(size / 2);
  function pixel(x: number, y: number) {
    const col = Math.floor(((x + 0.5) * raster.width) / size);
    const row = Math.floor(((y + 0.5) * raster.height) / size);
    return raster.data.subarray(
      (row * raster.width + col) * 4,
      (row * raster.width + col) * 4 + 4,
    );
  }
  const distance = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let seedY = size - 3;
  const corner = pixel(0, 0);
  if (
    distance(pixel(seedX, seedY), corner) < 35 &&
    distance(pixel(seedX, seedY), pixel(size - 1, 0)) < 35
  ) {
    while (seedY > Math.floor(size / 2) && distance(pixel(seedX, seedY), corner) < 35)
      seedY--;
  }

  const foreground = [
    pixel(seedX - 1, seedY),
    pixel(seedX, seedY),
    pixel(seedX + 1, seedY),
  ];
  const median = [0, 1, 2].map(
    (channel) =>
      foreground.map((color) => color[channel]).sort((a, b) => a - b)[1],
  );
  const region = new Uint8Array(size * size);
  const queue: Point[] = [[seedX, seedY]];
  region[seedY * size + seedX] = 1;
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const index = ny * size + nx;
      if (region[index]) continue;
      const [r, g, b, alpha] = pixel(nx, ny);
      if (
        alpha < 128 ||
        Math.hypot(r - median[0], g - median[1], b - median[2]) > 75
      )
        continue;
      region[index] = 1;
      queue.push([nx, ny]);
    }
  }
  if (queue.length < size * size * 0.12 || queue.length > size * size * 0.94)
    return fallback;

  const rows = [];
  for (let y = size - 1; y >= 0; y--) {
    const line = region.subarray(y * size, (y + 1) * size);
    const left = line.indexOf(1);
    const right = line.lastIndexOf(1);
    if (left < 0) continue;
    if (right - left < 2 && rows.length === 0) continue;
    rows.push({ left, right: Math.max(left + 1, right), y });
  }
  if (rows.length < 5) return fallback;
  const profile = rows.filter((_, i) => i % 2 === 0 || i === rows.length - 1);
  const left = profile.map(({ left, y }) =>
    photoPoint(ratio, (left + 0.5) / size, (y + 0.5) / size),
  );
  const right = profile.map(({ right, y }) =>
    photoPoint(ratio, (right + 0.5) / size, (y + 0.5) / size),
  );
  const corners = [left[0], ...right, ...left.slice(1).reverse()];
  return { corners, detected: true };
}

/** A backdrop cue only: a green band below visible sky may be a tree line. */
export function suggestPhotoTreeline(raster: Raster): number[] {
  const bands = 8;
  const samples = 24;
  let sky = 0;
  for (let y = 2; y < 6; y++) {
    for (let x = 0; x < samples; x++) {
      const col = Math.floor(((x + 0.5) * raster.width) / samples);
      const row = Math.floor(((y + 0.5) * raster.height) / samples);
      const i = (row * raster.width + col) * 4;
      const [r, g, b] = raster.data.subarray(i, i + 3);
      if (b > 105 && b >= g * 0.93 && b >= r * 1.02) sky++;
    }
  }
  if (sky < samples * 0.8) return [];
  const result: number[] = [];
  for (let band = 0; band < bands; band++) {
    let green = 0;
    let total = 0;
    for (let y = 6; y < 13; y++) {
      for (let col = 0; col < 3; col++) {
        const x = band * 3 + col;
        const px = Math.floor(((x + 0.5) * raster.width) / samples);
        const py = Math.floor(((y + 0.5) * raster.height) / samples);
        const i = (py * raster.width + px) * 4;
        const [r, g, b, a] = raster.data.subarray(i, i + 4);
        if (a < 128) continue;
        total++;
        if (g > r * 1.02 && g > b * 1.02 && g > 35) green++;
      }
    }
    if (total && green / total >= 0.28) result.push((band + 0.5) / bands);
  }
  return result.length >= 3 ? result : [];
}

export function accessFootprint(
  capture: Capture,
  access: PhotoAccess,
): Point[] | null {
  const project = terrainProjection(
    capture.corners,
    capture.distance,
    capture.measuredDepth,
  );
  const [[x, y], [u, v]] = access.points.map(project);
  const length = Math.hypot(u - x, v - y);
  if (length < 0.5) return null;
  const dx = (-(v - y) * access.width) / (2 * length);
  const dy = ((u - x) * access.width) / (2 * length);
  return [
    [x - dx, y - dy],
    [u - dx, v - dy],
    [u + dx, v + dy],
    [x + dx, y + dy],
  ];
}

function close(ring: Point[]) {
  return [...ring, ring[0]];
}

export function surfaceWithAccess(
  surface: ShadeScene["surface"],
  access?: Point[] | null,
): ShadeScene["surface"] {
  return access
    ? [[...surface[0], close(access)], ...surface.slice(1)]
    : surface;
}

function largestCover(surface: ShadeScene["surface"], outline: Point[]) {
  const angles = [0];
  for (let i = 1; i < outline.length; i++) {
    const [x, y] = outline[i - 1];
    const [u, v] = outline[i];
    if (Math.hypot(u - x, v - y) < 0.5) continue;
    const quarterTurn = Math.PI / 2;
    const angle =
      ((Math.atan2(v - y, u - x) % quarterTurn) + quarterTurn) % quarterTurn;
    if (
      angles.every(
        (previous) =>
          Math.min(
            Math.abs(previous - angle),
            quarterTurn - Math.abs(previous - angle),
          ) >
          Math.PI / 36,
      )
    ) {
      angles.push(angle);
      if (angles.length === 8) break;
    }
  }

  let best: { ring: Point[]; area: number } | undefined;
  for (const angle of angles) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = outline.map(([x, y]) => [
      x * cos + y * sin,
      -x * sin + y * cos,
    ]);
    const east = rotated.map(([x]) => x);
    const north = rotated.map(([, y]) => y);
    const x0 = Math.min(...east) + 0.08;
    const y0 = Math.min(...north) + 0.08;
    const width = Math.max(...east) - x0 - 0.08;
    const height = Math.max(...north) - y0 - 0.08;
    const step = Math.max(0.15, Math.max(width, height) / 30);
    const columns = Math.floor(width / step);
    const rows = Math.floor(height / step);
    if (columns <= 0 || rows <= 0) continue;

    function rectangle(
      left: number,
      top: number,
      right: number,
      bottom: number,
    ): Point[] {
      return [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
      ].map(([col, row]) => {
        const x = x0 + col * step;
        const y = y0 + row * step;
        return [x * cos - y * sin, x * sin + y * cos];
      });
    }
    const cells = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, col) =>
        footprintFitsSurface(rectangle(col, row, col + 1, row + 1), surface),
      ),
    );
    for (let top = 0; top < rows; top++) {
      const available = Array<boolean>(columns).fill(true);
      for (let bottom = top + 1; bottom <= rows; bottom++) {
        const depth = (bottom - top) * step;
        let left = 0;
        for (let right = 0; right <= columns; right++) {
          if (right < columns) available[right] &&= cells[bottom - 1][right];
          if (right < columns && available[right]) continue;
          const span = (right - left) * step;
          const area = span * depth;
          if (
            span >= minCoverSide &&
            depth >= minCoverSide &&
            area > (best?.area ?? 0)
          ) {
            const ring = rectangle(left, top, right, bottom);
            if (footprintFitsSurface(ring, surface)) best = { area, ring };
          }
          left = right + 1;
        }
      }
    }
  }
  return best?.ring;
}

export function coverDimensions(ring: Point[]) {
  const [[x, y], [u, v], [p, q]] = ring;
  return [Math.hypot(u - x, v - y), Math.hypot(p - u, q - v)] as const;
}

export function fitPhotoCovers(
  surface: ShadeScene["surface"],
  access?: Point[] | null,
  existing?: TerrainDraft["alternatives"],
): TerrainDraft["alternatives"] {
  const allowed = surfaceWithAccess(surface, access);
  const ring = largestCover(allowed, surface[0][0]);
  if (!ring) return { a: [], b: [] };
  const [width, depth] = coverDimensions(ring);
  const [left, right] = [
    Math.min(...surface[0][0].map(([x]) => x)),
    Math.max(...surface[0][0].map(([x]) => x)),
  ];
  const [bottom, top] = [
    Math.min(...surface[0][0].map(([, y]) => y)),
    Math.max(...surface[0][0].map(([, y]) => y)),
  ];
  const candidates = (fractions: Point[]) => fractions.map(([x, y]): Point => [
    left + (right - left) * x,
    bottom + (top - bottom) * y,
  ]);
  const centerFirst = candidates([
    [0.5, 0.5], [0.32, 0.5], [0.68, 0.5], [0.5, 0.3], [0.5, 0.7],
    [0.28, 0.3], [0.72, 0.3], [0.28, 0.7], [0.72, 0.7],
  ]);
  const structureFirst = candidates([
    [0.5, 0.64], [0.42, 0.64], [0.58, 0.64], [0.5, 0.56], [0.5, 0.72],
  ]);
  const edgeFirst = candidates([
    [0.18, 0.78], [0.82, 0.78], [0.18, 0.22], [0.82, 0.22],
    [0.5, 0.82], [0.5, 0.18], [0.12, 0.5], [0.88, 0.5],
    [0.35, 0.7], [0.65, 0.7], [0.35, 0.3], [0.65, 0.3],
  ]);
  const grid = candidates(
    Array.from({ length: 9 * 9 }, (_, i): Point => [
      0.1 + (i % 9) * 0.1,
      0.1 + Math.floor(i / 9) * 0.1,
    ]),
  );
  type Element = ShadeScene["elements"][number];
  const a: Element[] = [...(existing?.a ?? [])];
  const b: Element[] = [...(existing?.b ?? [])];
  const radius = (element: Element) => {
    if (element.kind === "shade_tree") return 0.25;
    if (element.kind === "shade_canopy") return 0;
    const { width, depth } = terrainDimensions(element.kind, element.dimensionsM);
    return Math.max(width, depth) / 2;
  };
  function add(
    list: Element[],
    kind: TerrainObjectKind | "shade_tree",
    preferred: Point[],
    index: number,
    dimensionsM?: [number, number],
    fallback = true,
  ) {
    for (const point of [...preferred, ...(fallback ? grid : [])]) {
      const element: Element = kind === "shade_tree"
        ? {
            id: generatedId(index),
            kind,
            heightM: 5,
            canopyDiameterM: Math.min(3.2, Math.max(1.8, Math.min(width, depth) * 0.36)),
            coordinates: point,
          }
        : {
            id: generatedId(index),
            kind,
            heightM: terrainObjects[kind].height,
            coordinates: point,
            ...(dimensionsM ? { dimensionsM } : {}),
          };
      const footprint = element.kind === "shade_tree"
        ? roundOutline(point, element.canopyDiameterM / 2)
        : furnitureFootprint(element.kind, point, element.dimensionsM);
      if (!footprintFitsSurface(footprint, allowed)) continue;
      if (list.some((placed) => objectsOverlap(placed, element))) continue;
      if (list.some((placed) =>
        !["community_room", "civic_pavilion", "ramp"].includes(placed.kind) &&
        !["community_room", "civic_pavilion", "ramp"].includes(element.kind) &&
        placed.kind !== "shade_canopy" &&
        Math.hypot(placed.coordinates[0] - point[0], placed.coordinates[1] - point[1]) <
          radius(placed) + radius(element) + 0.35
      )) continue;
      if (list.some((placed) =>
        placed.kind === "shade_canopy" &&
        element.heightM > placed.heightM &&
        (footprint.some((vertex) => footprintFitsSurface([vertex], [[placed.coordinates[0]]])) ||
          footprintFitsSurface([point], [[placed.coordinates[0]]]))
      )) continue;
      if (element.kind === "shade_tree" && list.some((placed) =>
        placed.kind === "shade_tree" &&
        Math.hypot(placed.coordinates[0] - point[0], placed.coordinates[1] - point[1]) <
          (placed.canopyDiameterM + element.canopyDiameterM) / 2 + 0.3
      )) continue;
      list.push(element);
      return element;
    }
  }

  function complete(list: Element[], kind: "community_room" | "civic_pavilion", index: number) {
    const defaultSize = terrainObjects[kind];
    let building: Element | undefined;
    for (const size of [[defaultSize.width, defaultSize.depth], [4.4, 3.6], [3.4, 3.2]] as [number, number][]) {
      building = add(list, kind, structureFirst, index, size);
      if (building) break;
    }
    if (!building) return;
    if (building.kind !== kind) return;
    const { depth } = terrainDimensions(kind, building.dimensionsM);
    const rampDepth = terrainObjects.ramp.depth;
    const entrance: Point = [
      building.coordinates[0],
      building.coordinates[1] - depth / 2 - rampDepth / 2 - 0.08,
    ];
    add(list, "ramp", [entrance], index + 1, undefined, false);
    add(list, "bike_rack", [...edgeFirst, ...centerFirst], index + 2);
    add(list, "lamp", [...edgeFirst.slice(4), ...edgeFirst], index + 3);
    add(list, kind === "community_room" ? "planter" : "water_station", edgeFirst, index + 4);
  }
  complete(a, "community_room", 0);
  complete(b, "civic_pavilion", 12);
  return {
    a: a.filter(({ id }) => isGeneratedPhotoElement(id)),
    b: b.filter(({ id }) => isGeneratedPhotoElement(id)),
  };
}

export function isGeneratedBuilding(id: string) {
  return id === generatedId(0) || id === generatedId(12);
}

export function isGeneratedPhotoElement(id: string) {
  return generatedPattern.test(id);
}
