import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import {
  canopySupports,
  furnitureFootprint,
  rectangle,
  roundOutline,
} from "@/features/compare/shade-geometry";
import {
  terrainObjects,
  terrainDimensions,
  type TerrainObjectKind,
} from "@/lib/schemas/terrain-objects";

export type Vertex = [x: number, y: number, z: number];
export type Color = [red: number, green: number, blue: number];
export type Face = { vertices: Vertex[]; material: Color };

type ShadeElement = ShadeScene["elements"][number];
type Canopy = Extract<ShadeElement, { kind: "shade_canopy" }>;

export const wood: Color = [147, 95, 55];
const frame: Color = [77, 63, 47];
const cream: Color = [225, 213, 182];
const bark: Color = [106, 78, 50];
const foliage: Color[] = [
  [90, 124, 64],
  [79, 117, 63],
  [114, 147, 73],
  [70, 104, 54],
];

export function prism(
  outline: Point[],
  bottom: number,
  top: number,
  material: Color,
): Face[] {
  const lower = outline.map(([x, y]): Vertex => [x, y, bottom]);
  const upper = outline.map(([x, y]): Vertex => [x, y, top]);
  return [
    { vertices: [...lower].reverse(), material },
    { vertices: upper, material },
    ...outline.map((_, i) => {
      const next = (i + 1) % outline.length;
      return {
        vertices: [lower[i], lower[next], upper[next], upper[i]],
        material,
      };
    }),
  ];
}

export function beam(
  a: Point,
  b: Point,
  width: number,
  bottom: number,
  top: number,
  material: Color,
) {
  const direction = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (direction === 0) return [];
  const dx = (-(b[1] - a[1]) * width) / (2 * direction);
  const dy = ((b[0] - a[0]) * width) / (2 * direction);
  return prism(
    [
      [a[0] + dx, a[1] + dy],
      [a[0] - dx, a[1] - dy],
      [b[0] - dx, b[1] - dy],
      [b[0] + dx, b[1] + dy],
    ],
    bottom,
    top,
    material,
  );
}

function canopyFaces(
  element: Canopy,
  ground: (point: Point) => number,
): Face[] {
  let outline = element.coordinates[0].slice(0, -1);
  const area = outline.reduce((sum, [x, y], i) => {
    const [nextX, nextY] = outline[(i + 1) % outline.length];
    return sum + x * nextY - y * nextX;
  }, 0);
  if (area < 0) outline = [...outline].reverse();
  const supports = canopySupports(outline);
  const h = element.heightM + Math.max(...supports.map(ground));
  const faces = supports.flatMap((point) => {
    const base = ground(point);
    return [
      ...prism(rectangle(point, 0.13), base, base + 0.08, frame),
      ...prism(rectangle(point, 0.07), base + 0.08, h, wood),
    ];
  });
  faces.push(...prism(outline, h - 0.07, h, cream));
  outline.forEach((corner, i) => {
    faces.push(
      ...beam(
        corner,
        outline[(i + 1) % outline.length],
        0.1,
        h - 0.22,
        h + 0.045,
        wood,
      ),
    );
  });
  if (outline.length === 4) {
    const [a, b, c, d] = outline;
    for (const portion of [0.2, 0.4, 0.6, 0.8]) {
      faces.push(
        ...beam(
          [a[0] + (b[0] - a[0]) * portion, a[1] + (b[1] - a[1]) * portion],
          [d[0] + (c[0] - d[0]) * portion, d[1] + (c[1] - d[1]) * portion],
          0.055,
          h - 0.14,
          h - 0.065,
          frame,
        ),
      );
    }
  }
  return faces;
}

