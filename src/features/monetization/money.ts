/**
 * Real-money prices: integer minor units + ISO currency on the wire (`CreditPackageDto.priceMinor`), always rendered
 * with the currency symbol (analisi/05 §7.7: the EUR price is always visible).
 */
export function formatPrice(priceMinor: number, currency: string, locale: string): string {
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(priceMinor / 10 ** digits);
}
