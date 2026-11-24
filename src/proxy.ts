import { NextResponse, type NextRequest } from "next/server";
import { dossierGate, publicationGate } from "@/lib/supabase/publication-gate";
import { updateSession } from "@/lib/supabase/proxy";

const SESSION_REFRESH_TIMEOUT_MS = 2000;

/** Supabase stores its session in cookies named sb-<project>-auth-token[.n]. */
function hasSessionCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(
      (cookie) =>
        cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"),
    );
}

/**
 * Refreshes the session without letting a slow auth service hold a page: after the
 * timeout, or on any failure, the request continues with its current cookies.
 */
async function refreshSession(request: NextRequest) {
  try {
    return await Promise.race([
      updateSession(request),
      new Promise<NextResponse>((resolve) =>
        setTimeout(
          () => resolve(NextResponse.next()),
          SESSION_REFRESH_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    return NextResponse.next();
  }
}

export async function proxy(request: NextRequest) {
  // A dossier page is public: missing or hidden ids are answered before streaming.
  // The list and the manage page need the session, so they take the default path.
  if (/^\/(es|en)\/dossiers\/[^/]+\/?$/.test(request.nextUrl.pathname)) {
    const blocked = await dossierGate(request);
    if (blocked) return blocked;
    return hasSessionCookie(request) ? refreshSession(request) : undefined;
  }
  if (request.nextUrl.pathname.includes("/publications/")) {
    // A missing or hidden publication is answered before streaming starts. A request
    // that passes the gate refreshes the session only if it carries one, so signed-in
    // users keep their community controls and anonymous visitors pay nothing extra.
    const blocked = await publicationGate(request);
    if (blocked) return blocked;
    return hasSessionCookie(request) ? refreshSession(request) : undefined;
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/:locale(es|en)/(auth|account|branches|editor|moderation)/:path*",
    "/:locale(es|en)/publications/:publicationId",
    "/:locale(es|en)/dossiers/:path*",
  ],
};
