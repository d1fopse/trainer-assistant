import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { bookings, clients, settings, slots, waitlist } from '../db/schema.js';
import { requireTrainer } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { TIME_RE } from '../time.js';
import { loadSettings, type Notifier } from '../bot/notifier.js';
import { idParam } from './validation.js';

/** Записи черги для тренера (у картці слота). */
export async function loadWaitlist(db: Db, slotId: number) {
  return db
    .select({
      id: waitlist.id,
      clientId: waitlist.clientId,
      name: clients.name,
      status: waitlist.status,
      notifiedAt: waitlist.notifiedAt,
      createdAt: waitlist.createdAt,
    })
    .from(waitlist)
    .innerJoin(clients, eq(clients.id, waitlist.clientId))
    .where(and(eq(waitlist.slotId, slotId), ne(waitlist.status, 'REMOVED')))
    .orderBy(asc(waitlist.createdAt), asc(waitlist.id));
}

/** На які з цих слотів клієнт стоїть у черзі. */
export async function myWaitlistSlotIds(db: Db, clientId: number, slotIds: number[]) {
  if (!slotIds.length) return new Set<number>();
  const rows = await db
    .select({ slotId: waitlist.slotId })
    .from(waitlist)
    .where(and(eq(waitlist.clientId, clientId), inArray(waitlist.slotId, slotIds), ne(waitlist.status, 'REMOVED')));
  return new Set(rows.map((r) => r.slotId));
}

const settingsBody = z
  .object({
    dailySummaryTime: z.string().regex(TIME_RE),
    remindersEnabled: z.boolean(),
    markPromptsEnabled: z.boolean(),
    renewalRemindersEnabled: z.boolean(),
  })
  .partial()
  .strict();

export function registerWaitlistRoutes(app: FastifyInstance, db: Db, notifier: Notifier | null) {
  const trainerOnly = { preHandler: requireTrainer };

  /** 🔔 Клієнт стає в чергу на зайнятий слот. */
  app.post('/api/slots/:id/waitlist', async (req, reply) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const u = req.authUser!;
    if (u.role !== 'CLIENT' || !u.client) throw new HttpError(403, 'clients_only');
    const clientId = u.client.id;
    await db.transaction(async (tx) => {
      const [slot] = await tx.select().from(slots).where(eq(slots.id, id)).for('update');
      if (!slot || slot.status !== 'OPEN') throw new HttpError(404, 'not_found');
      if (slot.startsAt <= new Date()) throw new HttpError(409, 'slot_started');
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(bookings)
        .where(and(eq(bookings.slotId, id), ne(bookings.status, 'CANCELLED')));
      if (n < slot.capacity) throw new HttpError(409, 'slot_has_seats');
      const [mine] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.slotId, id), eq(bookings.clientId, clientId), ne(bookings.status, 'CANCELLED')));
      if (mine) throw new HttpError(409, 'already_booked');
      await tx.insert(waitlist).values({ slotId: id, clientId }).onConflictDoNothing();
    });
    return reply.code(201).send({ waiting: true });
  });

  app.delete('/api/slots/:id/waitlist', async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const c = req.authUser!.client;
    if (!c) throw new HttpError(403, 'clients_only');
    await db
      .update(waitlist)
      .set({ status: 'REMOVED' })
      .where(and(eq(waitlist.slotId, id), eq(waitlist.clientId, c.id), ne(waitlist.status, 'REMOVED')));
    return { waiting: false };
  });

  app.get('/api/slots/:id/waitlist', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    return { waitlist: await loadWaitlist(db, id) };
  });

  /** Тренер вручну повідомляє клієнта з черги (наприклад, наступного після першого). */
  app.post('/api/waitlist/:id/notify', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const [entry] = await db.select().from(waitlist).where(eq(waitlist.id, id));
    if (!entry || entry.status === 'REMOVED') throw new HttpError(404, 'not_found');
    const delivered = notifier ? await notifier.notifyEntry(id) : false;
    return { delivered, waitlist: await loadWaitlist(db, entry.slotId) };
  });

  app.delete('/api/waitlist/:id', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const [entry] = await db.update(waitlist).set({ status: 'REMOVED' }).where(eq(waitlist.id, id)).returning();
    if (!entry) throw new HttpError(404, 'not_found');
    return { waitlist: await loadWaitlist(db, entry.slotId) };
  });

  /** Налаштування бота (тренер). */
  app.get('/api/settings', trainerOnly, async () => ({ settings: await loadSettings(db) }));

  app.patch('/api/settings', trainerOnly, async (req) => {
    const b = parse(settingsBody, req.body);
    for (const [key, value] of Object.entries(b)) {
      await db
        .insert(settings)
        .values({ key, value: String(value) })
        .onConflictDoUpdate({ target: settings.key, set: { value: String(value) } });
    }
    return { settings: await loadSettings(db) };
  });
}
