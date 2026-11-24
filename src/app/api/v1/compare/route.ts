import { errorResponse, newRequestId } from "@/lib/http/mutation";
import {
  compareResultSchema,
  SNAPSHOT_REF_PATTERN,
} from "@/lib/schemas/compare";
import { createClient } from "@/lib/supabase/server";

/**
 * Compares two visible snapshots (FT-07). Anonymous visitors compare publications and
 * baselines; a signed-in owner may also name their own branch revisions. Never cached:
 * moderation can hide a side at any time.
 */
export async function GET(request: Request) {
  const requestId = newRequestId();
  const url = new URL(request.url);
  const left = url.searchParams.get("left") ?? "";
  const right = url.searchParams.get("right") ?? "";
  const scenario = url.searchParams.get("scenario");

  if (!SNAPSHOT_REF_PATTERN.test(left) || !SNAPSHOT_REF_PATTERN.test(right)) {
    return errorResponse(
      400,
      "invalid_snapshot_ref",
      "A snapshot reference is malformed.",
      requestId,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("compare_revisions", {
    p_left: left,
    p_right: right,
    p_scenario_slug: scenario,
  });

  if (error) {
    if (error.code === "P0002") {
      return errorResponse(
        404,
        "snapshot_not_found",
        "A snapshot was not found.",
        requestId,
      );
    }
    if (error.code === "22023") {
      return error.message === "invalid_scenario"
        ? errorResponse(
            422,
            "invalid_scenario",
            "The scenario is invalid.",
            requestId,
          )
        : errorResponse(
            400,
            "invalid_snapshot_ref",
            "A snapshot reference is malformed.",
            requestId,
          );
    }
    if (error.code === "FT422") {
      return errorResponse(
        422,
        "incompatible_snapshots",
        "The snapshots do not share the same site and baseline.",
        requestId,
      );
    }
    console.error("compare_revisions_failed", {
      requestId,
      databaseCode: error.code,
    });
    return errorResponse(
      500,
      "internal_error",
      "The snapshots could not be compared.",
      requestId,
    );
  }

  const parsed = compareResultSchema.safeParse(data);
  if (!parsed.success) {
    console.error("compare_revisions_unexpected_response", { requestId });
    return errorResponse(
      500,
      "internal_error",
      "The snapshots could not be compared.",
      requestId,
    );
  }

  return Response.json(
    { data: parsed.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
