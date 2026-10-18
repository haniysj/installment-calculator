// Dates are stored as ISO "YYYY-MM-DD" strings (local calendar dates, no time zone issues).

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseISO(s: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function isValidISO(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseISO(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function todayISO(now = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Add months keeping the anchor day; clamps to month end (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: ISODate, months: number, anchorDay?: number): ISODate {
  const { y, m, d } = parseISO(date);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(ny, nm));
  return toISO(ny, nm, day);
}

/** Number of monthly installments between two dates, counting both first and final months. */
export function monthsInclusive(start: ISODate, end: ISODate): number {
  const a = parseISO(start);
  const b = parseISO(end);
  return (b.y - a.y) * 12 + (b.m - a.m) + 1;
}

export function sameMonth(a: ISODate, b: ISODate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function monthName(m: number): string {
  return AR_MONTHS[m - 1];
}

/** "18 أكتوبر 2026" */
export function formatDateLong(s: ISODate): string {
  const { y, m, d } = parseISO(s);
  return `${d} ${AR_MONTHS[m - 1]} ${y}`;
}

/** "2026/10/18" (unambiguous, numeric) */
export function formatDateShort(s: ISODate): string {
  const { y, m, d } = parseISO(s);
  return `${y}/${pad(m)}/${pad(d)}`;
}
