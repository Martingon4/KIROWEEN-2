import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Independent check of the curated solar scenarios (FT-11).
 *
 * Reference: the NOAA solar position approximation (declination and equation of
 * time from the fractional year, then the hour angle). It shares no code with
 * SunCalc, so agreement within 0.5 degrees validates the generator and the
 * azimuth convention (clockwise from north).
 * Source: NOAA Global Monitoring Division solar calculation details,
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 */

const DEG = 180 / Math.PI;
const TOLERANCE_DEG = 0.5;

type Scenario = {
  slug: string;
  instantUtc: string;
  azimuthRad: number;
  elevationRad: number;
};

const dataset = JSON.parse(
  readFileSync("data/sites/zocalo-puebla/solar-scenarios.json", "utf8"),
) as {
  generator: string;
  latitude: number;
  longitude: number;
  scenarios: Scenario[];
  excluded: { slug: string; reason: string }[];
};

/** NOAA solar position, returned as azimuth clockwise from north and elevation. */
function noaaSolarPosition(instant: Date, latitudeDeg: number, longitudeDeg: number) {
  const startOfYear = Date.UTC(instant.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((instant.getTime() - startOfYear) / 86_400_000) + 1;
  const utcHour =
    instant.getUTCHours() +
    instant.getUTCMinutes() / 60 +
    instant.getUTCSeconds() / 3600;

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHour - 12) / 24);
  const eqTimeMinutes =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma);

  const trueSolarTimeMinutes = utcHour * 60 + eqTimeMinutes + 4 * longitudeDeg;
  const hourAngle = ((trueSolarTimeMinutes / 4 - 180) * Math.PI) / 180;
  const latitude = (latitudeDeg * Math.PI) / 180;

  // Sun direction in east/north/up components.
  const east = -Math.cos(declination) * Math.sin(hourAngle);
  const north =
    Math.sin(declination) * Math.cos(latitude) -
    Math.cos(declination) * Math.sin(latitude) * Math.cos(hourAngle);
  const up =
    Math.sin(declination) * Math.sin(latitude) +
    Math.cos(declination) * Math.cos(latitude) * Math.cos(hourAngle);

  return {
    azimuthDeg: ((Math.atan2(east, north) * DEG) + 360) % 360,
    elevationDeg: Math.asin(up) * DEG,
  };
}

describe("solar scenarios dataset", () => {
  it("pins the generator version and uses the stored convention", () => {
    expect(dataset.generator).toMatch(/^suncalc@\d+\.\d+\.\d+$/);
    expect(dataset.scenarios.length).toBeGreaterThanOrEqual(2);
    expect(
      dataset.excluded.some(
        (entry) => entry.reason === "elevation_below_10deg",
      ),
    ).toBe(true);
  });

  it.each(dataset.scenarios.map((scenario) => [scenario.slug, scenario] as const))(
    "%s matches the NOAA reference within 0.5 degrees",
    (_slug, scenario) => {
      const reference = noaaSolarPosition(
        new Date(scenario.instantUtc),
        dataset.latitude,
        dataset.longitude,
      );
      expect(scenario.azimuthRad * DEG).toBeCloseTo(reference.azimuthDeg, 0);
      expect(
        Math.abs(scenario.azimuthRad * DEG - reference.azimuthDeg),
      ).toBeLessThanOrEqual(TOLERANCE_DEG);
      expect(
        Math.abs(scenario.elevationRad * DEG - reference.elevationDeg),
      ).toBeLessThanOrEqual(TOLERANCE_DEG);
    },
  );

  it("keeps the 10 degree minimum elevation and the morning/afternoon split", () => {
    for (const scenario of dataset.scenarios) {
      expect(scenario.elevationRad * DEG).toBeGreaterThanOrEqual(10);
    }
    const morning = dataset.scenarios.find((s) => s.slug === "equinox-1000");
    const afternoon = dataset.scenarios.find((s) => s.slug === "equinox-1600");
    expect(morning!.azimuthRad * DEG).toBeGreaterThan(0);
    expect(morning!.azimuthRad * DEG).toBeLessThan(180);
    expect(afternoon!.azimuthRad * DEG).toBeGreaterThan(180);
    expect(afternoon!.azimuthRad * DEG).toBeLessThan(360);
  });
});
