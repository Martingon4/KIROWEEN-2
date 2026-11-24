import { z } from "zod";
import { mapMergeError } from "@/lib/http/database-errors";
import {
  errorResponse,
  newRequestId,
  readMutationRequest,
} from "@/lib/http/mutation";
import {
  mergePreviewRequestSchema,
  mergePreviewSchema,
} from "@/lib/schemas/merge";
import { createClient } from "@/lib/supabase/server";

type RouteProps = {
  params: Promise<{ branchId: string }>;
};

/**
 * Previews merging a visible publication into an own branch (FT-08). It writes
 * nothing; the Idempotency-Key header is required only for the shared mutation guard
 * (origin, size, JSON) and has no effect.
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

  const input = mergePreviewRequestSchema.safeParse(mutation.body);
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

  const { data, error } = await supabase.rpc("merge_preview", {
    p_branch_id: branchId,
    p_source_publication_id: input.data.sourcePublicationId,
    p_resolutions: input.data.resolutions,
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
    console.error("merge_preview_failed", {
      requestId,
      databaseCode: error.code,
    });
    return errorResponse(
      500,
      "internal_error",
      "The merge could not be previewed.",
      requestId,
    );
  }

  const parsed = mergePreviewSchema.safeParse(data);
  if (!parsed.success) {
    console.error("merge_preview_unexpected_response", { requestId });
    return errorResponse(
      500,
      "internal_error",
      "The merge could not be previewed.",
      requestId,
    );
  }

  return Response.json(
    { data: parsed.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
