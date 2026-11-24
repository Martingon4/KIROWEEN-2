/** Formats integer cents as a locale-aware currency amount. */
export function formatCents(
  cents: number,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Formats a low–high cent range, collapsing equal extremes. */
export function formatCentsRange(
  lowCents: number,
  highCents: number,
  currency: string,
  locale: string,
): string {
  const low = formatCents(lowCents, currency, locale);
  if (lowCents === highCents) return low;
  return `${low} – ${formatCents(highCents, currency, locale)}`;
}
