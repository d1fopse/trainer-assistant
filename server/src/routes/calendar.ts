import type { FastifyInstance } from 'fastify';
import { and, asc, eq, gte, inArray, lt, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { bookings, clients, series, slots, type Slot } from '../db/schema.js';
import { requireTrainer } from '../auth.js';
import { HttpError, parse } from '../http.js';
import {
  TIME_RE,
  addDays,
  datesForWeekdays,
  daysBetween,
  isValidDate,
  kyivDate,
  kyivDayStart,
  kyivTime,
  kyivToDate,
} from '../time.js';
import { idParam } from './validation.js';
import { loadWaitlist, myWaitlistSlotIds } from './waitlist.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Q = Db | Tx;

const isoDateTime = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const localDate = z.string().refine(isValidDate, 'invalid date');
const duration = z.number().int().min(15).max(300);
const MAX_GROUP = 100;

const rangeQuery = z.object({ from: isoDateTime, to: isoDateTime });

const slotCreate = z.object({
  startsAt: isoDateTime,
  durationMin: duration,
  type: z.enum(['INDIVIDUAL', 'GROUP']),
  capacity: z.number().int().min(1).max(MAX_GROUP).optional(),
  note: z.string().trim().max(500).optional(),
  clientIds: z.array(z.number().int().positive()).max(MAX_GROUP).default([]),
  isTrial: z.boolean().default(false),
  force: z.boolean().default(false),
});

const slotPatch = z
  .object({
    startsAt: isoDateTime,
    durationMin: duration,
    capacity: z.number().int().min(1).max(MAX_GROUP),
    note: z.string().trim().max(500).nullable(),
    force: z.boolean(),
  })
  .partial()
  .strict();

const bookingCreate = z.object({ clientId: z.number().int().positive(), isTrial: z.boolean().default(false) });

const seriesFields = {
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .transform((w) => [...new Set(w)].sort()),
  startTime: z.string().regex(TIME_RE),
  durationMin: duration,
  endDate: localDate,
};
const seriesCreate = z.object({ clientId: z.number().int().positive(), startDate: localDate, ...seriesFields });
const seriesCancel = z.object({ fromDate: localDate });
const seriesSplit = z.object({ fromDate: localDate, ...seriesFields });
const copyWeek = z.object({ from: localDate, to: localDate });

const MAX_RANGE_DAYS = 62;
const MAX_SERIES_DAYS = 366;

function endOf(start: Date, durationMin: number) {
  return new Date(start.getTime() + durationMin * 60_000);
}

/** Відкриті слоти, що перетинаються з інтервалом. */
async function findOverlaps(q: Q, start: Date, durationMin: number, excludeId?: number) {
  const end = endOf(start, durationMin);
  const conds: SQL[] = [
    eq(slots.status, 'OPEN'),
    sql`${slots.startsAt} < ${end.toISOString()}::timestamptz`,
    sql`${slots.startsAt} + make_interval(mins => ${slots.durationMin}) > ${start.toISOString()}::timestamptz`,
  ];
  if (excludeId) conds.push(ne(slots.id, excludeId));
  return q
    .select({ id: slots.id, startsAt: slots.startsAt, durationMin: slots.durationMin, type: slots.type })
    .from(slots)
    .where(and(...conds));
}

export async function assertNoOverlap(q: Q, start: Date, durationMin: number, force: boolean, excludeId?: number) {
  if (force) return;
  const overlaps = await findOverlaps(q, start, durationMin, excludeId);
  if (overlaps.length > 0) throw new HttpError(409, 'overlap', { overlaps });
}

async function activeBookingCount(q: Q, slotId: number) {
  const [r] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.slotId, slotId), ne(bookings.status, 'CANCELLED')));
  return r?.n ?? 0;
}

/** Додає запис із перевіркою місткості, дублікатів і єдиного пробного заняття. */
export async function addBooking(tx: Tx, slot: Slot, clientId: number, isTrial: boolean) {
  if (slot.status !== 'OPEN') throw new HttpError(409, 'slot_cancelled');
  const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
  if (!client) throw new HttpError(404, 'client_not_found', { clientId });

  const [dup] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.slotId, slot.id), eq(bookings.clientId, clientId), ne(bookings.status, 'CANCELLED')));
  if (dup) throw new HttpError(409, 'already_booked', { clientId });

  if (isTrial) {
    const [trial] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.clientId, clientId), eq(bookings.isTrial, true), ne(bookings.status, 'CANCELLED')));
    if (trial) throw new HttpError(409, 'trial_used', { clientId });
  }

  if ((await activeBookingCount(tx, slot.id)) >= slot.capacity) throw new HttpError(409, 'slot_full');

  const [b] = await tx.insert(bookings).values({ slotId: slot.id, clientId, isTrial }).returning();
  return b!;
}

