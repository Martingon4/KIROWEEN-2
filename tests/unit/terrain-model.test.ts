import { describe, expect, it } from "vitest";
import { terrainExample } from "@/features/terrain/terrain-example";
import {
  accessFootprint,
  fitPhotoCovers,
  isGeneratedPhotoElement,
  photoRegion,
  suggestPhotoOutline,
  suggestPhotoTreeline,
  surfaceWithAccess,
} from "@/features/terrain/photo-proposal";
import { objectFaces } from "@/features/terrain/terrain-perspective-model";
import { terrainCamera } from "@/features/terrain/terrain-perspective-render";
import { overviewMarkers } from "@/features/terrain/terrain-overview";
import type { ShadeScene } from "@/lib/schemas/shade-scene";
import {
  createPhotoRelief,
  reliefCoordinates,
} from "@/features/terrain/terrain-relief";
import {
  buildSurface,
  terrainDraftSchema,
  terrainSun,
} from "@/features/terrain/terrain-model";
import { projectContext } from "@/features/terrain/terrain-context";
import {
  furnitureFootprint,
  objectsOverlap,
  rectangle,
  shadeRings,
} from "@/features/compare/shade-geometry";
import { footprintFitsSurface } from "@/lib/geo/planar";
import {
  terrainObjectKinds,
  terrainObjects,
} from "@/lib/schemas/terrain-objects";

it("groups small overview markers and leaves large or off-screen models alone", () => {
  const targets = [
    { id: "bench", x: 40, size: 2 },
    { id: "tree", x: 49, size: 6 },
    { id: "small", x: 150, size: 2 },
    { id: "market", x: 210, size: 30 },
    { id: "outside", x: 400, size: 2 },
  ].map(({ id, x, size }) => ({
    id,
    label: id,
    glyph: "◆",
    framing: { points: rectangle([x, 55], size / 2), tallest: 1 },
  }));
  const markers = overviewMarkers(targets, ([x, y, z]) => [x, y - z, 1], 360, 200);
  expect(markers.map(({ x, targets: group }) => [x, group.map(({ id }) => id)]))
    .toEqual([[40, ["bench", "tree"]], [150, ["small"]]]);
});

it("keeps a close frame around one object even when another is far away", () => {
  const surface = [
    [
      [
        [0, 0],
        [100, 0],
        [100, 80],
        [0, 80],
        [0, 0],
      ],
    ],
  ] as ShadeScene["surface"];
  const bench = {
    id: "bench",
    kind: "bench" as const,
    coordinates: [12, 16] as [number, number],
    heightM: 0.95,
  };
  const scene: ShadeScene = { surface, elements: [bench] };
  const framing = {
    points: rectangle(bench.coordinates, 0.9, 0.325),
    tallest: bench.heightM,
    groundHeight: 0,
  };
  const detail = terrainCamera(scene, 305, 1, false, framing);
  expect(
    terrainCamera(
      {
        ...scene,
        elements: [
          ...scene.elements,
          { ...bench, id: "other", coordinates: [92, 76] },
        ],
      },
      305,
      1,
      false,
      framing,
    ),
  ).toEqual(detail);
  expect(detail).toMatchObject({
    centerX: 12,
    centerY: 16,
    target: bench.heightM / 2,
  });
  expect(detail.distance).toBeLessThan(3);
  expect(terrainCamera(scene, 305, 1, false).distance).toBeGreaterThan(100);
});

