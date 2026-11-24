import {
  communityErrorResponse,
  isUuid,
  noStore,
  notFoundResponse,
  requireSession,
  unexpectedResponse,
} from "@/lib/http/community-route";
import { newRequestId } from "@/lib/http/mutation";
import { moderationTargetSchema } from "@/lib/schemas/community";

type RouteProps = { params: Promise<{ kind: string; targetId: string }> };

/** A moderator's view of a target in any state, with its audit history. */
export async function GET(_request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { kind, targetId } = await params;

  const session = await requireSession(requestId);
  if (!session.ok) return session.response;
  if ((kind !== "publication" && kind !== "comment") || !isUuid(targetId)) {
    return notFoundResponse(requestId, "target_not_found");
  }

  const { data, error } = await session.supabase.rpc("get_moderation_target", {
    p_kind: kind,
    p_id: targetId,
  });
  if (error)
    return communityErrorResponse(error, requestId, "get_moderation_target");

  const parsed = moderationTargetSchema.safeParse(data);
  if (!parsed.success)
    return unexpectedResponse(requestId, "get_moderation_target");
  return Response.json({ data: parsed.data }, { headers: noStore });
}
