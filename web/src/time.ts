import { DateTime } from 'luxon';

/** Календар завжди показується за київським часом, незалежно від налаштувань телефона. */
export const ZONE = 'Europe/Kyiv';

export function now() {
  return DateTime.now().setZone(ZONE);
}

export function fromIso(iso: string) {
  return DateTime.fromISO(iso, { zone: ZONE });
}

export function weekStart(d: DateTime) {
  return d.setZone(ZONE).startOf('week');
}

/** Дата (YYYY-MM-DD) + час (HH:MM) у Києві → ISO з офсетом. */
export function toIso(date: string, time: string) {
  return DateTime.fromISO(`${date}T${time}`, { zone: ZONE }).toISO()!;
}

export function isoDate(d: DateTime) {
  return d.toISODate()!;
}

export function timeRange(startsAt: string, durationMin: number) {
  const s = fromIso(startsAt);
  return `${s.toFormat('HH:mm')}–${s.plus({ minutes: durationMin }).toFormat('HH:mm')}`;
}

export function fmt(d: DateTime, lang: string, format: string) {
  return d.setLocale(lang === 'ru' ? 'ru' : 'uk').toFormat(format);
}

export function formatDuration(min: number, lang: string) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hu = lang === 'ru' ? 'ч' : 'год';
  const mu = 'хв';
  const mru = 'мин';
  const parts = [];
  if (h) parts.push(`${h} ${hu}`);
  if (m) parts.push(`${m} ${lang === 'ru' ? mru : mu}`);
  return parts.join(' ');
}
