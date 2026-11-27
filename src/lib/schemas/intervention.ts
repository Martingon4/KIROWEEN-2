import { z } from "zod";
import { positionSchema } from "@/lib/schemas/geojson";
import { revisionObjectKinds } from "./terrain-objects";

/** Limits shared with `public.save_revision` in the database. */
export const MAX_FEATURES_PER_REVISION = 200;
export const MAX_VERTICES_PER_FEATURE = 100;
export const MAX_REVISION_MESSAGE_LENGTH = 100;

/** `parking_conversion` stays unavailable until a verifiable inventory exists. */
export const editableKinds = [
  "shade_tree",
  "shade_canopy",
  "temporary_market",
  "proposed_crossing",
  "urban_object",
] as const;

export type EditableKind = (typeof editableKinds)[number];

const label = z.string().trim().min(1).max(80);

export const pointGeometrySchema = z.object({
  type: z.literal("Point"),
  coordinates: positionSchema,
});

export const lineGeometrySchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(positionSchema).min(2).max(MAX_VERTICES_PER_FEATURE),
});

export const polygonRingSchema = z
  .array(positionSchema)
  .min(4)
  .max(MAX_VERTICES_PER_FEATURE)
  .superRefine((ring, context) => {
    const first = ring[0];
    const last = ring.at(-1);
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
      context.addIssue({
        code: "custom",
        message: "Polygon rings must be closed",
      });
    }
  });

export const polygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(polygonRingSchema).length(1),
});

export const interventionSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.uuid(),
    kind: z.literal("shade_tree"),
    properties: z.strictObject({
      label,
      canopyDiameterM: z.number().min(1).max(30),
      heightM: z.number().min(2).max(30),
    }),
    geometry: pointGeometrySchema,
  }),
  z.object({
    id: z.uuid(),
    kind: z.literal("shade_canopy"),
    properties: z.strictObject({
      label,
      heightM: z.number().min(2.5).max(8),
    }),
    geometry: polygonGeometrySchema,
  }),
  z.object({
    id: z.uuid(),
    kind: z.literal("temporary_market"),
    properties: z.strictObject({
      label,
      stallCount: z.number().int().min(1).max(200),
      moduleM2: z.number().min(1).max(20),
      timeSlot: z.string().trim().min(1).max(40),
    }),
    geometry: polygonGeometrySchema,
  }),
  z.object({
    id: z.uuid(),
    kind: z.literal("proposed_crossing"),
    properties: z.strictObject({
      label,
      widthM: z.number().min(2).max(10),
    }),
    geometry: lineGeometrySchema,
  }),
  z.object({
    id: z.uuid(),
    kind: z.literal("urban_object"),
    properties: z
      .strictObject({
        label,
        objectType: z.enum(revisionObjectKinds),
        heightM: z.number().min(0.3).max(8),
      })
      .refine(
        ({ objectType, heightM }) =>
          (objectType !== "bench" && objectType !== "planter") || heightM <= 3,
        { path: ["heightM"] },
      ),
    geometry: polygonGeometrySchema,
  }),
]);

export type Intervention = z.infer<typeof interventionSchema>;
export type InterventionGeometry = Intervention["geometry"];

export const interventionListSchema = z
  .array(interventionSchema)
  .max(MAX_FEATURES_PER_REVISION)
  .superRefine((features, context) => {
    const seen = new Set<string>();
    features.forEach((feature, index) => {
      const id = feature.id.toLowerCase();
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate feature id",
          path: [index, "id"],
        });
      }
      seen.add(id);
    });
  });

export const saveRevisionRequestSchema = z.object({
  expectedHeadId: z.uuid(),
  message: z.string().trim().min(1).max(MAX_REVISION_MESSAGE_LENGTH),
  features: interventionListSchema,
});

export const saveRevisionResponseSchema = z.object({
  data: z.object({
    branchId: z.uuid(),
    revisionId: z.uuid(),
    parentRevisionId: z.uuid().nullable(),
    featureCount: z.number().int().min(0),
  }),
});

export const branchHeadSchema = z.object({
  branchId: z.uuid(),
  title: z.string(),
  siteId: z.uuid(),
  baselineId: z.uuid(),
  revisionId: z.uuid(),
  parentRevisionId: z.uuid().nullable(),
  message: z.string(),
  createdAt: z.string(),
  /** Provenance of a fork: the publication it started from, and whether it is still visible. */
  sourcePublicationId: z.uuid().nullable(),
  sourceVisible: z.boolean().nullable(),
  /** Merge provenance of the head revision, when it is a merge. */
  mergeSourcePublicationId: z.uuid().nullable().default(null),
  mergeSourceVisible: z.boolean().nullable().default(null),
  features: interventionListSchema,
});

export type BranchHead = z.infer<typeof branchHeadSchema>;
