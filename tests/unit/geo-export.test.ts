import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toFeatureCollection, validateGeoJson } from "@/lib/geo/export";
import { FIXTURE_IDS, PILOT_BOUNDS, buildDossier } from "../fixtures/dossier";

/** Property seed for this file: 20260514. */
const SEED = 20260514;
const RUNS = 500;
const NOW = new Date("2026-06-01T12:34:56.000Z");

type Loose = Record<string, unknown> & {
  features: { geometry: Record<string, unknown> | undefined }[];
};
const exported = (): Loose =>
  structuredClone(toFeatureCollection(buildDossier(), NOW)) as unknown as Loose;

describe("toFeatureCollection", () => {
  const dossier = buildDossier();
  const collection = toFeatureCollection(dossier, NOW);

  it("is a FeatureCollection with the same features and ids", () => {
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(
      dossier.publication.features.length,
    );
    expect(collection.features.map((f) => f.id)).toEqual(
      dossier.publication.features.map((f) => f.id),
    );
    expect(collection.features.map((f) => f.id)).toEqual([
      FIXTURE_IDS.canopy,
      FIXTURE_IDS.market,
    ]);
  });

  it("flags every feature as hypothetical and keeps provenance ids", () => {
    for (const feature of collection.features) {
      expect(feature.type).toBe("Feature");
      expect(feature.properties.status).toBe("hypothetical");
      expect(feature.properties.dossierId).toBe(FIXTURE_IDS.dossier);
      expect(feature.properties.publicationId).toBe(FIXTURE_IDS.publication);
    }
    expect(collection.features[0].properties.kind).toBe("shade_canopy");
    expect(collection.features[0].properties.label).toBe("Cubierta norte");
    expect(collection.features[0].properties.attributes).toEqual({
      heightM: 4,
    });
    expect(collection.features[1].properties.attributes).toEqual({
      stallCount: 12,
      moduleM2: 6,
      timeSlot: "08:00-14:00",
    });
  });

  it("has no crs member and leaves [lon, lat] coordinates unchanged", () => {
    expect("crs" in collection).toBe(false);
    collection.features.forEach((feature, index) => {
      expect(feature.geometry).toEqual(
        dossier.publication.features[index].geometry,
      );
      const [lon, lat] = (
        feature.geometry.coordinates as number[][][]
      )[0][0];
      expect(lon).toBeGreaterThanOrEqual(PILOT_BOUNDS[0]);
      expect(lon).toBeLessThanOrEqual(PILOT_BOUNDS[2]);
      expect(lat).toBeGreaterThanOrEqual(PILOT_BOUNDS[1]);
      expect(lat).toBeLessThanOrEqual(PILOT_BOUNDS[3]);
    });
  });

  it("writes ISO metadata with scenario and budget label", () => {
    expect(collection.metadata.generatedAt).toBe(NOW.toISOString());
    expect(collection.metadata.scenario).toBe("summer-solstice-noon");
    expect(collection.metadata.budgetLabel).toBe("fully_illustrative");
    expect(collection.metadata.source).toMatch(/hypothetical/i);
  });

  it("survives JSON serialization unchanged", () => {
    expect(JSON.parse(JSON.stringify(collection))).toEqual(collection);
  });

  it("exports an empty dossier as an empty valid collection", () => {
    const empty = buildDossier();
    empty.publication.features = [];
    const out = toFeatureCollection(empty, NOW);
    expect(out.features).toEqual([]);
    expect(validateGeoJson(out)).toEqual([]);
  });
});

