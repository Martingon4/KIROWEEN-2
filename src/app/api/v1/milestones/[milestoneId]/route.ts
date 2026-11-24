import { z } from "zod";
import { newRequestId } from "@/lib/http/mutation";
import { isUuid, notFoundResponse } from "@/lib/http/community-route";
import { handleDossierMutation } from "@/lib/http/dossier-route";
import {
  milestoneStatuses,
  milestoneUpdateRequestSchema,
} from "@/lib/schemas/dossier";

type RouteProps = { params: Promise<{ milestoneId: string }> };

const resultSchema = z.object({
  milestoneId: z.uuid(),
  status: z.enum(milestoneStatuses),
});

/** Updates a milestone against the status the client last saw. */
export async function POST(request: Request, { params }: RouteProps) {
  const { milestoneId } = await params;
  if (!isUuid(milestoneId))
    return notFoundResponse(newRequestId(), "milestone_not_found");
  return handleDossierMutation(request, {
    operation: "update_milestone",
    notFoundCode: "milestone_not_found",
    schema: milestoneUpdateRequestSchema,
    fingerprint: (input) => ({
      milestoneId,
      expectedStatus: input.expectedStatus,
      title: input.title,
      targetDate: input.targetDate,
      status: input.status,
    }),
    call: (supabase, input, key, hash) =>
      supabase.rpc("update_milestone", {
        p_milestone_id: milestoneId,
        p_expected_status: input.expectedStatus,
        p_title: input.title,
        p_target_date: input.targetDate,
        p_status: input.status,
        p_idempotency_key: key,
        p_payload_hash: hash,
      }),
    result: resultSchema,
  });
}