function ellipsoid(
  center: Vertex,
  [rx, ry, rz]: Vertex,
  material: Color,
  phase: number,
): Face[] {
  const segments = 9;
  const tiers = 5;
  const points = Array.from({ length: tiers + 1 }, (_, j) => {
    const latitude = (Math.PI * j) / tiers;
    return Array.from({ length: segments }, (_, i): Vertex => {
      const longitude = (2 * Math.PI * i) / segments;
      const roughness = 1 + 0.14 * Math.sin(i * 15.7 + j * 8.1 + phase);
      return [
        center[0] + rx * Math.sin(latitude) * Math.cos(longitude) * roughness,
        center[1] + ry * Math.sin(latitude) * Math.sin(longitude) * roughness,
        center[2] + rz * Math.cos(latitude),
      ];
    });
  });
  return points.slice(0, -1).flatMap((row, j) =>
    row.map((point, i) => {
      const next = (i + 1) % segments;
      const lower = points[j + 1];
      const vertices =
        j === 0
          ? [point, lower[i], lower[next]]
          : j === tiers - 1
            ? [point, lower[i], row[next]]
            : [point, lower[i], lower[next], row[next]];
      return { vertices, material };
    }),
  );
}

function treeFaces(
  element: Extract<ShadeElement, { kind: "shade_tree" }>,
): Face[] {
  const [x, y] = element.coordinates;
  const h = element.heightM;
  const r = element.canopyDiameterM / 2;
  const trunk = Array.from({ length: 9 }, (_, i): Point => {
    const angle = (2 * Math.PI * i) / 9;
    const radius = Math.min(0.19, h * 0.04);
    return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
  });
  const faces = prism(trunk, 0, h * 0.76, bark);
  const crown = [
    [0, 0, 0.78, 0.73],
    [-0.42, 0.14, 0.7, 0.51],
    [0.38, 0.16, 0.73, 0.53],
    [0.14, -0.42, 0.71, 0.55],
    [-0.18, -0.14, 0.86, 0.48],
    [0.07, 0.44, 0.75, 0.48],
  ];
  crown.forEach(([dx, dy, dz, size], index) => {
    const center: Vertex = [x + r * dx, y + r * dy, h * dz];
    const above = Math.min(h - center[2], 0.88 * r * size);
    faces.push(
      ...ellipsoid(
        center,
        [r * size, r * size * 0.91, above],
        foliage[index % foliage.length],
        index * 2,
      ),
    );
  });
  return faces;
}

