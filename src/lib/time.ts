/**
 * Clockout keeps every time as a wall-clock string in the business's own time zone
 * ("YYYY-MM-DDTHH:mm"). Shift times, pay rules and the demo clock all use the same
 * representation, so the server, the browser and Bryntum agree without time-zone maths.
 */
export type Wall = string;

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isWall(s: string): boolean {
  return WALL_RE.test(s);
}

/** Minutes since 1970-01-01T00:00 (wall clock, no zone). */
export function toMin(s: Wall): number {
  const m = WALL_RE.exec(s);
  if (!m) throw new Error(`Invalid wall-clock time: ${s}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}

export function fromMin(min: number): Wall {
  const d = new Date(min * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(min: number): number {
  return new Date(min * 60000).getUTCDay();
}

export function minuteOfDay(min: number): number {
  return ((min % 1440) + 1440) % 1440;
}

export function addMinutes(s: Wall, minutes: number): Wall {
  return fromMin(toMin(s) + minutes);
}

export function overlaps(aStart: Wall, aEnd: Wall, bStart: Wall, bEnd: Wall): boolean {
  return toMin(aStart) < toMin(bEnd) && toMin(bStart) < toMin(aEnd);
}

export function durationMinutes(start: Wall, end: Wall): number {
  return toMin(end) - toMin(start);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function dayName(s: Wall): string {
  return DAYS[dayOfWeek(toMin(s))];
}

export function hhmm(s: Wall): string {
  return s.slice(11, 16);
}

/** "Fri 16:00–23:30" */
export function formatRange(start: Wall, end: Wall): string {
  return `${dayName(start)} ${hhmm(start)}–${hhmm(end)}`;
}

/** Wall string → local Date object for UI widgets (same wall-clock reading). */
export function wallToDate(s: Wall): Date {
  const m = WALL_RE.exec(s);
  if (!m) throw new Error(`Invalid wall-clock time: ${s}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

/** Local Date from a UI widget → wall string (rounded to the minute). */
export function dateToWall(d: Date): Wall {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
