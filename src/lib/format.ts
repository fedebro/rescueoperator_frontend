/** Locale-aware formatters. Credits/XP arrive as integer strings (BIGINT safe) and are formatted via BigInt. */

export function parseAmount(value: string | bigint | number | null | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (!value || !/^-?\d+$/.test(value)) return 0n;
  return BigInt(value);
}

export function formatAmount(value: string | bigint, locale: string, opts: { sign?: boolean } = {}): string {
  const n = parseAmount(value);
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n < 0n ? -n : n);
  if (n < 0n) return `−${formatted}`;
  return opts.sign && n > 0n ? `+${formatted}` : formatted;
}

export function compareAmount(a: string | bigint, b: string | bigint): number {
  const x = parseAmount(a),
    y = parseAmount(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Ratio a/b as a JS number in [0,1] without losing precision on huge values. */
export function amountRatio(a: string | bigint, b: string | bigint): number {
  const den = parseAmount(b);
  if (den <= 0n) return 0;
  const num = parseAmount(a);
  const scaled = (num * 10_000n) / den;
  return Math.min(1, Math.max(0, Number(scaled) / 10_000));
}

/** mm:ss below one hour, h:mm:ss above. Negative values clamp to zero. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDistance(meters: number, locale: string): string {
  if (meters < 950)
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(meters / 10) * 10)} m`;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

export function formatPercent(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

export function formatTime(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  );
}

export function severityTier(severity: number): 'low' | 'medium' | 'high' | 'critical' {
  if (severity <= 3) return 'low';
  if (severity <= 6) return 'medium';
  if (severity <= 8) return 'high';
  return 'critical';
}