describe("terrain capture", () => {
  it("uses the first measured side for scale and puts north at the top of the sketch", () => {
    expect(
      buildSurface(
        [
          [100, 200],
          [200, 200],
          [200, 100],
          [100, 100],
        ],
        24,
      ),
    ).toEqual([
      [
        [
          [0, 0],
          [24, 0],
          [24, 24],
          [0, 24],
          [0, 0],
        ],
      ],
    ]);
  });

  it("rejects outlines with repeated corners, crossings or an invalid scale", () => {
    expect(
      buildSurface(
        [
          [0, 0],
          [10, 10],
          [0, 10],
          [10, 0],
        ],
        10,
      ),
    ).toBeNull();
    expect(
      buildSurface(
        [
          [0, 0],
          [10, 10],
          [10, 10],
          [0, 20],
        ],
        10,
      ),
    ).toBeNull();
    expect(
      buildSurface(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        0,
      ),
    ).toBeNull();
  });

  it("agrees with the curated Puebla scenario and suppresses shade below 10°", () => {
    const { capture, date } = terrainExample;
    const afternoon = terrainSun(capture, date, "16:00");
    expect(afternoon?.azimuthRad).toBeCloseTo(4.440486, 5);
    expect(afternoon?.elevationRad).toBeCloseTo(0.654517, 5);
    expect(terrainSun(capture, date, "19:00")).toBeNull();
  });

  it("rejects a canopy that crosses a recess even when all four corners are on the terrain", () => {
    expect(
      footprintFitsSurface(
        [
          [3, 4],
          [7, 4],
          [7, 6],
          [3, 6],
        ],
        [
          [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [6, 10],
              [6, 3],
              [4, 3],
              [4, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        ],
      ),
    ).toBe(false);
  });
});

describe("photo proposals", () => {
  function raster(cutout: boolean) {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const floor = y >= 18 && x >= 6 && x <= 57 && !(cutout && y < 42 && x > 27);
        data.set(floor ? [175, 153, 126, 255] : [51, 90, 112, 255], (y * width + x) * 4);
      }
    }
    return { data, width, height };
  }

  it("suggests distinct outlines and sizes buildable modules for photos with the same dimensions", () => {
    const rectangular = suggestPhotoOutline(raster(false), 5 / 3);
    const notched = suggestPhotoOutline(raster(true), 5 / 3);
    expect(rectangular.detected && notched.detected).toBe(true);
    expect(notched.corners).not.toEqual(rectangular.corners);
    const dimensions = [rectangular, notched].map(({ corners }) => {
      const surface = buildSurface(corners, 10, 10)!;
      const building = fitPhotoCovers(surface).a[0];
      if (building?.kind !== "community_room") throw new Error("Expected a fitted building.");
      expect(footprintFitsSurface(furnitureFootprint(building.kind, building.coordinates, building.dimensionsM), surface)).toBe(true);
      return building.dimensionsM!;
    });
    expect(dimensions[0][0] * dimensions[0][1])
      .toBeGreaterThan(dimensions[1][0] * dimensions[1][1]);
  });

  it("creates editable, distinct site layouts with several objects and no blocked footprints", () => {
    const corners = [[0, 280], [400, 280], [400, 0], [0, 0]] as [number, number][];
    const surface = buildSurface(corners, 10, 10)!;
    const access = accessFootprint(
      { corners, distance: 10, measuredDepth: 10, location: null, utcOffset: 0 },
      { points: [[200, 260], [200, 20]], width: 1.2 },
    )!;
    const layouts = fitPhotoCovers(surface, access);
    expect(layouts.a.length).toBeGreaterThanOrEqual(4);
    expect(layouts.b.length).toBeGreaterThanOrEqual(4);
    expect(layouts.a[0].kind).toBe("community_room");
    expect(layouts.b[0].kind).toBe("civic_pavilion");
    expect(layouts.a.map(({ kind }) => kind)).not.toEqual(layouts.b.map(({ kind }) => kind));
    const free = surfaceWithAccess(surface, access);
    for (const option of [layouts.a, layouts.b]) {
      expect(option.every(({ id }) => isGeneratedPhotoElement(id))).toBe(true);
      for (const item of option) {
        const footprint = item.kind === "shade_canopy"
          ? item.coordinates[0].slice(0, -1)
          : item.kind === "shade_tree"
            ? [item.coordinates]
            : furnitureFootprint(item.kind, item.coordinates, item.dimensionsM);
        expect(footprintFitsSurface(footprint, free)).toBe(true);
      }
      for (let i = 0; i < option.length; i++) {
        for (let j = i + 1; j < option.length; j++) {
          expect(objectsOverlap(option[i], option[j])).toBe(false);
        }
      }
    }
  });

  it("reads a visible tree band as approximate background context", () => {
    const photo = raster(false);
    for (let y = 5; y < 34; y++) {
      for (let x = 0; x < 64; x++) {
        photo.data.set(
          y < 16 ? [155, 195, 235, 255] : [42, 102, 48, 255],
          (y * 64 + x) * 4,
        );
      }
    }
    expect(suggestPhotoTreeline(photo).length).toBeGreaterThanOrEqual(3);
    expect(suggestPhotoTreeline(raster(false))).toEqual([]);
  });

  it("ignores screenshot borders when looking for the foreground floor", () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inside = x >= 6 && x <= 57 && y >= 5 && y <= 54;
        const floor = inside && y >= 30;
        data.set(
          floor ? [95, 156, 57, 255] : inside ? [145, 184, 226, 255] : [28, 29, 33, 255],
          (y * width + x) * 4,
        );
      }
    }
    const outline = suggestPhotoOutline({ data, width, height }, 64 / 64);
    expect(outline.detected).toBe(true);
    const region = photoRegion(outline.corners, 1);
    expect(region.top).toBeGreaterThan(0.4);
    expect(region.bottom).toBeLessThan(0.9);
  });

  it("falls back to a marked approximation for a uniform photo", () => {
    const data = new Uint8ClampedArray(64 * 64 * 4).fill(255);
    expect(suggestPhotoOutline({ data, width: 64, height: 64 }, 1).detected).toBe(false);
  });

  it("refits compact buildings outside the reserved passage and rejects a site too narrow to build", () => {
    const capture = {
      corners: [[0, 280], [400, 280], [400, 0], [0, 0]] as [number, number][],
      distance: 10, location: null, utcOffset: 0,
    };
    const surface = buildSurface(capture.corners, capture.distance)!;
    const access = accessFootprint(capture, { points: [[200, 265], [200, 15]], width: 2 })!;
    const free = surfaceWithAccess(surface, access);
    const before = fitPhotoCovers(surface);
    const after = fitPhotoCovers(surface, access);
    expect(after.a).not.toEqual(before.a);
    for (const option of [after.a, after.b]) {
      expect(option.length).toBeGreaterThan(0);
      for (const item of option) {
        const footprint = item.kind === "shade_canopy"
          ? item.coordinates[0].slice(0, -1)
          : item.kind === "shade_tree"
            ? [item.coordinates]
            : furnitureFootprint(item.kind, item.coordinates, item.dimensionsM);
        expect(footprintFitsSurface(footprint, free)).toBe(true);
      }
    }
    const narrow = buildSurface([[0, 280], [40, 280], [40, 0], [0, 0]], 1.1)!;
    expect(fitPhotoCovers(narrow)).toEqual({ a: [], b: [] });
  });
});

