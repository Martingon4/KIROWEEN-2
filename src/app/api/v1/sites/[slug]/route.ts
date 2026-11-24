import { pilotSite } from "@/features/places/site-data";
import { toPublicSiteDetail } from "@/features/places/public-projection";
import {
  apiErrorEnvelopeSchema,
  publicSiteDetailEnvelopeSchema,
} from "@/lib/schemas/site";

type RouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  const { slug } = await params;

  if (slug !== pilotSite.slug) {
    const error = apiErrorEnvelopeSchema.parse({
      code: "site_not_found",
      message: "The requested public site was not found.",
      requestId: crypto.randomUUID(),
    });

    return Response.json(error, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const body = publicSiteDetailEnvelopeSchema.parse({
    data: toPublicSiteDetail(pilotSite),
  });

  return Response.json(body, {
    headers: {
      "Cache-Control":
        "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
