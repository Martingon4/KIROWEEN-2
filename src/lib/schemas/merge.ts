import { z } from "zod";
import {
  interventionSchema,
  lineGeometrySchema,
  pointGeometrySchema,
  polygonGeometrySchema,
} from "@/lib/schemas/intervention";

const geometrySchema = z.union([
  pointGeometrySchema,
  lineGeometrySchema,
  polygonGeometrySchema,
]);

const sideSchema = z
  .object({
    kind: z.string(),
    properties: z.record(z.string(), z.unknown()),
    geometry: geometrySchema,
  })
  .nullable();

/** One resolution per conflict. Redraws carry a complete, revalidated feature. */
export const mergeResolutionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    conflictId: z.string().min(1).max(120),
    action: z.literal("keep_target"),
  }),
  z.strictObject({
    conflictId: z.string().min(1).max(120),
    action: z.literal("keep_source"),
  }),
  z.strictObject({
    conflictId: z.string().min(1).max(120),
    action: z.literal("remove"),
    featureId: z.uuid().optional(),
  }),
  z.strictObject({
    conflictId: z.string().min(1).max(120),
    action: z.literal("redraw"),
    feature: interventionSchema,
  }),
]);

export type MergeResolution = z.infer<typeof mergeResolutionSchema>;

export const mergePreviewRequestSchema = z.strictObject({
  sourcePublicationId: z.uuid(),
  resolutions: z.array(mergeResolutionSchema).max(400).default([]),
});

export const mergeCommitRequestSchema = z.strictObject({
  sourcePublicationId: z.uuid(),
  expectedHeadId: z.uuid(),
  message: z.string().trim().min(1).max(100),
  resolutions: z.array(mergeResolutionSchema).max(400),
});

const elementConflictSchema = z.object({
  id: z.string(),
  type: z.enum(["edit_edit", "edit_delete"]),
  featureId: z.uuid(),
  target: sideSchema,
  source: sideSchema,
  ancestor: sideSchema,
});

const spatialConflictSchema = z.object({
  id: z.string(),
  type: z.literal("exclusive_overlap"),
  featureIds: z.tuple([z.uuid(), z.uuid()]),
  kinds: z.tuple([z.string(), z.string()]),
  timeSlot: z.string().nullable(),
  intersectionM2: z.number(),
  thresholdM2: z.number(),
  blocking: z.boolean(),
});

export const mergeConflictSchema = z.union([
  elementConflictSchema,
  spatialConflictSchema,
]);

export type MergeConflict = z.infer<typeof mergeConflictSchema>;
export type ElementConflict = z.infer<typeof elementConflictSchema>;
export type SpatialConflict = z.infer<typeof spatialConflictSchema>;

export const mergePreviewSchema = z.object({
  branchId: z.uuid(),
  headRevisionId: z.uuid(),
  source: z.object({ publicationId: z.uuid(), label: z.string() }),
  ancestor: z.object({
    kind: z.enum([
      "baseline",
      "own_revision",
      "publication",
      "private_revision",
    ]),
    revisionId: z.uuid().nullable(),
    publicationId: z.uuid().nullable(),
  }),
  engineVersion: z.string(),
  conflicts: z.array(mergeConflictSchema),
  unresolved: z.array(z.string()),
  invalidResolutions: z.array(
    z.object({ conflictId: z.string().nullable(), reason: z.string() }),
  ),
  warnings: z.array(z.record(z.string(), z.unknown())),
  operations: z.array(
    z.object({
      featureId: z.uuid(),
      decision: z.string(),
      present: z.boolean(),
    }),
  ),
  featureCount: z.number(),
  tooManyFeatures: z.boolean(),
  features: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      properties: z.record(z.string(), z.unknown()),
      geometry: geometrySchema,
      provenance: z.enum(["ancestor", "target", "source", "both", "resolved"]),
    }),
  ),
});

export type MergePreview = z.infer<typeof mergePreviewSchema>;

export const mergeCommitResponseSchema = z.object({
  data: z.object({
    branchId: z.uuid(),
    revisionId: z.uuid(),
    parentRevisionId: z.uuid(),
    sourcePublicationId: z.uuid(),
    ancestorKind: z.string(),
    featureCount: z.number(),
    conflictCount: z.number(),
  }),
});
