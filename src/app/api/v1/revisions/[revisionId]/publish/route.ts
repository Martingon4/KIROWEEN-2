import { z } from "zod";
import { canonicalJson } from "@/lib/geo/canonical";
import { mapPublishRevisionError } from "@/lib/http/database-errors";
import {
  errorResponse,
  newRequestId,
  readMutationRequest,
  sha256Hex,
} from "@/lib/http/mutation";
import {
  publishRevisionRequestSchema,
  publishRevisionResponseSchema,
} from "@/lib/schemas/publication";
import { createClient } from "@/lib/supabase/server";

type RouteProps = {
  params: Promise<{ revisionId: string }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { revisionId } = await params;

  const mutation = await readMutationRequest(request, requestId);
  if (!mutation.ok) return mutation.response;

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return errorResponse(
      401,
      "authentication_required",
      "Sign in to publish a revision.",
      requestId,
    );
  }

  if (!z.uuid().safeParse(revisionId).success) {
    return errorResponse(
      404,
      "revision_not_found",
      "The revision was not found.",
      requestId,
    );
  }

  const input = publishRevisionRequestSchema.safeParse(mutation.body);
  if (!input.success) {
    const issue = input.error.issues[0];
    return errorResponse(
      422,
      "invalid_publication",
      "The publication data is invalid.",
      requestId,
      {
        path: issue?.path.map(String).join("."),
      },
    );
  }

  // Hash of the trimmed, canonical payload; computed here, never accepted from clients.
  const payloadHash = sha256Hex(
    canonicalJson({
      revisionId,
      label: input.data.label,
      summary: input.data.summary,
    }),
  );

  const { data, error } = await supabase.rpc("publish_revision", {
    p_revision_id: revisionId,
    p_label: input.data.label,
    p_summary: input.data.summary,
    p_idempotency_key: mutation.idempotencyKey,
    p_payload_hash: payloadHash,
  });

  if (error) {
    const mapped = mapPublishRevisionError(error);
    if (mapped) {
      return errorResponse(
        mapped.status,
        mapped.code,
        mapped.message,
        requestId,
        mapped.details,
      );
    }
    console.error("publish_revision_failed", {
      requestId,
      databaseCode: error.code,
    });
    return errorResponse(
      500,
      "internal_error",
      "The revision could not be published.",
      requestId,
    );
  }

  const parsed = publishRevisionResponseSchema.safeParse({ data });
  if (!parsed.success) {
    console.error("publish_revision_unexpected_response", { requestId });
    return errorResponse(
      500,
      "internal_error",
      "The revision could not be published.",
      requestId,
    );
  }

  return Response.json(parsed.data, {
    status: 201,
    headers: {
      "Cache-Control": "no-store",
      Location: `/api/v1/publications/${parsed.data.data.publicationId}`,
    },
  });
}
