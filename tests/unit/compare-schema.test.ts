import { describe, expect, it } from "vitest";
import {
  compareResultSchema,
  SNAPSHOT_REF_PATTERN,
} from "@/lib/schemas/compare";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const FEATURE_ID = "44444444-4444-4444-8444-444444444444";

const analysis = (shadeM2: number) => ({
  referenceSurface: "pedestrian_area" as const,
  referenceM2: 5000,
  shade: {
    m2: shadeM2,
    pct: shadeM2 / 50,
    elementCount: 1,
    coverage: "partial",
    coverageIncomplete: true,
    assumptions: "Modelo de demostración",
  },
  occupancy: {
    slots: [
      {
        timeSlot: "weekend_morning",
        areaM2: 100,
        stallCount: 10,
        fitByArea: 12,
        fitByAreaPreliminary: true,
      },
    ],
    remainingM2: 4900,
    crossingLengthM: 0,
  },
});

const cost = (low: number, high: number) => ({
  currency: "MXN",
  label: "fully_illustrative" as const,
  partial: false,
  unknownConcepts: [] as string[],
  lines: [
    {
      concept: "shade_canopy",
      action: "add",
      code: "canopy",
      unit: "m2",
      quantity: 10,
      formula: "10 * x",
      status: "priced" as const,
      amountLowCents: low,
      amountHighCents: high,
      isAssumption: true,
    },
  ],
  totalLowCents: low,
  totalHighCents: high,
  priceDate: "2025-01-01",
});

const polygon = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-98.198, 19.043],
      [-98.1979, 19.043],
      [-98.1979, 19.0431],
      [-98.198, 19.043],
    ],
  ],
};

function payload() {
  return {
    siteId: ID,
    baselineId: ID2,
    scenario: {
      slug: "summer-noon",
      localDatetime: "2025-06-21T12:00",
      timezone: "America/Mexico_City",
    },
    engineVersion: "solar-1",
    left: {
      ref: `baseline:${ID2}`,
      refKind: "baseline" as const,
      label: "Línea base",
      analysis: analysis(0),
      cost: cost(0, 0),
    },
    right: {
      ref: `publication:${ID}`,
      refKind: "publication" as const,
      label: "Propuesta",
      analysis: analysis(120),
      cost: cost(1000, 2000),
    },
    counts: { equal: 0, added: 1, removed: 0, modified: 0 },
    features: [
      {
        id: FEATURE_ID,
        class: "added" as const,
        kindChanged: false,
        propertiesChanged: false,
        geometryChanged: null,
        changedKeys: [] as string[],
        left: null,
        right: {
          kind: "shade_canopy",
          properties: { label: "Cubierta de sombra", heightM: 4 },
          geometry: polygon,
        },
      },
    ],
    metricDeltas: {
      shadeM2: 120,
      shadePct: 2.4,
      remainingM2: 0,
      crossingLengthM: 0,
    },
    catalogCompatible: true,
    costDelta: { totalLowCents: 1000, totalHighCents: 2000 },
  };
}

describe("compareResultSchema", () => {
  it("acepta una carga representativa", () => {
    expect(compareResultSchema.safeParse(payload()).success).toBe(true);
  });

  it("acepta costDelta nulo y cambios vacíos", () => {
    const value = { ...payload(), costDelta: null, features: [] };
    expect(compareResultSchema.safeParse(value).success).toBe(true);
  });

  it("rechaza la clase 'equal' en features", () => {
    const value = payload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (value.features[0] as any).class = "equal";
    expect(compareResultSchema.safeParse(value).success).toBe(false);
  });

  it("rechaza conteos ausentes", () => {
    const value = payload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (value.counts as any).removed;
    expect(compareResultSchema.safeParse(value).success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noCounts: any = payload();
    delete noCounts.counts;
    expect(compareResultSchema.safeParse(noCounts).success).toBe(false);
  });

  it("rechaza geometrías inválidas", () => {
    const unknownType = payload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (unknownType.features[0].right as any).geometry = {
      type: "MultiPoint",
      coordinates: [[0, 0]],
    };
    expect(compareResultSchema.safeParse(unknownType).success).toBe(false);

    const openRing = payload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (openRing.features[0].right as any).geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [2, 2],
        ],
      ],
    };
    expect(compareResultSchema.safeParse(openRing).success).toBe(false);

    const outOfRange = payload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (outOfRange.features[0].right as any).geometry = {
      type: "Point",
      coordinates: [-98, 120],
    };
    expect(compareResultSchema.safeParse(outOfRange).success).toBe(false);
  });

  it("rechaza ids que no son uuid y refKind desconocido", () => {
    expect(
      compareResultSchema.safeParse({ ...payload(), siteId: "no-uuid" })
        .success,
    ).toBe(false);
    const value = payload();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (value.left as any).refKind = "branch";
    expect(compareResultSchema.safeParse(value).success).toBe(false);
  });
});

describe("SNAPSHOT_REF_PATTERN", () => {
  const upper = ID.toUpperCase();
  const accepted = [
    `publication:${ID}`,
    `baseline:${ID}`,
    `revision:${ID}`,
    `publication:${upper}`,
    `revision:aBcDeF01-2345-6789-abcd-ef0123456789`,
  ];
  const rejected: [string, string][] = [
    ["vacío", ""],
    ["sin prefijo", ID],
    ["prefijo desconocido", `branch:${ID}`],
    ["prefijo en mayúsculas", `Publication:${ID}`],
    ["sin dos puntos", `publication${ID}`],
    ["uuid truncado", `publication:${ID.slice(0, 35)}`],
    ["uuid con carácter no hex", `publication:${ID.replace("1", "g")}`],
    ["basura al final", `publication:${ID}x`],
    ["salto de línea final", `publication:${ID}\n`],
    ["basura al inicio", ` publication:${ID}`],
    ["prefijo previo", `xpublication:${ID}`],
    ["dos referencias", `publication:${ID},baseline:${ID2}`],
    ["consulta añadida", `publication:${ID}?a=1`],
  ];

  it.each(accepted)("acepta %s", (value) => {
    expect(SNAPSHOT_REF_PATTERN.test(value)).toBe(true);
  });

  it.each(rejected)("rechaza %s", (_name, value) => {
    expect(SNAPSHOT_REF_PATTERN.test(value)).toBe(false);
  });
});