function catalogFaces(
  kind: Exclude<TerrainObjectKind, "bench" | "planter">,
  center: Point,
  base: number,
  height: number,
  dimensionsM?: readonly [number, number],
): Face[] {
  const { width, depth } = terrainDimensions(kind, dimensionsM);
  const [x, y] = center;
  const metal: Color = [49, 63, 69];
  const stone: Color = [146, 144, 136];
  const painted: Color = [43, 105, 115];
  const fabric: Color = [156, 52, 47];
  const levels = (bottom: number, top: number): [number, number] => [
    base + height * bottom,
    base + height * top,
  ];
  const box = (
    point: Point,
    w: number,
    d: number,
    bottom: number,
    top: number,
    color: Color,
  ) => prism(rectangle(point, w / 2, d / 2), ...levels(bottom, top), color);
  const disc = (radius: number, bottom: number, top: number, color: Color) =>
    prism(roundOutline(center, radius), ...levels(bottom, top), color);
  const slope = (faces: Face[], rise: (north: number) => number) =>
    faces.map(({ vertices, material }) => ({
      material,
      vertices: vertices.map(([east, north, z]): Vertex => [
        east,
        north,
        z + height * rise(north),
      ]),
    }));

  switch (kind) {
    case "community_room": {
      const wall: Color = [222, 211, 189];
      const glass: Color = [101, 155, 168];
      const roof: Color = [58, 73, 78];
      const front = y - depth / 2;
      const back = y + depth / 2;
      const eave = 0.24;
      const frontWindowX = (width + 1.1) / 4;
      const frontWindowWidth = Math.min(1.12, width / 2 - 0.75);
      const roofBase = base + height * 0.79;
      const ridge = base + height;
      const roofFaces: Face[] = [
        { vertices: [[x - width / 2 - eave, front - eave, roofBase], [x, front - eave, ridge], [x, back + eave, ridge], [x - width / 2 - eave, back + eave, roofBase]], material: roof },
        { vertices: [[x, front - eave, ridge], [x + width / 2 + eave, front - eave, roofBase], [x + width / 2 + eave, back + eave, roofBase], [x, back + eave, ridge]], material: roof },
        { vertices: [[x - width / 2 - eave, front - eave, roofBase], [x + width / 2 + eave, front - eave, roofBase], [x, front - eave, ridge]], material: roof },
        { vertices: [[x + width / 2 + eave, back + eave, roofBase], [x - width / 2 - eave, back + eave, roofBase], [x, back + eave, ridge]], material: roof },
      ];
      return [
        ...box(center, width, depth, 0, 0.045, stone),
        ...box([x, back - 0.09], width, 0.18, 0.045, 0.79, wall),
        ...[-1, 1].flatMap((side) => [
          ...box([x + side * (width / 2 - 0.09), y], 0.18, depth, 0.045, 0.79, wall),
          ...box([x + side * frontWindowX, front + 0.09], width / 2 - 0.55, 0.18, 0.045, 0.79, wall),
          ...box([x + side * frontWindowX, front - 0.015], frontWindowWidth, 0.035, 0.35, 0.62, glass),
          ...box([x + side * frontWindowX, front - 0.04], frontWindowWidth + 0.08, 0.045, 0.34, 0.36, frame),
          ...box([x + side * frontWindowX, front - 0.04], frontWindowWidth + 0.08, 0.045, 0.61, 0.63, frame),
          ...box([x + side * (width / 2 + 0.006), y], 0.025, 1.55, 0.31, 0.66, glass),
          ...box([x + side * (width / 2 + 0.025), y], 0.045, 1.58, 0.31, 0.325, frame),
          ...box([x + side * (width / 2 + 0.025), y], 0.045, 1.58, 0.645, 0.66, frame),
        ]),
        ...box([x, front + 0.09], 1.1, 0.18, 0.68, 0.79, wall),
        ...box([x, front - 0.015], 1.04, 0.04, 0.045, 0.68, [65, 90, 90]),
        ...box([x + 0.32, front - 0.045], 0.06, 0.045, 0.32, 0.35, cream),
        ...box([x, front - 0.34], 1.5, 0.68, 0, 0.04, stone),
        ...box([x, front - 0.26], 1.72, 0.72, 0.7, 0.735, roof),
        ...roofFaces,
      ];
    }
    case "civic_pavilion": {
      const roof: Color = [63, 86, 88];
      const brick: Color = [164, 104, 79];
      return [
        ...box(center, width, depth, 0, 0.045, stone),
        ...[-1, 1].flatMap((sideX) => [-1, 1].flatMap((sideY) =>
          box([x + sideX * (width / 2 - 0.28), y + sideY * (depth / 2 - 0.28)], 0.22, 0.22, 0.045, 0.9, wood),
        )),
        ...box([x, y + depth / 2 - 0.14], width - 0.5, 0.25, 0.045, 0.38, brick),
        ...[-1, 1].flatMap((side) => [
          ...box([x + side * (width / 2 - 0.14), y], 0.23, depth, 0.83, 0.91, frame),
          ...box([x + side * (width / 2 - 0.14), y], 0.12, depth - 0.9, 0.37, 0.4, wood),
        ]),
        ...box([x, y - depth / 2 + 0.14], width - 0.5, 0.2, 0.84, 0.91, frame),
        ...box([x, y + depth / 2 - 0.14], width - 0.5, 0.2, 0.84, 0.91, frame),
        ...box([x, y + depth / 2 - 0.56], width - 1.25, 0.48, 0.26, 0.31, wood),
        ...box([x, y + depth / 2 - 0.33], width - 1.25, 0.09, 0.31, 0.52, wood),
        ...[-1, 1].flatMap((side) =>
          box([x + side * (width / 2 - 1.05), y + depth / 2 - 0.56], 0.12, 0.42, 0.045, 0.26, frame),
        ),
        ...box(center, width + 0.36, depth + 0.36, 0.91, 0.96, roof),
        ...Array.from({ length: 9 }, (_, i) =>
          box([x - width / 2 + (i + 0.5) * width / 9, y], 0.045, depth + 0.45, 0.96, 1, i % 2 ? wood : roof),
        ).flat(),
      ];
    }
    case "picnic_table":
      return [
        ...[-0.64, 0.64].flatMap((dx) =>
          [-0.31, 0.31].flatMap((dy) =>
            box([x + dx, y + dy], 0.095, 0.095, 0, 0.92, metal),
          ),
        ),
        ...[-0.64, 0.64].flatMap((dx) =>
          box([x + dx, y], 0.095, 1.44, 0.5, 0.6, metal),
        ),
        ...[-0.66, 0.66].flatMap((dy) =>
          box([x, y + dy], width, 0.28, 0.58, 0.67, wood),
        ),
        ...[-0.24, 0, 0.24].flatMap((dy) =>
          box([x, y + dy], width, 0.23, 0.91, 1, wood),
        ),
      ];
    case "parasol": {
      const edge = roundOutline(center, width / 2);
      const apex: Vertex = [x, y, base + height];
      return [
        ...disc(0.25, 0, 0.08, metal),
        ...disc(0.047, 0.08, 1, metal),
        ...edge.flatMap(([px, py], i) => {
          const rim: Vertex = [px, py, base + height * 0.84];
          const [nx, ny] = edge[(i + 1) % edge.length];
          const end: Vertex = [nx, ny, rim[2]];
          const material = i % 8 < 4 ? painted : cream;
          return [
            { vertices: [rim, end, apex], material },
            { vertices: [apex, end, rim], material },
          ];
        }),
      ];
    }
    case "lamp":
      return [
        ...disc(width / 2, 0, 0.08, metal),
        ...disc(0.07, 0.08, 0.84, metal),
        ...box(center, 0.34, 0.34, 0.82, 0.87, metal),
        ...box(center, 0.25, 0.25, 0.87, 0.96, [248, 218, 151]),
        ...box(center, 0.38, 0.38, 0.96, 1, metal),
      ];
    case "bike_rack":
      return [-0.62, 0, 0.62].flatMap((dx) => [
        ...[-0.21, 0.21].flatMap((dy) =>
          box([x + dx, y + dy], 0.085, 0.085, 0, 1, metal),
        ),
        ...box([x + dx, y], 0.085, depth, 0.91, 1, metal),
      ]);
    case "waste_bin":
      return [
        ...disc(width * 0.45, 0, 0.12, metal),
        ...disc(width * 0.43, 0.12, 0.87, painted),
        ...disc(width / 2, 0.87, 0.94, metal),
        ...box(center, 0.22, 0.12, 0.94, 1, [25, 33, 35]),
      ];
    case "fountain": {
      const water: Color = [69, 149, 166];
      return [
        ...disc(width / 2, 0, 0.26, stone),
        ...disc(width * 0.46, 0.26, 0.28, water),
        ...disc(0.2, 0.28, 0.75, stone),
        ...disc(0.45, 0.69, 0.8, stone),
        ...disc(0.41, 0.8, 0.82, water),
        ...disc(0.045, 0.82, 1, [136, 205, 220]),
      ];
    }
    case "swing":
      return [
        ...[-1.35, 1.35].flatMap((dx) =>
          [-0.9, 0.9].flatMap((dy) => {
            const leg = box([x + dx, y + dy], 0.11, 0.13, 0, 0.97, painted);
            return leg.map(({ vertices, material }) => ({
              material,
              vertices: vertices.map(([px, py, pz]): Vertex => [
                px,
                py - ((pz - base) / height) * dy,
                pz,
              ]),
            }));
          }),
        ),
        ...box(center, width * 0.88, 0.13, 0.96, 1, painted),
        ...[-0.64, 0.64].flatMap((dx) => [
          ...[-0.22, 0.22].flatMap((offset) =>
            box([x + dx + offset, y], 0.023, 0.023, 0.21, 0.96, metal),
          ),
          ...box([x + dx, y], 0.51, 0.29, 0.19, 0.23, fabric),
        ]),
      ];
    case "stall":
      return [
        ...[-1.16, 1.16].flatMap((dx) =>
          [-0.56, 0.56].flatMap((dy) =>
            box([x + dx, y + dy], 0.085, 0.085, 0, 0.96, wood),
          ),
        ),
        ...box([x, y - 0.15], width * 0.9, 0.52, 0, 0.37, wood),
        ...box([x, y - 0.15], width * 0.94, 0.59, 0.37, 0.4, cream),
        ...Array.from({ length: 11 }, (_, i) =>
          box(
            [x + ((i - 5) * width) / 11, y],
            width / 11,
            depth,
            0.93,
            1,
            i % 2 ? fabric : cream,
          ),
        ).flat(),
      ];
    case "ramp": {
      const fraction = (north: number) => (north - y) / depth + 0.5;
      const deck = box(center, width, depth, 0, 1, stone);
      return [
        ...deck.map(({ material, vertices }) => ({
          material,
          vertices: vertices.map(([east, north, z]): Vertex => [
            east,
            north,
            z === base ? base : base + height * (0.06 + 0.94 * fraction(north)),
          ]),
        })),
        ...[-0.64, 0.64].flatMap((dx) =>
          slope(
            box([x + dx, y], 0.1, depth, 0.06, 0.18, painted),
            (north) => 0.82 * fraction(north),
          ),
        ),
      ];
    }
    case "bollard":
      return [
        ...disc(width / 2, 0, 0.13, metal),
        ...disc(width * 0.34, 0.13, 0.82, metal),
        ...disc(width * 0.35, 0.82, 0.91, [236, 189, 90]),
        ...disc(width * 0.34, 0.91, 1, metal),
      ];
    case "water_station":
      return [
        ...box(center, width, depth, 0, 0.12, metal),
        ...box(center, width * 0.68, depth * 0.72, 0.12, 0.82, painted),
        ...box(center, width * 0.96, depth * 0.92, 0.8, 0.88, [176, 191, 192]),
        ...box([x, y + 0.22], 0.14, 0.1, 0.88, 1, metal),
        ...box([x, y + 0.15], 0.14, 0.22, 0.95, 1, metal),
        ...box([x, y + 0.02], 0.15, 0.12, 0.88, 0.89, [91, 138, 151]),
      ];
    case "table_tennis":
      return [
        ...[-0.92, 0.92].flatMap((dx) =>
          box([x + dx, y], 0.16, 1.07, 0, 0.79, metal),
        ),
        ...box(center, width, depth, 0.77, 0.84, [45, 111, 131]),
        ...box(center, width, 0.028, 0.84, 0.845, cream),
        ...box(center, 0.026, depth, 0.84, 1, metal),
        ...[-0.72, 0.72].flatMap((dy) =>
          box([x, y + dy], width, 0.028, 0.84, 0.845, cream),
        ),
      ];
    case "slide":
      return [
        ...[-0.61, 0.61].flatMap((dx) => [
          ...[0.46, 1.25].flatMap((dy) =>
            box([x + dx, y + dy], 0.1, 0.1, 0, 1, painted),
          ),
          ...box([x + dx, y + 0.85], 0.11, 0.9, 0.95, 1, painted),
        ]),
        ...box([x, y + 0.85], width * 0.76, 0.82, 0.71, 0.77, wood),
        ...[1, 2, 3, 4].flatMap((i) =>
          box(
            [x, y + 1.66 - i * 0.1],
            0.52,
            0.14,
            i * 0.145,
            i * 0.145 + 0.025,
            metal,
          ),
        ),
        ...slope(
          box([x, y - 0.61], 0.6, 2.15, 0.04, 0.08, [228, 158, 58]),
          (north) => ((north - y + 1.685) / 2.15) * 0.69,
        ),
        ...[-0.29, 0.29].flatMap((dx) =>
          slope(
            box([x + dx, y - 0.61], 0.045, 2.15, 0.07, 0.13, [220, 128, 43]),
            (north) => ((north - y + 1.685) / 2.15) * 0.69,
          ),
        ),
      ];
    case "stage":
      return [
        ...box([x, y + 0.24], width, depth - 0.48, 0, 0.88, metal),
        ...Array.from({ length: 8 }, (_, i) =>
          box(
            [x, y + 0.24 + ((i - 3.5) * (depth - 0.48)) / 8],
            width,
            (depth - 0.48) / 8 - 0.018,
            0.88,
            1,
            i % 2 ? wood : [163, 116, 77],
          ),
        ).flat(),
        ...box([x, y - 1.32], 1.25, 0.46, 0, 0.43, metal),
        ...box([x, y - 1.2], 1.25, 0.22, 0.43, 0.71, wood),
      ];
  }
}

