import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPublicSupabaseEnv } from "@/lib/schemas/env";

const GATE_TIMEOUT_MS = 1500;
const publicationPath = /^\/(es|en)\/publications\/([^/]+)\/?$/;
const dossierPath = /^\/(es|en)\/dossiers\/([^/]+)\/?$/;

/**
 * Returns a 404 rewrite for a public page whose id is malformed, missing, or hidden.
 * It runs in Proxy, before streaming fixes the status code. It returns null when the
 * page should render, including when the check itself fails, so a database outage
 * surfaces as the page's own error rather than a false 404.
 */
async function existenceGate(
  request: NextRequest,
  pattern: RegExp,
  rpcName: "public_publication_exists" | "public_dossier_exists",
  rpcParam: "p_publication_id" | "p_dossier_id",
): Promise<NextResponse | null> {
  const match = pattern.exec(request.nextUrl.pathname);
  if (!match) return null;
  const [, locale, id] = match;

  const notFoundResponse = () =>
    // The target route is prerendered as a 404, so the rewrite keeps that status.
    NextResponse.rewrite(
      new URL(`/${locale}/publication-unavailable`, request.url),
    );

  if (!z.uuid().safeParse(id).success) return notFoundResponse();

  const env = getPublicSupabaseEnv();
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      // A hung database must not hold every public page in Proxy.
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
          }),
      },
    },
  );
  try {
    const { data, error } = await supabase.rpc(rpcName, { [rpcParam]: id });
    if (error) return null;
    return data === true ? null : notFoundResponse();
  } catch {
    return null;
  }
}

export const publicationGate = (request: NextRequest) =>
  existenceGate(
    request,
    publicationPath,
    "public_publication_exists",
    "p_publication_id",
  );

/** Same rule for dossiers: a hidden publication hides its dossier page. */
export const dossierGate = (request: NextRequest) =>
  existenceGate(request, dossierPath, "public_dossier_exists", "p_dossier_id");
