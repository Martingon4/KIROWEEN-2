import {
  communityErrorResponse,
  isUuid,
  noStore,
  notFoundResponse,
  requireSession,
} from "@/lib/http/community-route";
import { newRequestId, readMutationOrigin } from "@/lib/http/mutation";

type RouteProps = { params: Promise<{ commentId: string }> };

/** Retracts the caller's own comment. Naturally idempotent. */
export async function DELETE(request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { commentId } = await params;

  const blocked = readMutationOrigin(request, requestId);
  if (blocked) return blocked;
  const session = await requireSession(requestId);
  if (!session.ok) return session.response;
  if (!isUuid(commentId))
    return notFoundResponse(requestId, "comment_not_found");

  const { data, error } = await session.supabase.rpc("retract_comment", {
    p_comment_id: commentId,
  });
  if (error) return communityErrorResponse(error, requestId, "retract_comment");

  return Response.json({ data }, { headers: noStore });
}
