import { canonicalJson } from "@/lib/geo/canonical";
import {
  communityErrorResponse,
  isUuid,
  noStore,
  notFoundResponse,
  requireSession,
  unexpectedResponse,
} from "@/lib/http/community-route";
import {
  errorResponse,
  newRequestId,
  readMutationRequest,
  sha256Hex,
} from "@/lib/http/mutation";
import {
  commentPageSchema,
  createCommentRequestSchema,
  createCommentResponseSchema,
  decodeCursor,
  encodeCursor,
} from "@/lib/schemas/community";
import { createClient } from "@/lib/supabase/server";

type RouteProps = { params: Promise<{ publicationId: string }> };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Public, moderation-sensitive list of comments; never cached. */
export async function GET(request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { publicationId } = await params;
  if (!isUuid(publicationId))
    return notFoundResponse(requestId, "publication_not_found");

  const url = new URL(request.url);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (cursor === "invalid") {
    return errorResponse(
      400,
      "invalid_cursor",
      "The cursor is not valid.",
      requestId,
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return errorResponse(
      400,
      "invalid_limit",
      "The limit must be between 1 and 50.",
      requestId,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_public_comments", {
    p_publication_id: publicationId,
    p_after_created_at: cursor?.createdAt ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error)
    return communityErrorResponse(error, requestId, "list_public_comments");
  if (data === null)
    return notFoundResponse(requestId, "publication_not_found");

  const parsed = commentPageSchema.safeParse(data);
  if (!parsed.success)
    return unexpectedResponse(requestId, "list_public_comments");

  return Response.json(
    {
      data: {
        items: parsed.data.items,
        nextCursor: parsed.data.nextCursor
          ? encodeCursor(parsed.data.nextCursor)
          : null,
      },
    },
    { headers: noStore },
  );
}

export async function POST(request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { publicationId } = await params;

  const mutation = await readMutationRequest(request, requestId);
  if (!mutation.ok) return mutation.response;

  const session = await requireSession(requestId);
  if (!session.ok) return session.response;
  if (!isUuid(publicationId))
    return notFoundResponse(requestId, "publication_not_found");

  const input = createCommentRequestSchema.safeParse(mutation.body);
  if (!input.success) {
    return errorResponse(
      422,
      "invalid_comment",
      "The comment is not valid.",
      requestId,
      {
        path: input.error.issues[0]?.path.map(String).join("."),
      },
    );
  }

  const featureId = input.data.featureId ?? null;
  // The server derives the hash from the validated payload; clients never supply it.
  const payloadHash = sha256Hex(
    canonicalJson({ publicationId, featureId, body: input.data.body }),
  );

  const { data, error } = await session.supabase.rpc("create_comment", {
    p_publication_id: publicationId,
    p_feature_id: featureId,
    p_body: input.data.body,
    p_idempotency_key: mutation.idempotencyKey,
    p_payload_hash: payloadHash,
  });
  if (error) return communityErrorResponse(error, requestId, "create_comment");

  const parsed = createCommentResponseSchema.safeParse(data);
  if (!parsed.success) return unexpectedResponse(requestId, "create_comment");

  return Response.json(
    { data: parsed.data },
    { status: 201, headers: noStore },
  );
}
