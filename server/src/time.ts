import { DateTime } from 'luxon';

/** Усі дати й час календаря — за київським часом. */
export const ZONE = 'Europe/Kyiv';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Місцева дата + час у Києві → момент у UTC. */
export function kyivToDate(date: string, time: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: ZONE });
  if (!dt.isValid) throw new Error(`invalid date/time ${date} ${time}`);
  return dt.toJSDate();
}

/** Момент → місцева дата в Києві (YYYY-MM-DD). */
export function kyivDate(d: Date): string {
  return DateTime.fromJSDate(d, { zone: ZONE }).toISODate()!;
}

/** Момент → місцевий час у Києві (HH:MM). */
export function kyivTime(d: Date): string {
  return DateTime.fromJSDate(d, { zone: ZONE }).toFormat('HH:mm');
}

/** Початок місцевої доби в Києві. */
export function kyivDayStart(date: string): Date {
  return DateTime.fromISO(date, { zone: ZONE }).startOf('day').toJSDate();
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

export function isValidDate(date: string): boolean {
  return DATE_RE.test(date) && DateTime.fromISO(date).isValid;
}

/** Усі дати в [startDate, endDate], що припадають на вказані ISO-дні тижня (1 = пн … 7 = нд). */
export function datesForWeekdays(startDate: string, endDate: string, weekdays: number[]): string[] {
  const days = new Set(weekdays);
  const out: string[] = [];
  let d = DateTime.fromISO(startDate);
  const end = DateTime.fromISO(endDate);
  while (d <= end) {
    if (days.has(d.weekday)) out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

export function daysBetween(a: string, b: string): number {
  return Math.round(DateTime.fromISO(b).diff(DateTime.fromISO(a), 'days').days);
}
