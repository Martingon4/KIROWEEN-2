import { newRequestId } from "@/lib/http/mutation";
import { isUuid, notFoundResponse } from "@/lib/http/community-route";
import { handleDossierMutation } from "@/lib/http/dossier-route";
import {
  eventResultSchema,
  transitionRequestSchema,
} from "@/lib/schemas/dossier";

type RouteProps = { params: Promise<{ dossierId: string }> };

/** Records a status change. The database enforces the full requirement matrix. */
export async function POST(request: Request, { params }: RouteProps) {
  const { dossierId } = await params;
  if (!isUuid(dossierId))
    return notFoundResponse(newRequestId(), "dossier_not_found");
  return handleDossierMutation(request, {
    operation: "transition_dossier",
    schema: transitionRequestSchema,
    fingerprint: (input) => ({
      dossierId,
      expectedState: input.expectedState,
      newState: input.newState,
      note: input.note ?? null,
      observation: input.observation ?? null,
      difference: input.difference ?? null,
      evidenceIds: [...input.evidenceIds].sort(),
    }),
    call: (supabase, input, key, hash) =>
      supabase.rpc("transition_dossier", {
        p_dossier_id: dossierId,
        p_expected_state: input.expectedState,
        p_new_state: input.newState,
        p_note: input.note ?? null,
        p_observation: input.observation ?? null,
        p_difference: input.difference ?? null,
        p_evidence_ids: input.evidenceIds,
        p_idempotency_key: key,
        p_payload_hash: hash,
      }),
    result: eventResultSchema,
    status: () => 201,
  });
}
