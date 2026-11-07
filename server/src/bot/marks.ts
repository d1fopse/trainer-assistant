import { and, asc, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { bookings, clients, slots } from '../db/schema.js';
import { kyivTime } from '../time.js';
import { escapeHtml, type InlineButton } from './telegram.js';
import { formatDay, tx } from './texts.js';

/**
 * Повідомлення тренеру після заняття: хто прийшов?
 * Кожен невідмічений учасник — рядок кнопок «✓ Ім'я» / «✗ Неявка».
 * Після натискання повідомлення перемальовується з поточними статусами.
 */
export async function renderMarkPrompt(db: Db, slotId: number, lang: string) {
  const t = tx(lang);
  const [slot] = await db.select().from(slots).where(eq(slots.id, slotId));
  if (!slot) return null;
  const people = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      deducted: bookings.deducted,
      isTrial: bookings.isTrial,
      name: clients.name,
    })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .where(and(eq(bookings.slotId, slotId), ne(bookings.status, 'CANCELLED')))
    .orderBy(asc(bookings.id));

  const end = new Date(slot.startsAt.getTime() + slot.durationMin * 60_000);
  const head = `${formatDay(slot.startsAt, lang)}, <b>${kyivTime(slot.startsAt)}–${kyivTime(end)}</b>${slot.type === 'GROUP' ? ` · ${t.group}` : ''}`;
  const lines = people.map((p) => {
    const name = escapeHtml(p.name) + (p.isTrial ? ` (${t.trial})` : '');
    if (p.status === 'ATTENDED') return `✅ ${name} — ${p.deducted ? t.markAttendedDeducted : p.isTrial ? t.markAttended : t.markAttendedNoPass}`;
    if (p.status === 'NO_SHOW') return `❌ ${name} — ${t.markNoShow}`;
    return `▫️ ${name}`;
  });
  const open = people.filter((p) => p.status === 'BOOKED');
  const short = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);
  const buttons: InlineButton[][] = open.map((p) => [
    { text: `✓ ${short(p.name)}`, callback_data: `mk:a:${p.id}` },
    { text: t.markNoShowButton, callback_data: `mk:n:${p.id}` },
  ]);
  const footer = open.length ? t.markPromptHint : t.markAllDone;
  return { text: [t.markPromptHead, head, '', ...lines, '', footer].join('\n'), buttons, open: open.length };
}
