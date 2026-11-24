import { z } from "zod";
import { plainText } from "@/lib/schemas/community";
import { interventionListSchema } from "@/lib/schemas/intervention";

export const dossierStatuses = [
  "en_revision",
  "planeado",
  "en_ejecucion",
  "ejecutado",
  "descartado",
] as const;
export type DossierStatus = (typeof dossierStatuses)[number];

export const milestoneStatuses = [
  "pendiente",
  "cumplido",
  "cancelado",
] as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Evidence links are checked for shape only; the server never requests them. */
export const evidenceUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.hostname.includes(".") &&
        !/[\s<>"\\]/.test(value)
      );
    } catch {
      return false;
    }
  });

export const promoteDossierRequestSchema = z.strictObject({
  decisionNote: plainText(1, 1000),
  responsibleName: plainText(1, 100)
    .refine((value) => !value.includes("@"))
    .nullable()
    .optional(),
  responsibleAuthorized: z.boolean().optional(),
  targetDate: dateOnly.nullable().optional(),
});

export const responsibleRequestSchema = z.strictObject({
  responsibleName: plainText(1, 100)
    .refine((value) => !value.includes("@"))
    .nullable(),
  responsibleAuthorized: z.boolean().optional(),
});

export const milestoneRequestSchema = z.strictObject({
  title: plainText(1, 100),
  targetDate: dateOnly,
});

export const milestoneUpdateRequestSchema = z.strictObject({
  expectedStatus: z.enum(milestoneStatuses),
  title: plainText(1, 100),
  targetDate: dateOnly,
  status: z.enum(milestoneStatuses),
});

export const evidenceRequestSchema = z.strictObject({
  url: evidenceUrlSchema,
  title: plainText(1, 100),
  description: plainText(1, 1000),
  evidenceDate: dateOnly,
});

export const verificationRequestSchema = z.strictObject({
  verified: z.boolean(),
});

export const transitionRequestSchema = z.strictObject({
  expectedState: z.enum(dossierStatuses),
  newState: z.enum(dossierStatuses),
  note: plainText(1, 1000).nullable().optional(),
  observation: plainText(1, 1000).nullable().optional(),
  difference: plainText(1, 1000).nullable().optional(),
  evidenceIds: z.array(z.uuid()).max(50).default([]),
});

export const correctionRequestSchema = z.strictObject({
  expectedState: z.enum(dossierStatuses),
  note: plainText(1, 1000),
});

export const promoteResultSchema = z.object({
  dossierId: z.uuid(),
  created: z.boolean(),
});

export const eventResultSchema = z.object({
  eventId: z.uuid(),
  status: z.enum(dossierStatuses),
});

export const milestoneSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  title: z.string(),
  targetDate: dateOnly,
  status: z.enum(milestoneStatuses),
});

export const evidenceSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  url: z.string(),
  host: z.string(),
  title: z.string(),
  description: z.string(),
  evidenceDate: dateOnly,
  recordedByAlias: z.string(),
  verifiedByTeam: z.boolean(),
  verifiedByAlias: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});

export const eventSchema = z.object({
  seq: z.number().int(),
  kind: z.enum([
    "promoted",
    "status_change",
    "milestone_added",
    "milestone_updated",
    "evidence_added",
    "evidence_verified",
    "responsible_changed",
    "correction",
  ]),
  previousState: z.enum(dossierStatuses).nullable(),
  newState: z.enum(dossierStatuses).nullable(),
  note: z.string().nullable(),
  observation: z.string().nullable(),
  difference: z.string().nullable(),
  actorAlias: z.string(),
  createdAt: z.string(),
  milestoneId: z.uuid().nullable(),
  evidenceId: z.uuid().nullable(),
  evidenceIds: z.array(z.uuid()),
  correctsSeq: z.number().int().nullable(),
});

const costLineSchema = z.object({
  concept: z.string(),
  action: z.string(),
  code: z.string().nullable(),
  unit: z.string().nullable(),
  quantity: z.number(),
  formula: z.string().nullable(),
  status: z.enum(["priced", "unpriced"]),
  amountLowCents: z.number().nullable(),
  amountHighCents: z.number().nullable(),
  isAssumption: z.boolean(),
  assumptionOwner: z.string().nullable(),
  assumptionDate: z.string().nullable(),
});