export function objectFaces(
  element: ShadeElement,
  ground: (point: Point) => number = () => 0,
): Face[] {
  if (element.kind === "shade_canopy") return canopyFaces(element, ground);

  const base = ground(element.coordinates);
  if (element.kind !== "shade_tree") {
    const [x, y] = element.coordinates;
    const height = element.heightM;
    if (element.kind === "planter") {
      const outline = furnitureFootprint(element.kind, element.coordinates);
      return [
        ...prism(outline, base, base + height * 0.66, [168, 91, 60]),
        ...prism(
          rectangle([x, y], 0.41),
          base + height * 0.66,
          base + height * 0.7,
          [85, 61, 41],
        ),
        ...[-0.26, 0, 0.26].flatMap((offset, index) =>
          prism(
            rectangle([x + offset, y + 0.12 * (index % 2)], 0.11),
            base + height * 0.69,
            base + height * (index === 1 ? 1 : 0.9),
            foliage[index],
          ),
        ),
      ];
    }
    if (element.kind !== "bench")
      return catalogFaces(element.kind, element.coordinates, base, height, element.dimensionsM);
    const outline = furnitureFootprint(element.kind, element.coordinates);
    const halfWidth = terrainObjects.bench.width / 2;
    const seat = base + height * 0.48;
    return [
      ...outline.flatMap(([cornerX, cornerY]) =>
        prism(
          rectangle([x + (cornerX - x) * 0.84, y + (cornerY - y) * 0.78], 0.05),
          base,
          seat,
          frame,
        ),
      ),
      ...[-0.21, 0, 0.21].flatMap((offset) =>
        beam(
          [x - halfWidth, y + offset],
          [x + halfWidth, y + offset],
          0.17,
          seat,
          seat + height * 0.08,
          wood,
        ),
      ),
      ...[-0.73, 0.73].flatMap((offset) =>
        prism(
          rectangle([x + offset, y + 0.27], 0.042),
          seat,
          base + height,
          frame,
        ),
      ),
      ...[0.7, 0.88].flatMap((level) =>
        beam(
          [x - halfWidth, y + 0.27],
          [x + halfWidth, y + 0.27],
          0.065,
          base + height * level,
          base + height * (level + 0.12),
          wood,
        ),
      ),
    ];
  }
  return treeFaces(element).map(({ vertices, material }) => ({
    material,
    vertices: vertices.map(([x, y, z]) => [x, y, z + base]),
  }));
}
