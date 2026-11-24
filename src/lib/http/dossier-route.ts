import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { canonicalJson } from "@/lib/geo/canonical";
import {
  mapDossierError,
  type DatabaseError,
} from "@/lib/http/database-errors";
import { requireSession } from "@/lib/http/community-route";
import {
  errorResponse,
  newRequestId,
  readMutationRequest,
  sha256Hex,
} from "@/lib/http/mutation";

export function dossierErrorResponse(
  error: DatabaseError,
  requestId: string,
  operation: string,
  notFoundCode?: string,
): Response {
  const mapped = mapDossierError(error);
  if (mapped && mapped.status === 404 && notFoundCode) {
    // One code per route: a missing child and a hidden parent look the same to a stranger.
    return errorResponse(
      404,
      notFoundCode,
      "The resource was not found.",
      requestId,
    );
  }
  if (mapped) {
    return errorResponse(
      mapped.status,
      mapped.code,
      mapped.message,
      requestId,
      mapped.details,
      mapped.headers,
    );
  }
  console.error(`${operation}_failed`, { requestId, databaseCode: error.code });
  return errorResponse(
    500,
    "internal_error",
    "The request could not be completed.",
    requestId,
  );
}

type MutationOptions<S extends z.ZodType, R extends z.ZodType> = {
  operation: string;
  /** The 404 code of this route, whichever object the database could not resolve. */
  notFoundCode?: string;
  schema: S;
  /** The canonical fields that make two requests "the same"; hashed on the server. */
  fingerprint: (input: z.infer<S>) => unknown;
  call: (
    supabase: SupabaseClient,
    input: z.infer<S>,
    key: string,
    hash: string,
  ) => PromiseLike<{ data: unknown; error: DatabaseError | null }>;
  result: R;
  /** Success status; 201 for a create, 200 otherwise. */
  status?: (data: z.infer<R>) => number;
};

/**
 * Shared shape of every idempotent dossier write: allowed origin, Idempotency-Key, size
 * and JSON limits, session, Zod validation, a server-computed payload hash, one RPC,
 * and a validated response. Authorization lives in the database.
 */
export async function handleDossierMutation<
  S extends z.ZodType,
  R extends z.ZodType,
>(request: Request, options: MutationOptions<S, R>): Promise<Response> {
  const requestId = newRequestId();

  const mutation = await readMutationRequest(request, requestId);
  if (!mutation.ok) return mutation.response;
  const session = await requireSession(requestId);
  if (!session.ok) return session.response;

  const input = options.schema.safeParse(mutation.body);
  if (!input.success) {
    return errorResponse(
      422,
      "invalid_dossier_request",
      "The request data is not valid.",
      requestId,
      { path: input.error.issues[0]?.path.map(String).join(".") },
    );
  }

  const hash = sha256Hex(canonicalJson(options.fingerprint(input.data)));
  const { data, error } = await options.call(
    session.supabase,
    input.data,
    mutation.idempotencyKey,
    hash,
  );
  if (error) {
    return dossierErrorResponse(
      error,
      requestId,
      options.operation,
      options.notFoundCode,
    );
  }

  const parsed = options.result.safeParse(data);
  if (!parsed.success) {
    console.error(`${options.operation}_unexpected_response`, { requestId });
    return errorResponse(
      500,
      "internal_error",
      "The request could not be completed.",
      requestId,
    );
  }

  return Response.json(
    { data: parsed.data },
    {
      status: options.status ? options.status(parsed.data) : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
