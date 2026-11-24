import { z } from "zod";
import { canonicalizeFeatures, canonicalJson } from "@/lib/geo/canonical";
import { mapSaveRevisionError } from "@/lib/http/database-errors";
import {
  errorResponse,
  newRequestId,
  readMutationRequest,
  sha256Hex,
} from "@/lib/http/mutation";
import {
  saveRevisionRequestSchema,
  saveRevisionResponseSchema,
} from "@/lib/schemas/intervention";
import { createClient } from "@/lib/supabase/server";

type RouteProps = {
  params: Promise<{ branchId: string }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { branchId } = await params;

  const mutation = await readMutationRequest(request, requestId);
  if (!mutation.ok) return mutation.response;

  // Anonymous callers learn nothing about branch ids or payload rules.
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return errorResponse(
      401,
      "authentication_required",
      "Sign in to save a revision.",
      requestId,
    );
  }

  if (!z.uuid().safeParse(branchId).success) {
    return errorResponse(
      404,
      "branch_not_found",
      "The branch was not found.",
      requestId,
    );
  }

  const input = saveRevisionRequestSchema.safeParse(mutation.body);
  if (!input.success) {
    const issue = input.error.issues[0];
    return errorResponse(
      422,
      "invalid_revision",
      "The revision data is invalid.",
      requestId,
      {
        path: issue?.path.map(String).join("."),
      },
    );
  }

  // The server derives the hash from the canonical snapshot; clients never supply it.
  const features = canonicalizeFeatures(input.data.features);
  const payloadHash = sha256Hex(
    canonicalJson({
      branchId,
      expectedHeadId: input.data.expectedHeadId,
      message: input.data.message,
      features,
    }),
  );

  const { data, error } = await supabase.rpc("save_revision", {
    p_branch_id: branchId,
    p_expected_head_id: input.data.expectedHeadId,
    p_message: input.data.message,
    p_features: features,
    p_idempotency_key: mutation.idempotencyKey,
    p_payload_hash: payloadHash,
  });

  if (error) {
    const mapped = mapSaveRevisionError(error);
    if (mapped) {
      return errorResponse(
        mapped.status,
        mapped.code,
        mapped.message,
        requestId,
        mapped.details,
      );
    }
    console.error("save_revision_failed", {
      requestId,
      databaseCode: error.code,
    });
    return errorResponse(
      500,
      "internal_error",
      "The revision could not be saved.",
      requestId,
    );
  }

  const parsed = saveRevisionResponseSchema.safeParse({ data });
  if (!parsed.success) {
    console.error("save_revision_unexpected_response", { requestId });
    return errorResponse(
      500,
      "internal_error",
      "The revision could not be saved.",
      requestId,
    );
  }

  const body = parsed.data;
  return Response.json(body, {
    status: 201,
    headers: {
      "Cache-Control": "no-store",
      Location: `/api/v1/branches/${body.data.branchId}`,
    },
  });
}
