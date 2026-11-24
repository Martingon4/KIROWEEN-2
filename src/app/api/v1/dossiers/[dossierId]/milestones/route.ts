import { z } from "zod";
import { newRequestId } from "@/lib/http/mutation";
import { isUuid, notFoundResponse } from "@/lib/http/community-route";
import { handleDossierMutation } from "@/lib/http/dossier-route";
import { milestoneRequestSchema } from "@/lib/schemas/dossier";

type RouteProps = { params: Promise<{ dossierId: string }> };

const resultSchema = z.object({
  milestoneId: z.uuid(),
  position: z.number().int(),
});

export async function POST(request: Request, { params }: RouteProps) {
  const { dossierId } = await params;
  if (!isUuid(dossierId))
    return notFoundResponse(newRequestId(), "dossier_not_found");
  return handleDossierMutation(request, {
    operation: "add_milestone",
    schema: milestoneRequestSchema,
    fingerprint: (input) => ({
      dossierId,
      title: input.title,
      targetDate: input.targetDate,
    }),
    call: (supabase, input, key, hash) =>
      supabase.rpc("add_milestone", {
        p_dossier_id: dossierId,
        p_title: input.title,
        p_target_date: input.targetDate,
        p_idempotency_key: key,
        p_payload_hash: hash,
      }),
    result: resultSchema,
    status: () => 201,
  });
}
