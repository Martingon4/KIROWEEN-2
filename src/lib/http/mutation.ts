import { createHash, randomUUID } from "node:crypto";
import { isAllowedMutationOrigin } from "@/lib/auth/origin";
import { getServerEnv } from "@/lib/schemas/env";
import { apiErrorEnvelopeSchema } from "@/lib/schemas/site";

export const MAX_MUTATION_BYTES = 512 * 1024;

export function newRequestId() {
  return randomUUID();
}

export function sha256Hex(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return Response.json(
    apiErrorEnvelopeSchema.parse({ code, message, requestId, details }),
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

type MutationInput =
  | { ok: true; idempotencyKey: string; body: unknown }
  | { ok: false; response: Response };

/**
 * Shared guard for JSON mutations: allowed origin, Idempotency-Key header,
 * declared and actual body size, and well-formed JSON.
 */
export async function readMutationRequest(
  request: Request,
  requestId: string,
): Promise<MutationInput> {
  const env = getServerEnv();

  if (
    !isAllowedMutationOrigin(
      request.headers.get("origin"),
      env.APP_ALLOWED_ORIGINS,
    )
  ) {
    return {
      ok: false,
      response: errorResponse(
        403,
        "origin_not_allowed",
        "The request origin is not allowed.",
        requestId,
      ),
    };
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    !idempotencyKey ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 200
  ) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "invalid_idempotency_key",
        "A valid Idempotency-Key header is required.",
        requestId,
      ),
    };
  }

  const tooLarge = () => ({
    ok: false as const,
    response: errorResponse(
      413,
      "payload_too_large",
      "The request body is too large.",
      requestId,
    ),
  });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MUTATION_BYTES)
    return tooLarge();

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_MUTATION_BYTES)
    return tooLarge();

  try {
    return { ok: true, idempotencyKey, body: JSON.parse(rawBody) };
  } catch {
    return {
      ok: false,
      response: errorResponse(
        400,
        "invalid_json",
        "The request body must be valid JSON.",
        requestId,
      ),
    };
  }
}

/**
 * Origin-only guard for mutations without a body or idempotency key (PUT and DELETE of
 * naturally idempotent state such as support). Returns an error response or null.
 */
export function readMutationOrigin(
  request: Request,
  requestId: string,
): Response | null {
  const env = getServerEnv();
  if (
    !isAllowedMutationOrigin(
      request.headers.get("origin"),
      env.APP_ALLOWED_ORIGINS,
    )
  ) {
    return errorResponse(
      403,
      "origin_not_allowed",
      "The request origin is not allowed.",
      requestId,
    );
  }
  return null;
}
