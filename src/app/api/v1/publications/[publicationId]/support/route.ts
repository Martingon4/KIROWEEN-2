import {
  communityErrorResponse,
  isUuid,
  noStore,
  notFoundResponse,
  requireSession,
  unexpectedResponse,
} from "@/lib/http/community-route";
import { newRequestId, readMutationOrigin } from "@/lib/http/mutation";
import {
  communitySummarySchema,
  supportResultSchema,
} from "@/lib/schemas/community";
import { createClient } from "@/lib/supabase/server";

type RouteProps = { params: Promise<{ publicationId: string }> };

/** Count for everyone; `supported` is known only to the signed-in account itself. */
export async function GET(_request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { publicationId } = await params;
  if (!isUuid(publicationId))
    return notFoundResponse(requestId, "publication_not_found");

  const supabase = await createClient();
  const { data: summary, error } = await supabase.rpc(
    "get_public_community_summary",
    {
      p_publication_id: publicationId,
    },
  );
  if (error) return communityErrorResponse(error, requestId, "get_support");
  if (summary === null)
    return notFoundResponse(requestId, "publication_not_found");

  const parsed = communitySummarySchema.safeParse(summary);
  if (!parsed.success) return unexpectedResponse(requestId, "get_support");

  const { data: claims } = await supabase.auth.getClaims();
  let supported: boolean | null = null;
  if (claims?.claims?.sub) {
    const mine = await supabase.rpc("my_support_state", {
      p_publication_id: publicationId,
    });
    supported = typeof mine.data === "boolean" ? mine.data : null;
  }

  return Response.json(
    { data: { count: parsed.data.supportCount, supported } },
    { headers: noStore },
  );
}

async function setSupport(
  request: Request,
  params: RouteProps["params"],
  supported: boolean,
) {
  const requestId = newRequestId();
  const { publicationId } = await params;

  const blocked = readMutationOrigin(request, requestId);
  if (blocked) return blocked;
  const session = await requireSession(requestId);
  if (!session.ok) return session.response;
  if (!isUuid(publicationId))
    return notFoundResponse(requestId, "publication_not_found");

  const { data, error } = await session.supabase.rpc("set_support", {
    p_publication_id: publicationId,
    p_supported: supported,
  });
  if (error) return communityErrorResponse(error, requestId, "set_support");

  const parsed = supportResultSchema.safeParse(data);
  if (!parsed.success) return unexpectedResponse(requestId, "set_support");
  return Response.json({ data: parsed.data }, { headers: noStore });
}

export function PUT(request: Request, { params }: RouteProps) {
  return setSupport(request, params, true);
}

export function DELETE(request: Request, { params }: RouteProps) {
  return setSupport(request, params, false);
}
