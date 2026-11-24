import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  mapCommunityError,
  type DatabaseError,
} from "@/lib/http/database-errors";
import { errorResponse } from "@/lib/http/mutation";
import { createClient } from "@/lib/supabase/server";

type Session =
  { ok: true; supabase: SupabaseClient } | { ok: false; response: Response };

/** Requires a signed-in session; anonymous callers learn nothing else. */
export async function requireSession(requestId: string): Promise<Session> {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims?.sub) {
    return {
      ok: false,
      response: errorResponse(
        401,
        "authentication_required",
        "Sign in to continue.",
        requestId,
      ),
    };
  }
  return { ok: true, supabase };
}

/** Turns a database error into the stable envelope; unmapped errors are a generic 500. */
export function communityErrorResponse(
  error: DatabaseError,
  requestId: string,
  operation: string,
): Response {
  const mapped = mapCommunityError(error);
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

export function unexpectedResponse(
  requestId: string,
  operation: string,
): Response {
  console.error(`${operation}_unexpected_response`, { requestId });
  return errorResponse(
    500,
    "internal_error",
    "The request could not be completed.",
    requestId,
  );
}

export function notFoundResponse(requestId: string, code = "not_found") {
  return errorResponse(404, code, "The resource was not found.", requestId);
}

export const isUuid = (value: string) => z.uuid().safeParse(value).success;

export const noStore = { "Cache-Control": "no-store" } as const;