describe("perspective meshes", () => {
  it.each(["community_room", "civic_pavilion"] as const)(
    "keeps the compact %s structure within its footprint and entrance projection",
    (kind) => {
      const faces = objectFaces({
        id: "00000000-0000-4000-8000-000000000001",
        kind,
        heightM: terrainObjects[kind].height,
        coordinates: [5, 5],
        dimensionsM: [3.4, 3.2],
      });
      const vertices = faces.flatMap(({ vertices }) => vertices);
      expect(Math.max(...vertices.map(([x]) => Math.abs(x - 5)))).toBeLessThan(1.96);
      expect(Math.max(...vertices.map(([, y]) => Math.abs(y - 5)))).toBeLessThan(2.3);
      expect(Math.max(...vertices.map(([, , z]) => z))).toBeCloseTo(terrainObjects[kind].height);
      expect(new Set(faces.map(({ material }) => material.join(","))).size).toBeGreaterThan(4);
    },
  );

  it("anchors the four canopy supports to the ground and builds a roof at the selected height", () => {
    const faces = objectFaces({
      id: "canopy",
      kind: "shade_canopy",
      heightM: 3,
      coordinates: [
        [
          [0, 0],
          [3, 0],
          [3, 3],
          [0, 3],
          [0, 0],
        ],
      ],
    });
    expect(
      faces.filter(({ vertices }) => vertices.every(([, , z]) => z === 0)),
    ).toHaveLength(4);
    expect(
      faces.some(({ vertices }) => vertices.every(([, , z]) => z === 3)),
    ).toBe(true);
    expect(new Set(faces.map(({ material }) => material.join(","))).size).toBe(
      3,
    );
  });

  it("gives the tree a trunk at ground level and a crown with physical volume", () => {
    const vertices = objectFaces({
      id: "tree",
      kind: "shade_tree",
      heightM: 4,
      canopyDiameterM: 2.5,
      coordinates: [2, 3],
    }).flatMap(({ vertices }) => vertices);
    expect(Math.min(...vertices.map(([, , z]) => z))).toBe(0);
    expect(Math.max(...vertices.map(([, , z]) => z))).toBeGreaterThan(3.8);
    expect(
      Math.max(...vertices.map(([x]) => x)) -
        Math.min(...vertices.map(([x]) => x)),
    ).toBeGreaterThan(1.5);
  });
});

