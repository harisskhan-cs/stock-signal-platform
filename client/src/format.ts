export const pct = (fraction: number | null | undefined, digits = 1, signed = false): string => {
  if (fraction == null || !Number.isFinite(fraction)) return '—';
  const value = (Math.abs(fraction) * 100).toFixed(digits);
  const sign = fraction < 0 ? '−' : signed && fraction > 0 ? '+' : '';
  return `${sign}${value}%`;
};

export const num = (value: number | null | undefined, digits = 2): string =>
  value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);

/** Yahoo quotes some exchanges in minor units (London in pence, Johannesburg in cents). */
const MINOR_UNITS: Record<string, string> = { GBp: 'p', GBX: 'p', ZAc: 'c', ILA: ' ag.' };

export const money = (value: number, currency: string | null): string => {
  const minor = currency ? MINOR_UNITS[currency] : undefined;
  if (minor) return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${minor}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
};

/** YYYY-MM-DD for `months` months before today. */
export function monthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export const stanceClass = (stance: number): string => (stance > 0 ? 'bull' : stance < 0 ? 'bear' : 'neutral');

/** CSS class for a signed number: up, down or flat. */
export const tone = (value: number | null | undefined): string => (value == null || value === 0 ? 'flat' : value > 0 ? 'up' : 'down');

/** A signed number with a real minus sign: +3.19 / −1.05. */
export const signed = (value: number | null | undefined, digits = 2): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value).toFixed(digits);
  return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : abs;
};

/** Short date like "Oct 22" for tables. */
export const shortDate = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