export const dossierCostSchema = z.object({
  catalogVersionId: z.string().nullable(),
  currency: z.string().nullable(),
  label: z.enum(["fully_illustrative", "partially_illustrative", "sourced"]),
  partial: z.boolean(),
  unknownConcepts: z.array(z.string()),
  lines: z.array(costLineSchema),
  totalLowCents: z.number(),
  totalHighCents: z.number(),
  rounding: z.string().optional(),
  priceDate: z.string().optional(),
  source: z.string().optional(),
});

export const dossierSnapshotSchema = z.object({
  scenario: z.object({
    slug: z.string(),
    localDatetime: z.string(),
    timezone: z.string(),
    instantUtc: z.string(),
  }),
  inputs: z.object({
    baselineId: z.uuid(),
    scenarioSlug: z.string(),
    datasetChecksum: z.string(),
    generator: z.string(),
  }),
  analysis: z.object({
    engineVersion: z.string(),
    referenceSurface: z.enum(["pedestrian_area", "boundary_fallback"]),
    referenceM2: z.number(),
    shade: z.object({
      m2: z.number(),
      pct: z.number(),
      coverage: z.string(),
      coverageIncomplete: z.boolean(),
      assumptions: z.string(),
    }),
    occupancy: z.object({
      remainingM2: z.number(),
      crossingLengthM: z.number(),
    }),
  }),
  cost: dossierCostSchema,
});

export const publicDossierSchema = z.object({
  dossierId: z.uuid(),
  publicationId: z.uuid(),
  siteId: z.uuid(),
  siteSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: z.enum(dossierStatuses),
  decisionNote: z.string(),
  responsibleName: z.string().nullable(),
  targetDate: dateOnly.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publication: z.object({
    publicationId: z.uuid(),
    label: z.string(),
    summary: z.string(),
    authorAlias: z.string(),
    publishedAt: z.string(),
    baselineId: z.uuid(),
    scenario: z.literal("hypothetical"),
    features: interventionListSchema,
  }),
  snapshot: dossierSnapshotSchema,
  comparison: z.object({
    counts: z.object({
      equal: z.number(),
      added: z.number(),
      removed: z.number(),
      modified: z.number(),
    }),
    metricDeltas: z.object({
      shadeM2: z.number(),
      shadePct: z.number(),
      remainingM2: z.number(),
      crossingLengthM: z.number(),
    }),
    catalogCompatible: z.boolean(),
    costDelta: z
      .object({ totalLowCents: z.number(), totalHighCents: z.number() })
      .nullable(),
  }),
  supportCount: z.number().int().nonnegative(),
  milestones: z.array(milestoneSchema),
  evidence: z.array(evidenceSchema),
  events: z.array(eventSchema),
});

export type PublicDossier = z.infer<typeof publicDossierSchema>;

export const managedDossierSchema = z.object({
  dossierId: z.uuid(),
  publicationId: z.uuid(),
  siteId: z.uuid(),
  status: z.enum(dossierStatuses),
  moderationState: z.enum(["visible", "hidden"]),
  label: z.string(),
  decisionNote: z.string(),
  responsibleName: z.string().nullable(),
  targetDate: dateOnly.nullable(),
  updatedAt: z.string(),
  milestones: z.array(milestoneSchema),
  evidence: z.array(evidenceSchema),
  events: z.array(eventSchema),
});

export type ManagedDossier = z.infer<typeof managedDossierSchema>;

export const publicationDossierSchema = z.object({
  dossierId: z.uuid().nullable(),
  canManage: z.boolean(),
});

export const dossierListSchema = z.object({
  items: z.array(
    z.object({
      dossierId: z.uuid(),
      publicationId: z.uuid(),
      label: z.string(),
      status: z.enum(dossierStatuses),
      updatedAt: z.string(),
    }),
  ),
  nextCursor: z.object({ updatedAt: z.string(), id: z.string() }).nullable(),
});
