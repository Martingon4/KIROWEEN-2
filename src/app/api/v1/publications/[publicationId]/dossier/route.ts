import { newRequestId } from "@/lib/http/mutation";
import { isUuid, notFoundResponse } from "@/lib/http/community-route";
import { handleDossierMutation } from "@/lib/http/dossier-route";
import {
  promoteDossierRequestSchema,
  promoteResultSchema,
} from "@/lib/schemas/dossier";

type RouteProps = { params: Promise<{ publicationId: string }> };

/** Promotes a visible publication to a dossier. Coordinators of its site only. */
export async function POST(request: Request, { params }: RouteProps) {
  const { publicationId } = await params;
  if (!isUuid(publicationId)) {
    return notFoundResponse(newRequestId(), "publication_not_found");
  }
  return handleDossierMutation(request, {
    operation: "promote_dossier",
    schema: promoteDossierRequestSchema,
    fingerprint: (input) => ({
      publicationId,
      decisionNote: input.decisionNote,
      responsibleName: input.responsibleName ?? null,
      responsibleAuthorized: input.responsibleAuthorized ?? false,
      targetDate: input.targetDate ?? null,
    }),
    call: (supabase, input, key, hash) =>
      supabase.rpc("promote_dossier", {
        p_publication_id: publicationId,
        p_decision_note: input.decisionNote,
        p_responsible_name: input.responsibleName ?? null,
        p_responsible_authorized: input.responsibleAuthorized ?? false,
        p_target_date: input.targetDate ?? null,
        p_idempotency_key: key,
        p_payload_hash: hash,
      }),
    result: promoteResultSchema,
    status: (data) => (data.created ? 201 : 200),
  });
}
