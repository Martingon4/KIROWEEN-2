import { z } from "zod";
import {
  lineGeometrySchema,
  pointGeometrySchema,
  polygonGeometrySchema,
} from "@/lib/schemas/intervention";

export const SNAPSHOT_REF_PATTERN =
  /^(publication|baseline|revision):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const geometrySchema = z.union([
  pointGeometrySchema,
  lineGeometrySchema,
  polygonGeometrySchema,
]);

/** One side of a changed feature: kind, properties, and geometry, without the id. */
const compareSideFeatureSchema = z.object({
  kind: z.string(),
  properties: z.record(z.string(), z.unknown()),
  geometry: geometrySchema,
});

const analysisSchema = z.object({
  referenceSurface: z.enum(["pedestrian_area", "boundary_fallback"]),
  referenceM2: z.number(),
  shade: z.object({
    m2: z.number(),
    pct: z.number(),
    elementCount: z.number(),
    coverage: z.string(),
    coverageIncomplete: z.boolean(),
    assumptions: z.string(),
  }),
  occupancy: z.object({
    slots: z.array(
      z.object({
        timeSlot: z.string(),
        areaM2: z.number(),
        stallCount: z.number(),
        fitByArea: z.number(),
        fitByAreaPreliminary: z.boolean(),
      }),
    ),
    remainingM2: z.number(),
    crossingLengthM: z.number(),
  }),
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
});

const costSchema = z.object({
  currency: z.string().nullable(),
  label: z.enum(["fully_illustrative", "partially_illustrative", "sourced"]),
  partial: z.boolean(),
  unknownConcepts: z.array(z.string()),
  lines: z.array(costLineSchema),
  totalLowCents: z.number(),
  totalHighCents: z.number(),
  priceDate: z.string().optional(),
});

const sideSchema = z.object({
  ref: z.string(),
  refKind: z.enum(["publication", "baseline", "revision"]),
  label: z.string(),
  analysis: analysisSchema,
  cost: costSchema,
});

export const compareResultSchema = z.object({
  siteId: z.uuid(),
  baselineId: z.uuid(),
  scenario: z.object({
    slug: z.string(),
    localDatetime: z.string(),
    timezone: z.string(),
  }),
  engineVersion: z.string(),
  left: sideSchema,
  right: sideSchema,
  counts: z.object({
    equal: z.number(),
    added: z.number(),
    removed: z.number(),
    modified: z.number(),
  }),
  features: z.array(
    z.object({
      id: z.uuid(),
      class: z.enum(["added", "removed", "modified"]),
      kindChanged: z.boolean(),
      propertiesChanged: z.boolean(),
      geometryChanged: z.boolean().nullable(),
      changedKeys: z.array(z.string()),
      left: compareSideFeatureSchema.nullable(),
      right: compareSideFeatureSchema.nullable(),
    }),
  ),
  metricDeltas: z.object({
    shadeM2: z.number(),
    shadePct: z.number(),
    remainingM2: z.number(),
    crossingLengthM: z.number(),
  }),
  catalogCompatible: z.boolean(),
  costDelta: z
    .object({
      totalLowCents: z.number(),
      totalHighCents: z.number(),
    })
    .nullable(),
});

export type CompareResult = z.infer<typeof compareResultSchema>;
export type CompareChange = CompareResult["features"][number];

export const comparePageResultSchema = compareResultSchema.extend({
  spatialOverlaps: z.object({
    count: z.number().int().nonnegative(),
    examples: z.array(
      z.object({
        leftLabel: z.string(),
        rightLabel: z.string(),
        intersectionM2: z.number().nonnegative().nullable(),
      }),
    ).max(3),
  }),
  scenario: compareResultSchema.shape.scenario.extend({
    azimuthRad: z.number(),
    elevationRad: z.number().positive(),
  }),
});

export type ComparePageResult = z.infer<typeof comparePageResultSchema>;
