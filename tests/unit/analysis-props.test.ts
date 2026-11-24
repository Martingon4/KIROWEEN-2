import { readFileSync } from "node:fs";
import fc from "fast-check";
import SunCalc from "suncalc";
import { describe, expect, it } from "vitest";

/**
 * Property tests for the pure math behind `analysis_compute` and `cost_compute`
 * (supabase/migrations/20261123020000_analysis_compute.sql). The formulas are
 * replicated here from the documented model, not imported, so a change in the SQL
 * that departs from the model is caught by the pgTAP suite and a change in the model
 * is caught here.
 *
 *   shade offset  d = H / tan(elevation), direction opposite the sun
 *                 dx = -d * sin(azimuth), dy = -d * cos(azimuth)
 *                 (azimuth clockwise from north, x east, y north)
 *   azimuth       SunCalc measures from south, westward positive; stored value is
 *                 mod(azimuth + pi, 2 pi)
 *   money         amount = round_half_up(quantity * price_cents) per line, total = sum
 */

const SEED = 20260514;
const RUNS = 500;
const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

const dataset = JSON.parse(
  readFileSync("data/sites/zocalo-puebla/solar-scenarios.json", "utf8"),
) as {
  latitude: number;
  longitude: number;
  scenarios: { slug: string; instantUtc: string; azimuthRad: number; elevationRad: number }[];
};

function shadowOffset(heightM: number, azimuthRad: number, elevationRad: number) {
  const d = heightM / Math.tan(elevationRad);
  return { d, dx: -d * Math.sin(azimuthRad), dy: -d * Math.cos(azimuthRad) };
}

function sunDirection(azimuthRad: number) {
  return { x: Math.sin(azimuthRad), y: Math.cos(azimuthRad) };
}

function mod(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus;
}

function sunCalcToClockwiseFromNorth(sunCalcAzimuth: number) {
  return mod(sunCalcAzimuth + Math.PI, TWO_PI);
}

/** Round half up on an exact integer ratio numerator/denominator (non-negative). */
function roundHalfUp(numerator: bigint, denominator: bigint) {
  return (BigInt(2) * numerator + denominator) / (BigInt(2) * denominator);
}

/** Quantity in hundredths (the SQL rounds quantities to two decimals) times price in cents. */
function lineAmountCents(quantityHundredths: bigint, priceCents: bigint) {
  return roundHalfUp(quantityHundredths * priceCents, BigInt(100));
}

const azimuth = fc.double({ min: 0, max: TWO_PI, maxExcluded: true, noNaN: true });
const elevation = fc.double({ min: 10 * DEG, max: 80 * DEG, noNaN: true });
const height = fc.double({ min: 2.5, max: 30, noNaN: true });

