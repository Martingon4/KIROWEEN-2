import { canonicalJson } from "@/lib/geo/canonical";
import {
  communityErrorResponse,
  noStore,
  requireSession,
  unexpectedResponse,
} from "@/lib/http/community-route";
import {
  errorResponse,
  newRequestId,
  readMutationRequest,
  sha256Hex,
} from "@/lib/http/mutation";
import {
  moderationActionRequestSchema,
  moderationActionResultSchema,
} from "@/lib/schemas/community";

/** Hides or restores a publication or comment, with a required reason and an audit event. */
export async function POST(request: Request) {
  const requestId = newRequestId();

  const mutation = await readMutationRequest(request, requestId);
  if (!mutation.ok) return mutation.response;
  const session = await requireSession(requestId);
  if (!session.ok) return session.response;

  const input = moderationActionRequestSchema.safeParse(mutation.body);
  if (!input.success) {
    return errorResponse(
      422,
      "invalid_moderation",
      "The moderation action is not valid.",
      requestId,
      {
        path: input.error.issues[0]?.path.map(String).join("."),
      },
    );
  }

  const privateNote = input.data.privateNote ?? null;
  const reportId = input.data.reportId ?? null;
  const payloadHash = sha256Hex(
    canonicalJson({
      targetKind: input.data.targetKind,
      targetId: input.data.targetId,
      action: input.data.action,
      reason: input.data.reason,
      privateNote,
      reportId,
    }),
  );

  const { data, error } = await session.supabase.rpc("moderate_target", {
    p_target_kind: input.data.targetKind,
    p_target_id: input.data.targetId,
    p_action: input.data.action,
    p_reason: input.data.reason,
    p_private_note: privateNote,
    p_report_id: reportId,
    p_idempotency_key: mutation.idempotencyKey,
    p_payload_hash: payloadHash,
  });
  if (error) return communityErrorResponse(error, requestId, "moderate_target");

  const parsed = moderationActionResultSchema.safeParse(data);
  if (!parsed.success) return unexpectedResponse(requestId, "moderate_target");
  return Response.json(
    { data: parsed.data },
    { status: 201, headers: noStore },
  );
}
