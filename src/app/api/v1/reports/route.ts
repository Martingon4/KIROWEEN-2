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
  createReportRequestSchema,
  createReportResponseSchema,
} from "@/lib/schemas/community";

/** Files a private report about a visible publication or comment. */
export async function POST(request: Request) {
  const requestId = newRequestId();

  const mutation = await readMutationRequest(request, requestId);
  if (!mutation.ok) return mutation.response;
  const session = await requireSession(requestId);
  if (!session.ok) return session.response;

  const input = createReportRequestSchema.safeParse(mutation.body);
  if (!input.success) {
    return errorResponse(
      422,
      "invalid_report",
      "The report is not valid.",
      requestId,
      {
        path: input.error.issues[0]?.path.map(String).join("."),
      },
    );
  }

  const note = input.data.note ?? null;
  const payloadHash = sha256Hex(
    canonicalJson({
      targetKind: input.data.targetKind,
      targetId: input.data.targetId,
      reason: input.data.reason,
      note,
    }),
  );

  const { data, error } = await session.supabase.rpc("create_report", {
    p_target_kind: input.data.targetKind,
    p_target_id: input.data.targetId,
    p_reason: input.data.reason,
    p_note: note,
    p_idempotency_key: mutation.idempotencyKey,
    p_payload_hash: payloadHash,
  });
  if (error) return communityErrorResponse(error, requestId, "create_report");

  const parsed = createReportResponseSchema.safeParse(data);
  if (!parsed.success) return unexpectedResponse(requestId, "create_report");

  return Response.json(
    { data: parsed.data },
    { status: parsed.data.duplicate ? 200 : 201, headers: noStore },
  );
}
