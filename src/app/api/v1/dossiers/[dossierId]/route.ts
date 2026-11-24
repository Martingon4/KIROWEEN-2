import {
  communityErrorResponse,
  isUuid,
  noStore,
  notFoundResponse,
  unexpectedResponse,
} from "@/lib/http/community-route";
import { newRequestId } from "@/lib/http/mutation";
import { publicDossierSchema } from "@/lib/schemas/dossier";
import { createClient } from "@/lib/supabase/server";

type RouteProps = { params: Promise<{ dossierId: string }> };

/** Public dossier. A hidden publication, or a missing dossier, is a plain 404. */
export async function GET(_request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { dossierId } = await params;
  if (!isUuid(dossierId))
    return notFoundResponse(requestId, "dossier_not_found");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_dossier", {
    p_dossier_id: dossierId,
  });
  if (error)
    return communityErrorResponse(error, requestId, "get_public_dossier");
  if (data === null) return notFoundResponse(requestId, "dossier_not_found");

  const parsed = publicDossierSchema.safeParse(data);
  if (!parsed.success)
    return unexpectedResponse(requestId, "get_public_dossier");
  return Response.json({ data: parsed.data }, { headers: noStore });
}
