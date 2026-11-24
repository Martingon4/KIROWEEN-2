import { getPublicPublication } from "@/features/versions/public-publication";
import { errorResponse, newRequestId } from "@/lib/http/mutation";

type RouteProps = {
  params: Promise<{ publicationId: string }>;
};

/** Public, moderation-sensitive read: never cached by shared caches. */
export async function GET(_request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { publicationId } = await params;
  const result = await getPublicPublication(publicationId);

  if (result.status === "not_found") {
    return errorResponse(
      404,
      "publication_not_found",
      "The publication was not found.",
      requestId,
    );
  }
  if (result.status === "error") {
    console.error("get_public_publication_failed", { requestId });
    return errorResponse(
      500,
      "internal_error",
      "The publication could not be read.",
      requestId,
    );
  }

  return Response.json(
    { data: result.publication },
    { headers: { "Cache-Control": "no-store" } },
  );
}
