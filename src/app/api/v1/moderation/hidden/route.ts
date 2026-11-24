import {
  communityErrorResponse,
  isUuid,
  noStore,
  notFoundResponse,
  requireSession,
  unexpectedResponse,
} from "@/lib/http/community-route";
import { newRequestId } from "@/lib/http/mutation";
import { hiddenContentSchema } from "@/lib/schemas/community";

/** Currently hidden publications and comments of one site, for its moderators only. */
export async function GET(request: Request) {
  const requestId = newRequestId();
  const session = await requireSession(requestId);
  if (!session.ok) return session.response;

  const site = new URL(request.url).searchParams.get("site") ?? "";
  if (!isUuid(site)) return notFoundResponse(requestId, "site_not_found");

  const { data, error } = await session.supabase.rpc("list_hidden_content", {
    p_site_id: site,
    p_limit: 50,
  });
  if (error)
    return communityErrorResponse(error, requestId, "list_hidden_content");

  const parsed = hiddenContentSchema.safeParse(data);
  if (!parsed.success)
    return unexpectedResponse(requestId, "list_hidden_content");
  return Response.json({ data: parsed.data }, { headers: noStore });
}