export async function lockSlot(tx: Tx, id: number) {
  const [slot] = await tx.select().from(slots).where(eq(slots.id, id)).for('update');
  if (!slot) throw new HttpError(404, 'not_found');
  return slot;
}

/** Слоти з активними записами — повна версія для тренера. */
async function loadTrainerSlots(q: Q, where: SQL | undefined) {
  const rows = await q.select().from(slots).where(where).orderBy(asc(slots.startsAt), asc(slots.id));
  if (rows.length === 0) return [];
  const bs = await q
    .select({
      id: bookings.id,
      slotId: bookings.slotId,
      clientId: bookings.clientId,
      name: clients.name,
      status: bookings.status,
      isTrial: bookings.isTrial,
      deducted: bookings.deducted,
      passId: bookings.passId,
    })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .where(and(inArray(bookings.slotId, rows.map((r) => r.id)), ne(bookings.status, 'CANCELLED')))
    .orderBy(asc(bookings.id));
  return rows.map((s) => {
    const list = bs.filter((b) => b.slotId === s.id).map(({ slotId, ...b }) => b);
    return { ...s, bookings: list, bookedCount: list.length };
  });
}

export async function loadTrainerSlot(q: Q, id: number) {
  const [s] = await loadTrainerSlots(q, eq(slots.id, id));
  if (!s) throw new HttpError(404, 'not_found');
  return s;
}

/** Створює слоти й записи серії; дати з перетинами пропускає. */
async function createSeriesSlots(
  tx: Tx,
  s: { id: number; clientId: number; weekdays: number[]; startTime: string; durationMin: number },
  startDate: string,
  endDate: string,
) {
  const created: number[] = [];
  const skipped: string[] = [];
  for (const date of datesForWeekdays(startDate, endDate, s.weekdays)) {
    const startsAt = kyivToDate(date, s.startTime);
    if ((await findOverlaps(tx, startsAt, s.durationMin)).length > 0) {
      skipped.push(date);
      continue;
    }
    const [slot] = await tx
      .insert(slots)
      .values({ startsAt, durationMin: s.durationMin, type: 'INDIVIDUAL', capacity: 1, seriesId: s.id })
      .returning();
    await tx.insert(bookings).values({ slotId: slot!.id, clientId: s.clientId });
    created.push(slot!.id);
  }
  return { created: created.length, skipped };
}

/** Скасовує майбутні (від fromDate) слоти серії. */
async function cancelSeriesFrom(tx: Tx, seriesId: number, fromDate: string) {
  const from = kyivDayStart(fromDate);
  const affected = await tx
    .update(slots)
    .set({ status: 'CANCELLED' })
    .where(and(eq(slots.seriesId, seriesId), eq(slots.status, 'OPEN'), gte(slots.startsAt, from)))
    .returning({ id: slots.id });
  if (affected.length) {
    await tx
      .update(bookings)
      .set({ status: 'CANCELLED' })
      .where(and(inArray(bookings.slotId, affected.map((a) => a.id)), eq(bookings.status, 'BOOKED')));
  }
  return affected.map((a) => a.id);
}

function validateSeriesSpan(startDate: string, endDate: string) {
  const span = daysBetween(startDate, endDate);
  if (span < 0) throw new HttpError(400, 'end_before_start');
  if (span > MAX_SERIES_DAYS) throw new HttpError(400, 'series_too_long');
}