describe("validateGeoJson", () => {
  it("accepts the exported fixture", () => {
    expect(validateGeoJson(toFeatureCollection(buildDossier(), NOW))).toEqual(
      [],
    );
  });

  it("accepts points and lines", () => {
    const ok = exported();
    ok.features.push(
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-98.198, 19.0436] },
      } as Loose["features"][number],
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-98.1985, 19.0432],
            [-98.1975, 19.0441],
          ],
        },
      } as Loose["features"][number],
    );
    expect(validateGeoJson(ok)).toEqual([]);
  });

  it("rejects a crs member", () => {
    const bad = { ...exported(), crs: { type: "name", properties: {} } };
    expect(validateGeoJson(bad)).toContain("crs member is not allowed");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["latitude 91", 91],
    ["latitude -91", -91],
  ])("rejects a point with %s as latitude", (_name, value) => {
    const bad = exported();
    bad.features[0].geometry = { type: "Point", coordinates: [-98.19, value] };
    expect(validateGeoJson(bad)).toEqual(["feature 0: bad point"]);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["longitude 181", 181],
    ["longitude -181", -181],
  ])("rejects a point with %s as longitude", (_name, value) => {
    const bad = exported();
    bad.features[0].geometry = { type: "Point", coordinates: [value, 19.04] };
    expect(validateGeoJson(bad)).toEqual(["feature 0: bad point"]);
  });

  it("accepts the exact WGS84 limits", () => {
    const edge = exported();
    edge.features[0].geometry = { type: "Point", coordinates: [180, 90] };
    edge.features[1].geometry = { type: "Point", coordinates: [-180, -90] };
    expect(validateGeoJson(edge)).toEqual([]);
  });

  it("rejects a position with three components and a non-array position", () => {
    const three = exported();
    three.features[0].geometry = { type: "Point", coordinates: [1, 2, 3] };
    expect(validateGeoJson(three)).toHaveLength(1);
    const garbage = exported();
    garbage.features[0].geometry = { type: "Point", coordinates: "1,2" };
    expect(validateGeoJson(garbage)).toHaveLength(1);
  });

  it("rejects an unclosed ring", () => {
    const bad = exported();
    bad.features[0].geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    };
    expect(validateGeoJson(bad)).toEqual([
      "feature 0: ring is not closed or too short",
    ]);
  });

  it("rejects a ring with three positions", () => {
    const bad = exported();
    bad.features[0].geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    expect(validateGeoJson(bad)).toEqual([
      "feature 0: ring is not closed or too short",
    ]);
  });

  it("rejects a polygon without rings", () => {
    const bad = exported();
    bad.features[0].geometry = { type: "Polygon", coordinates: [] };
    expect(validateGeoJson(bad)).toEqual(["feature 0: polygon without rings"]);
  });

  it("rejects a line with one position or a bad vertex", () => {
    const one = exported();
    one.features[0].geometry = { type: "LineString", coordinates: [[0, 0]] };
    expect(validateGeoJson(one)).toEqual(["feature 0: bad line"]);
    const nan = exported();
    nan.features[0].geometry = {
      type: "LineString",
      coordinates: [
        [0, 0],
        [Number.NaN, 1],
      ],
    };
    expect(validateGeoJson(nan)).toEqual(["feature 0: bad line"]);
  });

  it("rejects unsupported geometry types and missing geometry", () => {
    const multi = exported();
    multi.features[0].geometry = {
      type: "MultiPoint",
      coordinates: [[0, 0]],
    };
    expect(validateGeoJson(multi)).toEqual(["feature 0: unsupported geometry"]);
    const missing = exported();
    missing.features[0].geometry = undefined;
    expect(validateGeoJson(missing)).toEqual(["feature 0: missing geometry"]);
    const nullGeometry = exported();
    (nullGeometry.features[0] as { geometry: unknown }).geometry = null;
    expect(validateGeoJson(nullGeometry)).toEqual([
      "feature 0: missing geometry",
    ]);
  });

  it("rejects a feature whose type is not Feature", () => {
    const bad = exported();
    (bad.features[0] as Record<string, unknown>).type = "Thing";
    expect(validateGeoJson(bad)).toContain("feature 0: not a Feature");
  });

  it.each([
    ["a Feature", { type: "Feature", geometry: null }],
    ["null", null],
    ["a string", "FeatureCollection"],
    ["without features", { type: "FeatureCollection" }],
    ["features not an array", { type: "FeatureCollection", features: {} }],
  ])("rejects a non-collection: %s", (_name, value) => {
    expect(validateGeoJson(value)).toEqual(["not a FeatureCollection"]);
  });
});

describe("export → validate properties (seed 20260514)", () => {
  const range = (min: number, max: number) =>
    fc
      .double({ min, max, noNaN: true, noDefaultInfinity: true })
      .map((value) => value + 0); // -0 + 0 === 0: JSON drops the sign of -0

  const rectangle = fc
    .tuple(range(-180, 180), range(-180, 180), range(-90, 90), range(-90, 90))
    .filter(([a, b, c, d]) => a < b && c < d)
    .map(([west, east, south, north]) => ({
      type: "Polygon" as const,
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    }));

  const point = fc
    .tuple(range(-180, 180), range(-90, 90))
    .map(([lon, lat]) => ({
      type: "Point" as const,
      // -0 does not survive JSON; normalize it so the round-trip check is meaningful.
      coordinates: [lon + 0, lat + 0],
    }));

  const geometries = fc.array(fc.oneof(rectangle, point), {
    minLength: 1,
    maxLength: 6,
  });

  const collectionFor = (list: { type: string; coordinates: unknown }[]) => {
    const dossier = buildDossier();
    const template = dossier.publication.features[0];
    dossier.publication.features = list.map((geometry, index) => ({
      ...template,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      geometry: geometry as never,
    }));
    return toFeatureCollection(dossier, NOW);
  };

  it("valid random polygons and points export without problems", () => {
    fc.assert(
      fc.property(geometries, (list) => {
        const collection = collectionFor(list);
        expect(collection.features).toHaveLength(list.length);
        expect(validateGeoJson(collection)).toEqual([]);
        expect(JSON.parse(JSON.stringify(collection))).toEqual(collection);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("corrupting one coordinate with NaN or 200 is always detected", () => {
    fc.assert(
      fc.property(
        geometries,
        fc.nat(),
        fc.nat(),
        fc.constantFrom(0, 1),
        fc.constantFrom(Number.NaN, 200),
        (list, featureSeed, vertexSeed, axis, bad) => {
          const collection = structuredClone(collectionFor(list));
          const feature =
            collection.features[featureSeed % collection.features.length];
          const geometry = feature.geometry;
          if (geometry.type === "Point") {
            geometry.coordinates[axis] = bad;
          } else if (geometry.type === "Polygon") {
            const ring = geometry.coordinates[0];
            ring[vertexSeed % ring.length][axis] = bad;
          }
          expect(validateGeoJson(collection).length).toBeGreaterThanOrEqual(1);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
