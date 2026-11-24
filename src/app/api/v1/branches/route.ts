import { canonicalJson } from "@/lib/geo/canonical";
import {
  errorResponse,
  newRequestId,
  readMutationRequest,
  sha256Hex,
} from "@/lib/http/mutation";
import {
  branchPayloadFingerprint,
  createBranchRequestSchema,
  createBranchResponseSchema,
} from "@/lib/schemas/branch";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const requestId = newRequestId();

  const mutation = await readMutationRequest(request, requestId);
  if (!mutation.ok) return mutation.response;

  const input = createBranchRequestSchema.safeParse(mutation.body);
  if (!input.success) {
    return errorResponse(
      422,
      "invalid_branch",
      "The branch data is invalid.",
      requestId,
    );
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return errorResponse(
      401,
      "authentication_required",
      "Sign in to create a branch.",
      requestId,
    );
  }

  const payloadHash = sha256Hex(
    canonicalJson(branchPayloadFingerprint(input.data)),
  );

  const fromPublication = "sourcePublicationId" in input.data;
  const { data, error } =
    "sourcePublicationId" in input.data
      ? await supabase.rpc("fork_publication", {
          p_publication_id: input.data.sourcePublicationId,
          p_title: input.data.title,
          p_idempotency_key: mutation.idempotencyKey,
          p_payload_hash: payloadHash,
        })
      : await supabase.rpc("create_branch", {
          p_site_id: input.data.siteId,
          p_title: input.data.title,
          p_idempotency_key: mutation.idempotencyKey,
          p_payload_hash: payloadHash,
        });

  if (error) {
    if (error.code === "FT001") {
      return errorResponse(
        409,
        "idempotency_conflict",
        "That request key was already used for different data.",
        requestId,
      );
    }
    if (error.code === "P0002") {
      return fromPublication
        ? errorResponse(
            404,
            "publication_not_found",
            "The publication was not found.",
            requestId,
          )
        : errorResponse(
            404,
            "site_not_found",
            "The requested public site was not found.",
            requestId,
          );
    }
    if (error.code === "22023") {
      return errorResponse(
        422,
        "invalid_branch",
        "The branch data is invalid.",
        requestId,
      );
    }

    console.error("create_branch_failed", {
      requestId,
      databaseCode: error.code,
    });
    return errorResponse(
      500,
      "internal_error",
      "The branch could not be created.",
      requestId,
    );
  }

  const body = createBranchResponseSchema.parse({ data });
  return Response.json(body, {
    status: 201,
    headers: {
      "Cache-Control": "no-store",
      Location: `/api/v1/branches/${body.data.branchId}`,
    },
  });
}
