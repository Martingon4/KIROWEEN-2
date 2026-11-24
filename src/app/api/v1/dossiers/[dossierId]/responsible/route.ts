import { z } from "zod";
import { newRequestId } from "@/lib/http/mutation";
import { isUuid, notFoundResponse } from "@/lib/http/community-route";
import { handleDossierMutation } from "@/lib/http/dossier-route";
import { responsibleRequestSchema } from "@/lib/schemas/dossier";

type RouteProps = { params: Promise<{ dossierId: string }> };

const resultSchema = z.object({
  dossierId: z.uuid(),
  hasResponsible: z.boolean(),
});

/** Sets or removes the public responsible. A name is stored only with authorization. */
export async function PUT(request: Request, { params }: RouteProps) {
  const { dossierId } = await params;
  if (!isUuid(dossierId))
    return notFoundResponse(newRequestId(), "dossier_not_found");
  return handleDossierMutation(request, {
    operation: "set_dossier_responsible",
    schema: responsibleRequestSchema,
    fingerprint: (input) => ({
      dossierId,
      responsibleName: input.responsibleName,
      responsibleAuthorized: input.responsibleAuthorized ?? false,
    }),
    call: (supabase, input, key, hash) =>
      supabase.rpc("set_dossier_responsible", {
        p_dossier_id: dossierId,
        p_responsible_name: input.responsibleName,
        p_responsible_authorized: input.responsibleAuthorized ?? false,
        p_idempotency_key: key,
        p_payload_hash: hash,
      }),
    result: resultSchema,
  });
}
