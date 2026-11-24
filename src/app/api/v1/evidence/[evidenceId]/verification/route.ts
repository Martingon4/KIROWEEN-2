import { z } from "zod";
import {
  isUuid,
  noStore,
  notFoundResponse,
  requireSession,
} from "@/lib/http/community-route";
import { dossierErrorResponse } from "@/lib/http/dossier-route";
import {
  errorResponse,
  newRequestId,
  readMutationOrigin,
} from "@/lib/http/mutation";
import { verificationRequestSchema } from "@/lib/schemas/dossier";

type RouteProps = { params: Promise<{ evidenceId: string }> };

const resultSchema = z.object({ evidenceId: z.uuid(), verified: z.boolean() });

/** Marks evidence as verified (or not) by the team. Naturally idempotent. */
export async function PUT(request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { evidenceId } = await params;

  const blocked = readMutationOrigin(request, requestId);
  if (blocked) return blocked;
  const session = await requireSession(requestId);
  if (!session.ok) return session.response;
  if (!isUuid(evidenceId))
    return notFoundResponse(requestId, "evidence_not_found");

  // The body is one boolean: cap it before parsing.
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 1024) {
    return errorResponse(
      413,
      "payload_too_large",
      "The request body is too large.",
      requestId,
    );
  }
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  const body = verificationRequestSchema.safeParse(json);
  if (!body.success) {
    return errorResponse(
      422,
      "invalid_dossier_request",
      "The request data is not valid.",
      requestId,
    );
  }

  const { data, error } = await session.supabase.rpc("set_evidence_verified", {
    p_evidence_id: evidenceId,
    p_verified: body.data.verified,
  });
  if (error)
    return dossierErrorResponse(
      error,
      requestId,
      "set_evidence_verified",
      "evidence_not_found",
    );

  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) {
    return errorResponse(
      500,
      "internal_error",
      "The request could not be completed.",
      requestId,
    );
  }
  return Response.json({ data: parsed.data }, { headers: noStore });
}
