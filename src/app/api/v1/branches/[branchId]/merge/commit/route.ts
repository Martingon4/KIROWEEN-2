import { z } from "zod";
import { canonicalJson } from "@/lib/geo/canonical";
import { mapMergeError } from "@/lib/http/database-errors";
import {
  errorResponse,
  newRequestId,
  readMutationRequest,
  sha256Hex,
} from "@/lib/http/mutation";
import {
  mergeCommitRequestSchema,
  mergeCommitResponseSchema,
} from "@/lib/schemas/merge";
import { createClient } from "@/lib/supabase/server";

type RouteProps = {
  params: Promise<{ branchId: string }>;
};

/**
 * Commits a merge (FT-08). The database recomputes the comparison and every rule with
 * the exact ids, verifies the expected head, and writes one revision with both parents.
 */
export async function POST(request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { branchId } = await params;

  const mutation = await readMutationRequest(request, requestId);
  if (!mutation.ok) return mutation.response;

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return errorResponse(
      401,
      "authentication_required",
      "Sign in to merge.",
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

  const input = mergeCommitRequestSchema.safeParse(mutation.body);
  if (!input.success) {
    return errorResponse(
      422,
      "invalid_merge",
      "The merge request is invalid.",
      requestId,
      {
        path: input.error.issues[0]?.path.map(String).join("."),
      },
    );
  }

  // Hash of the validated payload; computed here, never accepted from clients.
  const payloadHash = sha256Hex(
    canonicalJson({
      branchId,
      sourcePublicationId: input.data.sourcePublicationId,
      expectedHeadId: input.data.expectedHeadId,
      message: input.data.message,
      resolutions: input.data.resolutions,
    }),
  );

  const { data, error } = await supabase.rpc("merge_commit", {
    p_branch_id: branchId,
    p_source_publication_id: input.data.sourcePublicationId,
    p_expected_head_id: input.data.expectedHeadId,
    p_message: input.data.message,
    p_resolutions: input.data.resolutions,
    p_idempotency_key: mutation.idempotencyKey,
    p_payload_hash: payloadHash,
  });

  if (error) {
    const mapped = mapMergeError(error);
    if (mapped) {
      return errorResponse(
        mapped.status,
        mapped.code,
        mapped.message,
        requestId,
        mapped.details,
      );
    }
    console.error("merge_commit_failed", {
      requestId,
      databaseCode: error.code,
    });
    return errorResponse(
      500,
      "internal_error",
      "The merge could not be saved.",
      requestId,
    );
  }

  const parsed = mergeCommitResponseSchema.safeParse({ data });
  if (!parsed.success) {
    console.error("merge_commit_unexpected_response", { requestId });
    return errorResponse(
      500,
      "internal_error",
      "The merge could not be saved.",
      requestId,
    );
  }

  return Response.json(parsed.data, {
    status: 201,
    headers: {
      "Cache-Control": "no-store",
      Location: `/api/v1/branches/${parsed.data.data.branchId}`,
    },
  });
}
