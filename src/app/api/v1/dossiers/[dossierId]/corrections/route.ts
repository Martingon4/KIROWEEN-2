import { newRequestId } from "@/lib/http/mutation";
import { isUuid, notFoundResponse } from "@/lib/http/community-route";
import { handleDossierMutation } from "@/lib/http/dossier-route";
import {
  correctionRequestSchema,
  eventResultSchema,
} from "@/lib/schemas/dossier";

type RouteProps = { params: Promise<{ dossierId: string }> };

/** Undoes the last status change with an additional, visible correction event. */
export async function POST(request: Request, { params }: RouteProps) {
  const { dossierId } = await params;
  if (!isUuid(dossierId))
    return notFoundResponse(newRequestId(), "dossier_not_found");
  return handleDossierMutation(request, {
    operation: "revert_last_status_change",
    schema: correctionRequestSchema,
    fingerprint: (input) => ({
      dossierId,
      expectedState: input.expectedState,
      note: input.note,
    }),
    call: (supabase, input, key, hash) =>
      supabase.rpc("revert_last_status_change", {
        p_dossier_id: dossierId,
        p_expected_state: input.expectedState,
        p_note: input.note,
        p_idempotency_key: key,
        p_payload_hash: hash,
      }),
    result: eventResultSchema,
    status: () => 201,
  });
}
