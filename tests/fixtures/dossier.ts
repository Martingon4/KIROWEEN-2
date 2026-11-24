import type { PublicDossier } from "@/lib/schemas/dossier";

/**
 * Hand-built PublicDossier for the pilot (Zócalo de Puebla). Hypothetical proposal:
 * nothing here describes an existing work. Coordinates stay inside
 * [-98.1988758, 19.0430895, -98.1973016, 19.0442743].
 */
export const PILOT_BOUNDS = [
  -98.1988758, 19.0430895, -98.1973016, 19.0442743,
] as const;

export const FIXTURE_IDS = {
  dossier: "11111111-1111-4111-8111-111111111111",
  publication: "22222222-2222-4222-8222-222222222222",
  site: "33333333-3333-4333-8333-333333333333",
  baseline: "44444444-4444-4444-8444-444444444444",
  canopy: "55555555-5555-4555-8555-555555555555",
  market: "66666666-6666-4666-8666-666666666666",
  milestoneA: "77777777-7777-4777-8777-777777777777",
  milestoneB: "88888888-8888-4888-8888-888888888888",
  evidence: "99999999-9999-4999-8999-999999999999",
} as const;

export function buildDossier(): PublicDossier {
  return {
    dossierId: FIXTURE_IDS.dossier,
    publicationId: FIXTURE_IDS.publication,
    siteId: FIXTURE_IDS.site,
    siteSlug: "zocalo-puebla",
    status: "planeado",
    decisionNote: "El colectivo acordó probar la sombra en verano.",
    responsibleName: "Colectivo Sombra Puebla",
    targetDate: "2027-03-15",
    createdAt: "2026-05-01T15:00:00.000Z",
    updatedAt: "2026-05-10T18:30:00.000Z",
    publication: {
      publicationId: FIXTURE_IDS.publication,
      label: "Sombra y mercado temporal",
      summary: "Una cubierta de sombra y un mercado temporal de fin de semana.",
      authorAlias: "ana_puebla",
      publishedAt: "2026-04-20T16:00:00.000Z",
      baselineId: FIXTURE_IDS.baseline,
      scenario: "hypothetical",
      features: [
        {
          id: FIXTURE_IDS.canopy,
          kind: "shade_canopy",
          properties: { label: "Cubierta norte", heightM: 4 },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-98.1985, 19.0436],
                [-98.1983, 19.0436],
                [-98.1983, 19.0438],
                [-98.1985, 19.0438],
                [-98.1985, 19.0436],
              ],
            ],
          },
        },
        {
          id: FIXTURE_IDS.market,
          kind: "temporary_market",
          properties: {
            label: "Mercado sábado",
            stallCount: 12,
            moduleM2: 6,
            timeSlot: "08:00-14:00",
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-98.1980, 19.0434],
                [-98.1977, 19.0434],
                [-98.1977, 19.0437],
                [-98.1980, 19.0437],
                [-98.1980, 19.0434],
              ],
            ],
          },
        },
      ],
    },
    snapshot: {
      scenario: {
        slug: "summer-solstice-noon",
        localDatetime: "2026-06-21T12:00",
        timezone: "America/Mexico_City",
        instantUtc: "2026-06-21T18:00:00.000Z",
      },
      inputs: {
        baselineId: FIXTURE_IDS.baseline,
        scenarioSlug: "summer-solstice-noon",
        datasetChecksum: "sha256:abc123",
        generator: "scripts/generate-solar-scenarios.mjs",
      },
      analysis: {
        engineVersion: "analysis-v1",
        referenceSurface: "pedestrian_area",
        referenceM2: 9000,
        shade: {
          m2: 450.5,
          pct: 5,
          coverage: "partial",
          coverageIncomplete: true,
          assumptions: "Sin árboles ni edificios medidos.",
        },
        occupancy: { remainingM2: 8500, crossingLengthM: 0 },
      },
      cost: {
        catalogVersionId: "catalog-zocalo-v1",
        currency: "MXN",
        label: "fully_illustrative",
        partial: true,
        unknownConcepts: ["temporary_market"],
        lines: [
          {
            concept: "shade_canopy",
            action: "add",
            code: "CAN-01",
            unit: "m2",
            quantity: 120.5,
            formula: "area * 1",
            status: "priced",
            amountLowCents: 12345600,
            amountHighCents: 18000050,
            isAssumption: true,
            assumptionOwner: "equipo_evaluacion",
            assumptionDate: "2026-04-01",
          },
          {
            concept: "temporary_market",
            action: "add",
            code: null,
            unit: null,
            quantity: 12,
            formula: null,
            status: "unpriced",
            amountLowCents: null,
            amountHighCents: null,
            isAssumption: false,
            assumptionOwner: null,
            assumptionDate: null,
          },
        ],
        totalLowCents: 12345600,
        totalHighCents: 18000050,
        rounding: "Redondeo half-up a centavos por línea.",
        priceDate: "2026-04-01",
        source: "Catálogo de evaluación Zócalo v1",
      },
    },
    comparison: {
      counts: { equal: 0, added: 2, removed: 0, modified: 0 },
      metricDeltas: {
        shadeM2: 450.5,
        shadePct: 5,
        remainingM2: -500,
        crossingLengthM: 0,
      },
      catalogCompatible: true,
      costDelta: { totalLowCents: 12345600, totalHighCents: 18000050 },
    },
    supportCount: 7,
    milestones: [
      {
        id: FIXTURE_IDS.milestoneA,
        position: 1,
        title: "Consulta vecinal",
        targetDate: "2026-09-01",
        status: "cumplido",
      },
      {
        id: FIXTURE_IDS.milestoneB,
        position: 2,
        title: "Prueba piloto",
        targetDate: "2027-01-10",
        status: "pendiente",
      },
    ],
    evidence: [
      {
        id: FIXTURE_IDS.evidence,
        position: 1,
        url: "https://colectivo.example.org/acta?b=c#d",
        host: "colectivo.example.org",
        title: "Acta de asamblea",
        description: "Acta firmada de la asamblea del 1 de mayo.",
        evidenceDate: "2026-05-01",
        recordedByAlias: "ana_puebla",
        verifiedByTeam: true,
        verifiedByAlias: "coord_zocalo",
        verifiedAt: "2026-05-02T10:00:00.000Z",
      },
    ],
    events: [
      {
        seq: 1,
        kind: "promoted",
        previousState: null,
        newState: "en_revision",
        note: null,
        observation: null,
        difference: null,
        actorAlias: "coord_zocalo",
        createdAt: "2026-05-01T15:00:00.000Z",
        milestoneId: null,
        evidenceId: null,
        evidenceIds: [],
        correctsSeq: null,
      },
      {
        seq: 2,
        kind: "status_change",
        previousState: "en_revision",
        newState: "planeado",
        note: "Hay responsable e hito.",
        observation: null,
        difference: null,
        actorAlias: "coord_zocalo",
        createdAt: "2026-05-05T15:00:00.000Z",
        milestoneId: null,
        evidenceId: null,
        evidenceIds: [FIXTURE_IDS.evidence],
        correctsSeq: null,
      },
      {
        seq: 3,
        kind: "correction",
        previousState: null,
        newState: null,
        note: "Se corrige la fecha del acta.",
        observation: null,
        difference: null,
        actorAlias: "coord_zocalo",
        createdAt: "2026-05-10T18:30:00.000Z",
        milestoneId: null,
        evidenceId: null,
        evidenceIds: [],
        correctsSeq: 2,
      },
    ],
  };
}

/** Boundary of the pilot site as a drawable polygon for the preview SVG. */
export const PILOT_BOUNDARY = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-98.1988758, 19.0430895],
      [-98.1973016, 19.0430895],
      [-98.1973016, 19.0442743],
      [-98.1988758, 19.0442743],
      [-98.1988758, 19.0430895],
    ],
  ] as const,
};
