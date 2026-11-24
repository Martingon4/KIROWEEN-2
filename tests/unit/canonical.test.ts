import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDefaultIntervention } from "@/features/editor/defaults";
import {
  canonicalizeFeatures,
  canonicalJson,
  roundCoordinate,
  sameSnapshot,
} from "@/lib/geo/canonical";
import { editableKinds, type Intervention } from "@/lib/schemas/intervention";

const SEED = 20260514;
const labels = { label: "Elemento", timeSlot: "Sábados" };

const interventionArb: fc.Arbitrary<Intervention> = fc
  .record({
    id: fc.uuid(),
    kind: fc.constantFrom(...editableKinds),
    lon: fc.double({ min: -170, max: 170, noNaN: true }),
    lat: fc.double({ min: -80, max: 80, noNaN: true }),
  })
  .map(({ id, kind, lon, lat }) =>
    createDefaultIntervention(kind, id, [lon, lat], labels),
  );

const listArb = fc.uniqueArray(interventionArb, {
  selector: ({ id }) => id,
  maxLength: 8,
});

function shuffleKeys(value: unknown, rng: () => number): unknown {
  if (Array.isArray(value)) return value.map((item) => shuffleKeys(item, rng));
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object).sort(() => rng() - 0.5);
    return Object.fromEntries(
      keys.map((key) => [
        key,
        shuffleKeys((value as Record<string, unknown>)[key], rng),
      ]),
    );
  }
  return value;
}

describe("canonical (propiedades)", () => {
  it("canonicalJson no depende del orden de las claves", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.integer(), (value, salt) => {
        let s = salt;
        const rng = () => {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          return s / 0x7fffffff;
        };
        expect(canonicalJson(shuffleKeys(value, rng))).toBe(
          canonicalJson(value),
        );
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("canonicalizeFeatures no depende del orden de entrada y es idempotente", () => {
    fc.assert(
      fc.property(listArb, (features) => {
        const forward = canonicalizeFeatures(features);
        const reversed = canonicalizeFeatures([...features].reverse());
        expect(canonicalJson(reversed)).toBe(canonicalJson(forward));
        expect(canonicalizeFeatures(forward)).toEqual(forward);
        expect(sameSnapshot(features, [...features].reverse())).toBe(true);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  it("roundCoordinate es idempotente, no produce -0 y usa 6 decimales", () => {
    fc.assert(
      fc.property(fc.double({ min: -180, max: 180, noNaN: true }), (value) => {
        const once = roundCoordinate(value);
        expect(roundCoordinate(once)).toBe(once);
        expect(Object.is(once, -0)).toBe(false);
        expect(Math.abs(once - value)).toBeLessThanOrEqual(5e-7 + 1e-12);
      }),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("roundCoordinate convierte -0 y valores diminutos negativos en 0", () => {
    expect(Object.is(roundCoordinate(-0), 0)).toBe(true);
    expect(Object.is(roundCoordinate(-1e-9), 0)).toBe(true);
  });
});
