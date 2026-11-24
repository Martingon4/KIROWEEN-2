import { canonicalJson } from "@/lib/geo/canonical";
import {
  communityErrorResponse,
  isUuid,
  noStore,
  notFoundResponse,
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
  resolveReportRequestSchema,
  resolveReportResultSchema,
} from "@/lib/schemas/community";

type RouteProps = { params: Promise<{ reportId: string }> };

/** Moderator-only. Anyone else, and any other site's report, is a plain 404. */
export async function POST(request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { reportId } = await params;

  const mutation = await readMutationRequest(request, requestId);
  if (!mutation.ok) return mutation.response;
  const session = await requireSession(requestId);
  if (!session.ok) return session.response;
  if (!isUuid(reportId)) return notFoundResponse(requestId, "report_not_found");

  const input = resolveReportRequestSchema.safeParse(mutation.body);
  if (!input.success) {
    return errorResponse(
      422,
      "invalid_resolution",
      "The resolution is not valid.",
      requestId,
      {
        path: input.error.issues[0]?.path.map(String).join("."),
      },
    );
  }

  const note = input.data.outcome === "dismissed" ? input.data.note : null;
  const eventId = input.data.outcome === "actioned" ? input.data.eventId : null;
  const payloadHash = sha256Hex(
    canonicalJson({ reportId, outcome: input.data.outcome, note, eventId }),
  );

  const { data, error } = await session.supabase.rpc("resolve_report", {
    p_report_id: reportId,
    p_outcome: input.data.outcome,
    p_note: note,
    p_event_id: eventId,
    p_idempotency_key: mutation.idempotencyKey,
    p_payload_hash: payloadHash,
  });
  if (error) return communityErrorResponse(error, requestId, "resolve_report");

  const parsed = resolveReportResultSchema.safeParse(data);
  if (!parsed.success) return unexpectedResponse(requestId, "resolve_report");
  return Response.json({ data: parsed.data }, { headers: noStore });
}