export function registerCalendarRoutes(app: FastifyInstance, db: Db, hooks: CalendarHooks = {}, now: () => Date = () => new Date()) {
  const trainerOnly = { preHandler: requireTrainer };

  /**
   * Календар на період. Тренер бачить імена; клієнти й гості — лише «вільно / зайнято»
   * та власні записи, і лише починаючи з сьогоднішнього дня (історію календаря не видно).
   */
  app.get('/api/calendar', async (req) => {
    const { from: requested, to } = parse(rangeQuery, req.query, 'invalid_query');
    if (to <= requested || to.getTime() - requested.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new HttpError(400, 'invalid_range');
    }
    const u = req.authUser!;
    const today = kyivDayStart(kyivDate(now()));
    const from = u.role === 'TRAINER' || requested >= today ? requested : today;
    if (from >= to) return { slots: [] };
    const where = and(eq(slots.status, 'OPEN'), gte(slots.startsAt, from), lt(slots.startsAt, to));
    const list = await loadTrainerSlots(db, where);
    if (u.role === 'TRAINER') return { slots: list };

    const myClientId = u.client?.id ?? null;
    const waiting = myClientId ? await myWaitlistSlotIds(db, myClientId, list.map((s) => s.id)) : new Set<number>();
    return {
      slots: list.map((s) => {
        const mine = s.bookings.find((b) => b.clientId === myClientId);
        return {
          id: s.id,
          startsAt: s.startsAt,
          durationMin: s.durationMin,
          type: s.type,
          capacity: s.capacity,
          freeSeats: Math.max(0, s.capacity - s.bookedCount),
          mine: Boolean(mine),
          waiting: waiting.has(s.id),
        };
      }),
    };
  });

  app.get('/api/slots/:id', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    return { slot: { ...(await loadTrainerSlot(db, id)), waitlist: await loadWaitlist(db, id) } };
  });

  app.post('/api/slots', trainerOnly, async (req, reply) => {
    const b = parse(slotCreate, req.body);
    const capacity = b.type === 'INDIVIDUAL' ? 1 : (b.capacity ?? 0);
    if (b.type === 'GROUP' && capacity < 2) throw new HttpError(400, 'capacity_required');
    if (b.clientIds.length > capacity) throw new HttpError(409, 'slot_full');
    if (b.isTrial && (b.type !== 'INDIVIDUAL' || b.clientIds.length !== 1)) {
      throw new HttpError(400, 'trial_needs_one_client');
    }

    const id = await db.transaction(async (tx) => {
      await assertNoOverlap(tx, b.startsAt, b.durationMin, b.force);
      const [slot] = await tx
        .insert(slots)
        .values({ startsAt: b.startsAt, durationMin: b.durationMin, type: b.type, capacity, note: b.note || null })
        .returning();
      for (const clientId of new Set(b.clientIds)) await addBooking(tx, slot!, clientId, b.isTrial);
      return slot!.id;
    });
    return reply.code(201).send({ slot: await loadTrainerSlot(db, id) });
  });

  app.patch('/api/slots/:id', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const b = parse(slotPatch, req.body);
    await db.transaction(async (tx) => {
      const slot = await lockSlot(tx, id);
      if (slot.status !== 'OPEN') throw new HttpError(409, 'slot_cancelled');
      const startsAt = b.startsAt ?? slot.startsAt;
      const durationMin = b.durationMin ?? slot.durationMin;
      if (b.startsAt || b.durationMin) await assertNoOverlap(tx, startsAt, durationMin, b.force ?? false, id);

      let capacity = slot.capacity;
      if (b.capacity !== undefined) {
        if (slot.type === 'INDIVIDUAL' && b.capacity !== 1) throw new HttpError(400, 'individual_capacity');
        if (slot.type === 'GROUP' && b.capacity < 2) throw new HttpError(400, 'capacity_required');
        if (b.capacity < (await activeBookingCount(tx, id))) throw new HttpError(409, 'capacity_below_bookings');
        capacity = b.capacity;
      }
      await tx
        .update(slots)
        .set({ startsAt, durationMin, capacity, note: b.note === undefined ? slot.note : b.note || null })
        .where(eq(slots.id, id));
    });
    const updated = await loadTrainerSlot(db, id);
    await hooks.onSeatsFreed?.(id);
    return { slot: updated };
  });

  app.post('/api/slots/:id/cancel', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    await db.transaction(async (tx) => {
      const slot = await lockSlot(tx, id);
      if (slot.status === 'CANCELLED') return;
      await tx.update(slots).set({ status: 'CANCELLED' }).where(eq(slots.id, id));
      await tx
        .update(bookings)
        .set({ status: 'CANCELLED' })
        .where(and(eq(bookings.slotId, id), eq(bookings.status, 'BOOKED')));
    });
    return { ok: true };
  });

  app.post('/api/slots/:id/bookings', trainerOnly, async (req, reply) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const b = parse(bookingCreate, req.body);
    await db.transaction(async (tx) => {
      const slot = await lockSlot(tx, id);
      if (b.isTrial && slot.type !== 'INDIVIDUAL') throw new HttpError(400, 'trial_needs_one_client');
      await addBooking(tx, slot, b.clientId, b.isTrial);
    });
    await hooks.onBooked?.(id, b.clientId);
    return reply.code(201).send({ slot: await loadTrainerSlot(db, id) });
  });

  app.post('/api/series', trainerOnly, async (req, reply) => {
    const b = parse(seriesCreate, req.body);
    validateSeriesSpan(b.startDate, b.endDate);
    const result = await db.transaction(async (tx) => {
      const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, b.clientId));
      if (!client) throw new HttpError(404, 'client_not_found');
      const [s] = await tx.insert(series).values(b).returning();
      return { series: s!, ...(await createSeriesSlots(tx, s!, b.startDate, b.endDate)) };
    });
    return reply.code(201).send(result);
  });

  app.get('/api/series/:id', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const [s] = await db.select().from(series).where(eq(series.id, id));
    if (!s) throw new HttpError(404, 'not_found');
    return { series: s };
  });

  app.post('/api/series/:id/cancel', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const { fromDate } = parse(seriesCancel, req.body);
    const cancelled = await db.transaction(async (tx) => {
      const [s] = await tx.select().from(series).where(eq(series.id, id)).for('update');
      if (!s) throw new HttpError(404, 'not_found');
      const ids = await cancelSeriesFrom(tx, id, fromDate);
      const newEnd = addDays(fromDate, -1);
      if (newEnd < s.endDate) await tx.update(series).set({ endDate: newEnd < s.startDate ? s.startDate : newEnd }).where(eq(series.id, id));
      return ids;
    });
    for (const slotId of cancelled) await hooks.onSeatsFreed?.(slotId);
    return { cancelled: cancelled.length };
  });

  /** «Змінити це й наступні»: скасовує серію від дати й створює нову з новими параметрами. */
  app.post('/api/series/:id/split', trainerOnly, async (req, reply) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const b = parse(seriesSplit, req.body);
    validateSeriesSpan(b.fromDate, b.endDate);
    const result = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(series).where(eq(series.id, id)).for('update');
      if (!old) throw new HttpError(404, 'not_found');
      await cancelSeriesFrom(tx, id, b.fromDate);
      const newEnd = addDays(b.fromDate, -1);
      await tx.update(series).set({ endDate: newEnd < old.startDate ? old.startDate : newEnd }).where(eq(series.id, id));
      const [s] = await tx
        .insert(series)
        .values({
          clientId: old.clientId,
          weekdays: b.weekdays,
          startTime: b.startTime,
          durationMin: b.durationMin,
          startDate: b.fromDate,
          endDate: b.endDate,
        })
        .returning();
      return { series: s!, ...(await createSeriesSlots(tx, s!, b.fromDate, b.endDate)) };
    });
    return reply.code(201).send(result);
  });

  /** Копіює разові (не серійні) слоти тижня на інший тиждень — без учасників. */
  app.post('/api/calendar/copy-week', trainerOnly, async (req) => {
    const b = parse(copyWeek, req.body);
    const shift = daysBetween(b.from, b.to);
    if (shift === 0) throw new HttpError(400, 'same_week');
    return db.transaction(async (tx) => {
      const source = await tx
        .select()
        .from(slots)
        .where(
          and(
            eq(slots.status, 'OPEN'),
            sql`${slots.seriesId} is null`,
            gte(slots.startsAt, kyivDayStart(b.from)),
            lt(slots.startsAt, kyivDayStart(addDays(b.from, 7))),
          ),
        )
        .orderBy(asc(slots.startsAt));
      let created = 0;
      const skipped: string[] = [];
      for (const s of source) {
        const date = addDays(kyivDate(s.startsAt), shift);
        const startsAt = kyivToDate(date, kyivTime(s.startsAt));
        if ((await findOverlaps(tx, startsAt, s.durationMin)).length > 0) {
          skipped.push(startsAt.toISOString());
          continue;
        }
        await tx.insert(slots).values({
          startsAt,
          durationMin: s.durationMin,
          type: s.type,
          capacity: s.capacity,
          note: s.note,
        });
        created++;
      }
      return { created, skipped };
    });
  });
}

/** Точки розширення для бота (етап 5): звільнилось місце, з'явився запис. */
export type CalendarHooks = {
  onSeatsFreed?: (slotId: number) => Promise<void>;
  onBooked?: (slotId: number, clientId: number) => Promise<void>;
};
