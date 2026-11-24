import {
  communityErrorResponse,
  isUuid,
  noStore,
  notFoundResponse,
  requireSession,
  unexpectedResponse,
} from "@/lib/http/community-route";
import { errorResponse, newRequestId } from "@/lib/http/mutation";
import {
  decodeCursor,
  encodeCursor,
  openReportsPageSchema,
} from "@/lib/schemas/community";

/** Open reports of one site, for that site's moderators only. */
export async function GET(request: Request) {
  const requestId = newRequestId();
  const session = await requireSession(requestId);
  if (!session.ok) return session.response;

  const url = new URL(request.url);
  const site = url.searchParams.get("site") ?? "";
  if (!isUuid(site)) return notFoundResponse(requestId, "site_not_found");

  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (cursor === "invalid") {
    return errorResponse(
      400,
      "invalid_cursor",
      "The cursor is not valid.",
      requestId,
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return errorResponse(
      400,
      "invalid_limit",
      "The limit must be between 1 and 50.",
      requestId,
    );
  }

  const { data, error } = await session.supabase.rpc("list_open_reports", {
    p_site_id: site,
    p_after_created_at: cursor?.createdAt ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error)
    return communityErrorResponse(error, requestId, "list_open_reports");

  const parsed = openReportsPageSchema.safeParse(data);
  if (!parsed.success)
    return unexpectedResponse(requestId, "list_open_reports");

  return Response.json(
    {
      data: {
        items: parsed.data.items,
        nextCursor: parsed.data.nextCursor
          ? encodeCursor(parsed.data.nextCursor)
          : null,
      },
    },
    { headers: noStore },
  );
}
