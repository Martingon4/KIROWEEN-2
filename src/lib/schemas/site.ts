import { z } from "zod";
import {
  geoJsonFeatureCollectionSchema,
  localizedNameSchema,
} from "@/lib/schemas/geojson";

export const publicSiteSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: localizedNameSchema,
  locality: localizedNameSchema,
  completeness: z.literal("partial"),
  source: z.object({
    label: z.string(),
    url: z.url().startsWith("https://"),
    license: z.string(),
    attribution: z.string(),
    captureDate: z.iso.date(),
  }),
});

export const publicSiteDetailSchema = publicSiteSummarySchema.extend({
  timezone: z.string(),
  currency: z.literal("MXN"),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  baseline: geoJsonFeatureCollectionSchema,
  scenario: geoJsonFeatureCollectionSchema,
});

export const publicSiteListEnvelopeSchema = z.object({
  data: z.array(publicSiteSummarySchema),
});

export const publicSiteDetailEnvelopeSchema = z.object({
  data: publicSiteDetailSchema,
});

export const apiErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().uuid(),
  details: z.record(z.string(), z.unknown()).optional(),
});
