export function isAllowedMutationOrigin(
  origin: string | null,
  allowedOrigins: readonly string[],
) {
  if (!origin) return false;

  try {
    const normalized = new URL(origin).origin;
    return allowedOrigins.some(
      (allowed) => new URL(allowed).origin === normalized,
    );
  } catch {
    return false;
  }
}
