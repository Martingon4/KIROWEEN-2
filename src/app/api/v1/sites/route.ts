import { pilotSite } from "@/features/places/site-data";
import { toPublicSiteSummary } from "@/features/places/public-projection";
import { publicSiteListEnvelopeSchema } from "@/lib/schemas/site";

export async function GET() {
  const body = publicSiteListEnvelopeSchema.parse({
    data: [toPublicSiteSummary(pilotSite)],
  });

  return Response.json(body, {
    headers: {
      "Cache-Control":
        "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
