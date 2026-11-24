import type { Locale } from "@/lib/i18n/locales";

export function safeReturnPath(
  value: string | null | undefined,
  locale: Locale,
): string {
  const fallback = `/${locale}`;
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return fallback;

  try {
    const parsed = new URL(value, "https://fork-the-city.invalid");
    if (parsed.origin !== "https://fork-the-city.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
