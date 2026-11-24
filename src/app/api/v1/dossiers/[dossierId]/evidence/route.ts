import { z } from "zod";
import { newRequestId } from "@/lib/http/mutation";
import { isUuid, notFoundResponse } from "@/lib/http/community-route";
import { handleDossierMutation } from "@/lib/http/dossier-route";
import { evidenceRequestSchema } from "@/lib/schemas/dossier";

type RouteProps = { params: Promise<{ dossierId: string }> };

const resultSchema = z.object({
  evidenceId: z.uuid(),
  position: z.number().int(),
});

/** Records an evidence link. Only its syntax is checked; the server never opens it. */
export async function POST(request: Request, { params }: RouteProps) {
  const { dossierId } = await params;
  if (!isUuid(dossierId))
    return notFoundResponse(newRequestId(), "dossier_not_found");
  return handleDossierMutation(request, {
    operation: "add_evidence",
    schema: evidenceRequestSchema,
    fingerprint: (input) => ({
      dossierId,
      url: input.url,
      title: input.title,
      description: input.description,
      evidenceDate: input.evidenceDate,
    }),
    call: (supabase, input, key, hash) =>
      supabase.rpc("add_evidence", {
        p_dossier_id: dossierId,
        p_url: input.url,
        p_title: input.title,
        p_description: input.description,
        p_evidence_date: input.evidenceDate,
        p_idempotency_key: key,
        p_payload_hash: hash,
      }),
    result: resultSchema,
    status: () => 201,
  });
}
