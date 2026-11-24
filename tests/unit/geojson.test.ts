import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  geoJsonFeatureCollectionSchema,
  positionSchema,
} from "@/lib/schemas/geojson";

const readFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(process.cwd(), "data/sites/zocalo-puebla", name), "utf8"),
  );
const baseline = readFixture("baseline.geojson");
const scenario = readFixture("scenario.geojson");

const bounds = [-98.1988758, 19.0430895, -98.1973016, 19.0442743] as const;

function allPositionsAreInsideBounds(
  collection: ReturnType<typeof geoJsonFeatureCollectionSchema.parse>,
) {
  return collection.features.every((feature) => {
    const positions =
      feature.geometry.type === "Point"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates.flat();

    return positions.every(
      ([longitude, latitude]) =>
        longitude >= bounds[0] &&
        longitude <= bounds[2] &&
        latitude >= bounds[1] &&
        latitude <= bounds[3],
    );
  });
}

describe("pilot GeoJSON", () => {
  it("accepts the sourced baseline and hypothetical scenario", () => {
    const parsedBaseline = geoJsonFeatureCollectionSchema.parse(baseline);
    const parsedScenario = geoJsonFeatureCollectionSchema.parse(scenario);

    expect(parsedBaseline.features).toHaveLength(1);
    expect(parsedBaseline.features[0].properties.status).toBe("reference");
    expect(parsedScenario.features).toHaveLength(2);
    expect(
      parsedScenario.features.every(
        (feature) => feature.properties.status === "hypothetical",
      ),
    ).toBe(true);
    expect(allPositionsAreInsideBounds(parsedBaseline)).toBe(true);
    expect(allPositionsAreInsideBounds(parsedScenario)).toBe(true);
  });

  it("rejects non-finite and out-of-range WGS84 positions", () => {
    expect(positionSchema.safeParse([Number.NaN, 19]).success).toBe(false);
    expect(positionSchema.safeParse([-181, 19]).success).toBe(false);
    expect(positionSchema.safeParse([-98, 91]).success).toBe(false);
  });

  it("rejects unclosed polygon rings", () => {
    const invalid = structuredClone(
      geoJsonFeatureCollectionSchema.parse(scenario),
    );
    const geometry = invalid.features[0].geometry;
    if (geometry.type !== "Polygon")
      throw new Error("Expected polygon fixture");
    geometry.coordinates[0].pop();
    expect(geoJsonFeatureCollectionSchema.safeParse(invalid).success).toBe(
      false,
    );
  });
});
