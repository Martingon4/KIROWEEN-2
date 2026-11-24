import type { PublicSite } from "@/features/places/site-data";
import {
  publicSiteDetailSchema,
  publicSiteSummarySchema,
} from "@/lib/schemas/site";

export function toPublicSiteSummary(site: PublicSite) {
  return publicSiteSummarySchema.parse({
    id: site.id,
    slug: site.slug,
    name: site.name,
    locality: site.locality,
    completeness: site.completeness,
    source: {
      label: site.source.label,
      url: site.source.url,
      license: site.source.license,
      attribution: site.source.attribution,
      captureDate: site.source.captureDate,
    },
  });
}

export function toPublicSiteDetail(site: PublicSite) {
  return publicSiteDetailSchema.parse({
    ...toPublicSiteSummary(site),
    timezone: site.timezone,
    currency: site.currency,
    bounds: site.bounds,
    baseline: site.baseline,
    scenario: site.scenario,
  });
}
