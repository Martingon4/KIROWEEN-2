import { z } from "zod";
import { errorResponse, newRequestId } from "@/lib/http/mutation";
import { branchHeadSchema } from "@/lib/schemas/intervention";
import { createClient } from "@/lib/supabase/server";

type RouteProps = {
  params: Promise<{ branchId: string }>;
};

/** Owner-only read of the branch head snapshot. Other branches return 404. */
export async function GET(_request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { branchId } = await params;

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return errorResponse(
      401,
      "authentication_required",
      "Sign in to read a branch.",
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

  const { data, error } = await supabase.rpc("get_branch_head", {
    p_branch_id: branchId,
  });
  if (error) {
    console.error("get_branch_head_failed", {
      requestId,
      databaseCode: error.code,
    });
    return errorResponse(
      500,
      "internal_error",
      "The branch could not be read.",
      requestId,
    );
  }
  if (!data) {
    return errorResponse(
      404,
      "branch_not_found",
      "The branch was not found.",
      requestId,
    );
  }

  const parsed = branchHeadSchema.safeParse(data);
  if (!parsed.success) {
    console.error("get_branch_head_unexpected_response", { requestId });
    return errorResponse(
      500,
      "internal_error",
      "The branch could not be read.",
      requestId,
    );
  }

  return Response.json(
    { data: parsed.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