describe("terrain catalog", () => {
  it.each(terrainObjectKinds)(
    "renders and persists %s at its default height",
    (kind) => {
      const heightM = terrainObjects[kind].height;
      const object = {
        id: "00000000-0000-4000-8000-000000000001",
        kind,
        heightM,
        coordinates: [4, 5] as [number, number],
      };
      const faces = objectFaces(object, () => 2);
      const heights = faces.flatMap(({ vertices }) =>
        vertices.map((vertex) => vertex[2]),
      );
      expect(Math.min(...heights)).toBe(2);
      expect(Math.max(...heights)).toBeCloseTo(2 + heightM);
      expect(
        terrainDraftSchema.parse({
          ...terrainExample,
          alternatives: { a: [object], b: [] },
        }).alternatives.a,
      ).toEqual([object]);
    },
  );

  it("blocks the tree trunk inside a stall and allows a bench under a roof", () => {
    const trunk = {
      id: "tree",
      kind: "shade_tree",
      heightM: 4,
      canopyDiameterM: 5,
      coordinates: [0, 0],
    } as const;
    const stall = {
      id: "stall",
      kind: "stall" as const,
      heightM: 2.53,
      coordinates: [1.25, 0] as [number, number],
    };
    const canopy = rectangle([0, 0], 1.5);
    const roof = {
      id: "roof",
      kind: "shade_canopy" as const,
      heightM: 3,
      coordinates: [[...canopy, canopy[0]]],
    };
    const bench = {
      id: "bench",
      kind: "bench" as const,
      heightM: 0.95,
      coordinates: [0, 0] as [number, number],
    };
    expect(objectsOverlap({ ...trunk, coordinates: [0, 0] }, stall)).toBe(true);
    expect(objectsOverlap(roof, bench)).toBe(false);
    expect(shadeRings(stall)).toHaveLength(1);
    expect(shadeRings(bench)).toHaveLength(0);
  });

  it("projects a closed building and clips crossing roads to the reference window", () => {
    const { capture } = terrainExample;
    const surface = buildSurface(capture.corners, capture.distance)!;
    const view = projectContext(
      [
        {
          kind: "building",
          height: 11,
          points: [
            [-98.1986, 19.0438],
            [-98.1984, 19.0438],
            [-98.1984, 19.044],
            [-98.1986, 19.044],
            [-98.1986, 19.0438],
          ],
        },
        {
          kind: "street",
          points: [
            [-98.3, 19.0435],
            [-98.1, 19.0435],
          ],
        },
        {
          kind: "building",
          points: [
            [-99, 19],
            [-99.002, 19],
            [-99.002, 19.001],
            [-99, 19],
          ],
        },
      ],
      capture.location!,
      surface,
    );
    expect(view).toMatchObject({
      buildings: 1,
      routes: 1,
      framing: { tallest: 11 },
    });
    expect(
      view!.faces
        .flatMap(({ vertices }) => vertices)
        .every(([x, y]) => Math.abs(x) < 140 && Math.abs(y) < 140),
    ).toBe(true);
  });
});

describe("terrain from depth", () => {
  it("keeps the ground level and raises a nearer region above it", () => {
    const width = 64;
    const height = 64;
    const data = Float32Array.from({ length: width * height }, (_, i) => {
      const y = Math.floor(i / width);
      const x = i % width;
      return y / height + (x > 30 && x < 43 && y > 14 && y < 36 ? 0.45 : 0);
    });
    const colors = new Uint8ClampedArray(width * height * 4).fill(128);
    const relief = createPhotoRelief(
      { data, width, height },
      { data: colors, width, height },
    );
    expect(relief).not.toBeNull();
    const ground = buildSurface(
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      10,
      20,
    );
    expect(ground?.[0][0][2]).toEqual([10, -20]);
    const { elevation } = reliefCoordinates(ground!, relief!);
    expect(elevation([6, -8])).toBeGreaterThan(1);
    expect(elevation([2, -15])).toBeLessThan(0.15);
  });

  it("samples ground colors inside the visible floor region", () => {
    const width = 64;
    const height = 64;
    const depth = Float32Array.from({ length: width * height }, (_, i) =>
      Math.floor(i / width) / height,
    );
    const colors = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      colors.set(Math.floor(i / width) < 32
        ? [133, 191, 238, 255]
        : [86, 147, 58, 255], i * 4);
    }
    const relief = createPhotoRelief(
      { data: depth, width, height },
      { data: colors, width, height },
      { left: 0.1, right: 0.9, top: 0.55, bottom: 0.85 },
    );
    expect(relief?.samples.every(({ color }) => color[1] === 147)).toBe(true);
  });
});
