import { z } from "zod";

export const positionSchema = z
  .tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ])
  .readonly();

const pointGeometrySchema = z.object({
  type: z.literal("Point"),
  coordinates: positionSchema,
});

const polygonGeometrySchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(positionSchema).min(4)).length(1),
  })
  .superRefine(({ coordinates }, context) => {
    const ring = coordinates[0];
    const first = ring[0];
    const last = ring.at(-1);

    if (first[0] !== last?.[0] || first[1] !== last?.[1]) {
      context.addIssue({
        code: "custom",
        message: "Polygon rings must be closed",
        path: ["coordinates", 0],
      });
    }
  });

export const supportedGeometrySchema = z.discriminatedUnion("type", [
  pointGeometrySchema,
  polygonGeometrySchema,
]);

export const localizedNameSchema = z.object({
  es: z.string().min(1),
  en: z.string().min(1),
});

export const geoJsonFeatureSchema = z.object({
  type: z.literal("Feature"),
  id: z.string().min(1),
  properties: z
    .object({
      kind: z.string().min(1),
      status: z.enum(["reference", "hypothetical"]),
      name: localizedNameSchema,
    })
    .loose(),
  geometry: supportedGeometrySchema,
});

export const geoJsonFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  features: z.array(geoJsonFeatureSchema),
});

export type SupportedGeometry = z.infer<typeof supportedGeometrySchema>;
export type GeoJsonFeature = z.infer<typeof geoJsonFeatureSchema>;
export type GeoJsonFeatureCollection = z.infer<
  typeof geoJsonFeatureCollectionSchema
>;