describe("shadow displacement", () => {
  it("has magnitude H / tan(elevation)", () => {
    fc.assert(
      fc.property(height, azimuth, elevation, (h, az, el) => {
        const { d, dx, dy } = shadowOffset(h, az, el);
        const expected = h / Math.tan(el);
        expect(d).toBeCloseTo(expected, 9);
        expect(Math.hypot(dx, dy)).toBeCloseTo(expected, 7);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("points opposite the sun", () => {
    fc.assert(
      fc.property(height, azimuth, elevation, (h, az, el) => {
        const { dx, dy, d } = shadowOffset(h, az, el);
        const sun = sunDirection(az);
        const dot = dx * sun.x + dy * sun.y;
        expect(dot).toBeLessThan(0);
        // Exactly antiparallel: dot equals -d.
        expect(dot).toBeCloseTo(-d, 7);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("grows with height and shrinks as the sun rises", () => {
    fc.assert(
      fc.property(
        height,
        fc.double({ min: 0.1, max: 5, noNaN: true }),
        elevation,
        fc.double({ min: 0.01, max: 0.2, noNaN: true }),
        (h, extra, el, delta) => {
          expect(shadowOffset(h + extra, 1, el).d).toBeGreaterThan(shadowOffset(h, 1, el).d);
          const higherSun = Math.min(el + delta, 80 * DEG);
          if (higherSun > el) {
            expect(shadowOffset(h, 1, higherSun).d).toBeLessThan(shadowOffset(h, 1, el).d);
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("stays bounded by H / tan(10 degrees) at the minimum stored elevation", () => {
    fc.assert(
      fc.property(height, azimuth, elevation, (h, az, el) => {
        const { d } = shadowOffset(h, az, el);
        expect(d).toBeLessThanOrEqual(h / Math.tan(10 * DEG) + 1e-9);
        expect(d).toBeGreaterThan(0);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("casts the morning scenario west and the afternoon scenario east", () => {
    const morning = dataset.scenarios.find((s) => s.slug === "equinox-1000")!;
    const afternoon = dataset.scenarios.find((s) => s.slug === "equinox-1600")!;
    const am = shadowOffset(10, morning.azimuthRad, morning.elevationRad);
    const pm = shadowOffset(10, afternoon.azimuthRad, afternoon.elevationRad);
    expect(am.dx).toBeLessThan(0);
    expect(pm.dx).toBeGreaterThan(0);
    // Equinox sun at latitude 19 N stands in the south, so both shadows point north.
    expect(am.dy).toBeGreaterThan(0);
    expect(pm.dy).toBeGreaterThan(0);
  });

  it.each([
    ["sun in the north (0)", 0, 0, -1],
    ["sun in the east (pi/2)", Math.PI / 2, -1, 0],
    ["sun in the south (pi)", Math.PI, 0, 1],
    ["sun in the west (3pi/2)", (3 * Math.PI) / 2, 1, 0],
  ])("%s", (_name, az, ex, ey) => {
    const { dx, dy, d } = shadowOffset(1, az, Math.PI / 4);
    expect(d).toBeCloseTo(1, 12);
    expect(dx).toBeCloseTo(ex, 12);
    expect(dy).toBeCloseTo(ey, 12);
  });
});

describe("azimuth convention", () => {
  it("maps any SunCalc azimuth into [0, 2 pi)", () => {
    fc.assert(
      fc.property(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), (az) => {
        const converted = sunCalcToClockwiseFromNorth(az);
        expect(converted).toBeGreaterThanOrEqual(0);
        expect(converted).toBeLessThan(TWO_PI);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("maps the SunCalc compass points to clockwise-from-north", () => {
    expect(sunCalcToClockwiseFromNorth(0)).toBeCloseTo(Math.PI, 12); // south
    expect(sunCalcToClockwiseFromNorth(-Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12); // east
    expect(sunCalcToClockwiseFromNorth(Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12); // west
    expect(sunCalcToClockwiseFromNorth(Math.PI)).toBeCloseTo(0, 12); // north wraps to 0
    expect(sunCalcToClockwiseFromNorth(-Math.PI)).toBeCloseTo(0, 12);
  });

  it("splits Puebla equinox mornings (east) from afternoons (west)", () => {
    // Mexico City time is UTC-6 all year since 2022; local solar noon in Puebla is ~12:33.
    const dayUtc = Date.UTC(2027, 2, 20);
    const minute = 60_000;
    fc.assert(
      fc.property(
        fc.integer({ min: 8 * 60, max: 11 * 60 + 30 }), // 08:00-11:30 local
        fc.integer({ min: 13 * 60 + 45, max: 16 * 60 + 30 }), // 13:45-16:30 local
        (morningMinute, afternoonMinute) => {
          const am = SunCalc.getPosition(
            new Date(dayUtc + (morningMinute + 6 * 60) * minute),
            dataset.latitude,
            dataset.longitude,
          );
          const pm = SunCalc.getPosition(
            new Date(dayUtc + (afternoonMinute + 6 * 60) * minute),
            dataset.latitude,
            dataset.longitude,
          );
          const amAz = sunCalcToClockwiseFromNorth(am.azimuth);
          const pmAz = sunCalcToClockwiseFromNorth(pm.azimuth);
          expect(amAz).toBeGreaterThan(0);
          expect(amAz).toBeLessThan(Math.PI);
          expect(pmAz).toBeGreaterThan(Math.PI);
          expect(pmAz).toBeLessThan(TWO_PI);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("stays in [0, 2 pi) for every minute of a random day at the pilot site", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 364 }),
        fc.integer({ min: 0, max: 1439 }),
        (dayOfYear, minuteOfDay) => {
          const instant = new Date(Date.UTC(2027, 0, 1) + dayOfYear * 86_400_000 + minuteOfDay * 60_000);
          const position = SunCalc.getPosition(instant, dataset.latitude, dataset.longitude);
          const converted = sunCalcToClockwiseFromNorth(position.azimuth);
          expect(converted).toBeGreaterThanOrEqual(0);
          expect(converted).toBeLessThan(TWO_PI);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("reproduces the stored scenario azimuths from the same instants", () => {
    for (const scenario of dataset.scenarios) {
      const position = SunCalc.getPosition(
        new Date(scenario.instantUtc),
        dataset.latitude,
        dataset.longitude,
      );
      expect(Math.abs(sunCalcToClockwiseFromNorth(position.azimuth) - scenario.azimuthRad)).toBeLessThan(1e-5);
      expect(Math.abs(position.altitude - scenario.elevationRad)).toBeLessThan(1e-5);
    }
  });
});

describe("cost rounding", () => {
  const quantityHundredths = fc.bigInt({ min: BigInt(0), max: BigInt(100000000) });
  const priceCents = fc.bigInt({ min: BigInt(0), max: BigInt(100000000) });
  const pricePair = fc
    .tuple(priceCents, priceCents)
    .map(([a, b]) => (a <= b ? { low: a, high: b } : { low: b, high: a }));

  it("is monotone: low <= high for the same quantity", () => {
    fc.assert(
      fc.property(quantityHundredths, pricePair, (q, { low, high }) => {
        expect(lineAmountCents(q, low)).toBeLessThanOrEqual(lineAmountCents(q, high));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("is monotone in quantity for a fixed price", () => {
    fc.assert(
      fc.property(quantityHundredths, quantityHundredths, priceCents, (a, b, price) => {
        const [small, large] = a <= b ? [a, b] : [b, a];
        expect(lineAmountCents(small, price)).toBeLessThanOrEqual(lineAmountCents(large, price));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("rounds within half a cent of the exact product", () => {
    fc.assert(
      fc.property(quantityHundredths, priceCents, (q, price) => {
        const rounded = lineAmountCents(q, price);
        const twiceDiff = BigInt(2) * (rounded * BigInt(100)) - BigInt(2) * (q * price);
        // |rounded - q*price/100| <= 1/2  <=>  |200*rounded - 2*q*price| <= 100
        expect(twiceDiff <= BigInt(100) && twiceDiff >= -BigInt(100)).toBe(true);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("rounds exact halves up", () => {
    // 0.50 x 1 cent = 0.5 cents -> 1; 1.50 x 1 = 1.5 -> 2; 2.50 x 1 = 2.5 -> 3.
    expect(lineAmountCents(BigInt(50), BigInt(1))).toBe(BigInt(1));
    expect(lineAmountCents(BigInt(150), BigInt(1))).toBe(BigInt(2));
    expect(lineAmountCents(BigInt(250), BigInt(1))).toBe(BigInt(3));
    expect(lineAmountCents(BigInt(49), BigInt(1))).toBe(BigInt(0));
  });

  it("totals the rounded lines, not the rounded sum", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(quantityHundredths, pricePair), { minLength: 0, maxLength: 8 }),
        (lines) => {
          const perLineLow = lines.map(([q, p]) => lineAmountCents(q, p.low));
          const perLineHigh = lines.map(([q, p]) => lineAmountCents(q, p.high));
          const totalLow = perLineLow.reduce((a, b) => a + b, BigInt(0));
          const totalHigh = perLineHigh.reduce((a, b) => a + b, BigInt(0));
          expect(totalLow).toBeLessThanOrEqual(totalHigh);
          // Each rounded line differs from its exact value by at most half a cent, so the
          // total differs from the exact sum by at most n/2 cents.
          const exactTimes100 = lines.reduce((acc, [q, p]) => acc + q * p.low, BigInt(0));
          const diff = BigInt(100) * totalLow - exactTimes100;
          const bound = BigInt(50) * BigInt(lines.length);
          expect(diff <= bound && diff >= -bound).toBe(true);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("shows per-line rounding differs from rounding the sum (documented rule)", () => {
    // Two lines of 0.5 cents: each rounds to 1, so the total is 2. Rounding the sum (1.0) gives 1.
    const lines = [BigInt(50), BigInt(50)].map((q) => lineAmountCents(q, BigInt(1)));
    expect(lines.reduce((a, b) => a + b, BigInt(0))).toBe(BigInt(2));
    expect(roundHalfUp(BigInt(50) + BigInt(50), BigInt(100))).toBe(BigInt(1));
  });

  it("gives zero for an empty list and for zero quantities", () => {
    expect([].reduce((a: bigint, b: bigint) => a + b, BigInt(0))).toBe(BigInt(0));
    fc.assert(
      fc.property(priceCents, (price) => {
        expect(lineAmountCents(BigInt(0), price)).toBe(BigInt(0));
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});
