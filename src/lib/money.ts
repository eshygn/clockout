import { dayOfWeek, minuteOfDay, toMin, type Wall } from "./time";

/**
 * Money is always an integer number of minor units (cents for USD) plus a currency code.
 * Floats never touch an amount.
 */
export interface Money {
  minor: number;
  currency: string;
}

export interface Rates {
  /** Agreed hourly rates in minor units. */
  baseMinor: number;
  nightMinor: number;
  weekendMinor: number;
}

/** Night hours run 22:00–06:00. */
export const NIGHT_START = 22 * 60;
export const NIGHT_END = 6 * 60;

export type RateBand = "base" | "night" | "weekend";

export interface PayBreakdown {
  totalMinor: number;
  minutes: Record<RateBand, number>;
  /** Sub-totals in minor units per band (sum may differ from total by <1 minor unit before rounding). */
  lines: { band: RateBand; minutes: number; rateMinor: number }[];
}

function assertInt(n: number, label: string) {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be an integer number of minor units, got ${n}`);
}

/** Integer division rounding half up, for non-negative numerators. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertInt(numerator, "numerator");
  if (numerator < 0) return -divRoundHalfUp(-numerator, denominator);
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/**
 * Which band a single minute falls in. A minute that is both night and weekend
 * is paid at whichever agreed rate is higher.
 */
export function bandFor(minute: number, rates: Rates): RateBand {
  const dow = dayOfWeek(minute);
  const mod = minuteOfDay(minute);
  const weekend = dow === 0 || dow === 6;
  const night = mod >= NIGHT_START || mod < NIGHT_END;
  if (weekend && night) return rates.weekendMinor >= rates.nightMinor ? "weekend" : "night";
  if (weekend) return "weekend";
  if (night) return "night";
  return "base";
}

/** Pay for one shift at agreed rates, rounded once (half up) at the end. */
export function payForShift(start: Wall, end: Wall, rates: Rates): PayBreakdown {
  assertInt(rates.baseMinor, "baseMinor");
  assertInt(rates.nightMinor, "nightMinor");
  assertInt(rates.weekendMinor, "weekendMinor");
  const s = toMin(start);
  const e = toMin(end);
  if (e < s) throw new Error("Shift ends before it starts");

  const minutes: Record<RateBand, number> = { base: 0, night: 0, weekend: 0 };
  // Walk the shift in segments that never cross a band boundary (06:00, 22:00, midnight).
  let t = s;
  while (t < e) {
    const mod = minuteOfDay(t);
    const nextBoundary = mod < NIGHT_END ? NIGHT_END : mod < NIGHT_START ? NIGHT_START : 1440;
    const segEnd = Math.min(e, t + (nextBoundary - mod));
    minutes[bandFor(t, rates)] += segEnd - t;
    t = segEnd;
  }

  const rateOf: Record<RateBand, number> = {
    base: rates.baseMinor,
    night: rates.nightMinor,
    weekend: rates.weekendMinor,
  };
  // Sum of minute × hourly-rate is exact in integers; divide by 60 once.
  const minuteRateSum = minutes.base * rateOf.base + minutes.night * rateOf.night + minutes.weekend * rateOf.weekend;
  const totalMinor = divRoundHalfUp(minuteRateSum, 60);
  const lines = (Object.keys(minutes) as RateBand[])
    .filter((b) => minutes[b] > 0)
    .map((band) => ({ band, minutes: minutes[band], rateMinor: rateOf[band] }));
  return { totalMinor, minutes, lines };
}

export function sumMinor(values: number[]): number {
  return values.reduce((a, b) => {
    assertInt(b, "amount");
    return a + b;
  }, 0);
}

/** Number of minor-unit digits for an ISO currency (USD 2, JPY 0, …). */
export function currencyExponent(currency: string): number {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Minor units → PayPal "value" string ("1234.50"), without floating point. */
export function toDecimalString(minor: number, currency: string): string {
  assertInt(minor, "minor");
  const exp = currencyExponent(currency);
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, "0");
  const whole = exp === 0 ? digits : digits.slice(0, -exp);
  const frac = exp === 0 ? "" : "." + digits.slice(-exp);
  return `${neg ? "-" : ""}${whole}${frac}`;
}

/** PayPal "value" string → minor units, without floating point. */
export function fromDecimalString(value: string, currency: string): number {
  const exp = currencyExponent(currency);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid amount: ${value}`);
  const frac = (m[3] ?? "").padEnd(exp, "0");
  if (frac.length > exp) throw new Error(`Too many decimals for ${currency}: ${value}`);
  const n = Number(m[2] + frac);
  return m[1] ? -n : n;
}

/** "$1,234.50 USD" style display; currency code always shown. */
export function formatMoney(minor: number, currency: string, opts: { compact?: boolean } = {}): string {
  const exp = currencyExponent(currency);
  const str = toDecimalString(minor, currency);
  // Formatting a decimal string: Intl accepts string input for exact formatting.
  const nf = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: opts.compact && minor % 10 ** exp === 0 ? 0 : exp,
    maximumFractionDigits: exp,
  });
  const formatted = nf.format(str as unknown as number);
  return `${formatted} ${currency}`;
}

export function formatRate(minorPerHour: number, currency: string): string {
  return `${formatMoney(minorPerHour, currency)}/h`;
}
