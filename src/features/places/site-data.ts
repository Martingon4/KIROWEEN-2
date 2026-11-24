import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  geoJsonFeatureCollectionSchema,
  localizedNameSchema,
  type GeoJsonFeatureCollection,
} from "@/lib/schemas/geojson";
import type { Locale } from "@/lib/i18n/locales";
import { z } from "zod";

const manifestSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: localizedNameSchema,
  sourceUrl: z.url().startsWith("https://"),
  sourceKind: z.string(),
  license: z.string(),
  attribution: z.string(),
  captureDate: z.iso.date(),
  retrievedAt: z.iso.datetime(),
  boundingBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  projection: z.object({
    input: z.literal("EPSG:4326"),
    metricCandidate: z.string(),
    metricStatus: z.string(),
  }),
  timezone: z.string(),
  currency: z.literal("MXN"),
  completeness: z.string(),
  checksum: z.object({
    algorithm: z.literal("sha256"),
    sourceCapture: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  layers: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      status: z.string(),
      coverage: z.string(),
    }),
  ),
});

export type PublicSite = {
  id: string;
  slug: string;
  name: Record<Locale, string>;
  locality: Record<Locale, string>;
  timezone: string;
  currency: "MXN";
  source: {
    label: string;
    url: string;
    license: string;
    attribution: string;
    captureDate: string;
    checksum: string;
  };
  completeness: "partial";
  bounds: readonly [number, number, number, number];
  baseline: GeoJsonFeatureCollection;
  scenario: GeoJsonFeatureCollection;
};

const dataRoot = join(process.cwd(), "data", "sites", "zocalo-puebla");

function readProjectJson(fileName: string): unknown {
  return JSON.parse(readFileSync(join(dataRoot, fileName), "utf8"));
}

const manifest = manifestSchema.parse(readProjectJson("manifest.json"));
const baseline = geoJsonFeatureCollectionSchema.parse(
  readProjectJson("baseline.geojson"),
);
const scenario = geoJsonFeatureCollectionSchema.parse(
  readProjectJson("scenario.geojson"),
);

export const pilotSite: PublicSite = {
  id: manifest.id,
  slug: manifest.slug,
  name: manifest.name,
  locality: {
    es: "Centro Histórico de Puebla, México",
    en: "Historic Centre of Puebla, Mexico",
  },
  timezone: manifest.timezone,
  currency: manifest.currency,
  source: {
    label: manifest.sourceKind,
    url: manifest.sourceUrl,
    license: manifest.license,
    attribution: manifest.attribution,
    captureDate: manifest.captureDate,
    checksum: manifest.checksum.sourceCapture,
  },
  completeness: "partial",
  bounds: manifest.boundingBox,
  baseline,
  scenario,
};
