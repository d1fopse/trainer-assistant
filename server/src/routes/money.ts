import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { auditLog, bookings, clients, passes, payments, slots, type Booking } from '../db/schema.js';
import { requireTrainer } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { TIME_RE, isValidDate, kyivDate, kyivToDate } from '../time.js';
import { assertNoOverlap, loadTrainerSlot, type CalendarHooks, type Q, type Tx } from './calendar.js';
import { idParam, optionalText } from './validation.js';

const localDate = z.string().refine(isValidDate, 'invalid date');
const METHODS = ['CASH', 'CARD', 'TRANSFER'] as const;
const PURPOSES = ['PASS', 'SINGLE', 'TRIAL', 'OTHER'] as const;
const STATUSES = ['BOOKED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'] as const;

const markBody = z.object({ status: z.enum(STATUSES), deduct: z.boolean().optional() }).strict();

const passFields = {
  totalSessions: z.number().int().min(1).max(500),
  remaining: z.number().int().min(0).max(500),
  expiresAt: localDate.nullable(),
  note: optionalText(500),
};
const passPatch = z.object(passFields).partial().strict();

const paymentFields = {
  amountUah: z.number().int().min(0).max(10_000_000),
  paidAt: localDate,
  method: z.enum(METHODS),
  purpose: z.enum(PURPOSES),
  note: optionalText(500),
};
const paymentCreate = z.object({
  ...paymentFields,
  note: paymentFields.note.optional(),
  /** Для оплати абонемента — одразу створити абонемент. */
  pass: z
    .object({ totalSessions: passFields.totalSessions, expiresAt: localDate.nullable().optional() })
    .optional(),
});
const paymentPatch = z.object(paymentFields).partial().strict();

const visitCreate = z.object({
  date: localDate,
  time: z.string().regex(TIME_RE),
  durationMin: z.number().int().min(15).max(300).default(60),
  status: z.enum(['ATTENDED', 'NO_SHOW']),
  isTrial: z.boolean().default(false),
  deduct: z.boolean().optional(),
});

export const today = () => kyivDate(new Date());

export async function audit(
  q: Q,
  clientId: number | null,
  entity: string,
  entityId: number | null,
  action: string,
  details: Record<string, unknown> = {},
) {
  await q.insert(auditLog).values({ clientId, entity, entityId, action, details });
}

/** Абонемент, з якого списувати: найстаріший активний на дату заняття. */
async function pickPass(tx: Tx, clientId: number, onDate: string) {
  const [p] = await tx
    .select()
    .from(passes)
    .where(
      and(
        eq(passes.clientId, clientId),
        sql`${passes.remaining} > 0`,
        or(isNull(passes.expiresAt), gte(passes.expiresAt, onDate)),
      ),
    )
    .orderBy(asc(passes.purchasedAt), asc(passes.id))
    .limit(1)
    .for('update');
  return p ?? null;
}

/** Повертає заняття в абонемент, якщо його було списано. */
async function refund(tx: Tx, b: Booking) {
  if (!b.deducted) return;
  if (b.passId) {
    await tx
      .update(passes)
      .set({ remaining: sql`${passes.remaining} + 1` })
      .where(eq(passes.id, b.passId));
  }
  await tx.update(bookings).set({ deducted: false, passId: null }).where(eq(bookings.id, b.id));
}

/**
 * Відмітка запису. «Прийшов» списує заняття автоматично (крім пробного),
 * «Неявка» — лише якщо тренер вирішив списати. Попереднє списання завжди повертається.
 */
export async function markBooking(tx: Tx, bookingId: number, status: (typeof STATUSES)[number], deductNoShow?: boolean) {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
  if (!b) throw new HttpError(404, 'not_found');
  const [slot] = await tx.select().from(slots).where(eq(slots.id, b.slotId));

  if (status !== 'CANCELLED' && b.status === 'CANCELLED') {
    // Відновлення скасованого запису — лише якщо є місце.
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.slotId, b.slotId), ne(bookings.status, 'CANCELLED')));
    if ((r?.n ?? 0) >= slot!.capacity) throw new HttpError(409, 'slot_full');
  }

  await refund(tx, b);

  const wantDeduct = !b.isTrial && (status === 'ATTENDED' || (status === 'NO_SHOW' && deductNoShow === true));
  let passId: number | null = null;
  let warning: string | undefined;
  if (wantDeduct) {
    const pass = await pickPass(tx, b.clientId, kyivDate(slot!.startsAt));
    if (pass) {
      await tx
        .update(passes)
        .set({ remaining: sql`${passes.remaining} - 1` })
        .where(eq(passes.id, pass.id));
      passId = pass.id;
    } else {
      warning = 'no_active_pass';
    }
  }

  const [updated] = await tx
    .update(bookings)
    .set({
      status,
      deducted: passId !== null,
      passId,
      markedAt: status === 'ATTENDED' || status === 'NO_SHOW' ? new Date() : null,
    })
    .where(eq(bookings.id, bookingId))
    .returning();

  await audit(tx, b.clientId, 'booking', b.id, 'mark', {
    from: b.status,
    to: status,
    slotStartsAt: slot!.startsAt.toISOString(),
    deducted: passId !== null,
    passId,
    refundedPassId: b.deducted ? b.passId : null,
  });
  return { booking: updated!, warning, prevStatus: b.status };
}

/** Невідмічені зі списанням «прийшов» без абонемента (крім пробних). */
function unpaidWhere(clientId: number) {
  return and(
    eq(bookings.clientId, clientId),
    eq(bookings.status, 'ATTENDED'),
    eq(bookings.isTrial, false),
    eq(bookings.deducted, false),
  );
}

export async function clientSummary(q: Q, clientId: number) {
  const d = today();
  const passRows = await q
    .select()
    .from(passes)
    .where(eq(passes.clientId, clientId))
    .orderBy(desc(passes.purchasedAt), desc(passes.id));
  const active = passRows.filter((p) => p.remaining > 0 && (!p.expiresAt || p.expiresAt >= d));
  const [counts] = await q
    .select({
      attended: sql<number>`count(*) filter (where ${bookings.status} = 'ATTENDED')::int`,
      noShows: sql<number>`count(*) filter (where ${bookings.status} = 'NO_SHOW')::int`,
      unpaid: sql<number>`count(*) filter (where ${bookings.status} = 'ATTENDED' and not ${bookings.isTrial} and not ${bookings.deducted})::int`,
      trial: sql<string | null>`max(case when ${bookings.isTrial} and ${bookings.status} <> 'CANCELLED' then ${bookings.status}::text end)`,
    })
    .from(bookings)
    .where(eq(bookings.clientId, clientId));
  return {
    remaining: active.reduce((n, p) => n + p.remaining, 0),
    activePasses: active,
    passes: passRows,
    attended: counts?.attended ?? 0,
    noShows: counts?.noShows ?? 0,
    unpaid: counts?.unpaid ?? 0,
    trialStatus: counts?.trial ?? null,
  };
}

async function visits(q: Q, clientId: number, limit: number) {
  return q
    .select({
      bookingId: bookings.id,
      slotId: slots.id,
      startsAt: slots.startsAt,
      durationMin: slots.durationMin,
      type: slots.type,
      slotStatus: slots.status,
      status: bookings.status,
      isTrial: bookings.isTrial,
      deducted: bookings.deducted,
      passId: bookings.passId,
      markedAt: bookings.markedAt,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(eq(bookings.clientId, clientId))
    .orderBy(desc(slots.startsAt))
    .limit(limit);
}

async function requireClient(q: Q, id: number) {
  const [c] = await q.select({ id: clients.id }).from(clients).where(eq(clients.id, id));
  if (!c) throw new HttpError(404, 'not_found');
}

/** Списує неоплачені відвідування з абонементів (від найстаріших). */
async function applyUnpaid(tx: Tx, clientId: number) {
  const rows = await tx
    .select({ id: bookings.id, startsAt: slots.startsAt })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(unpaidWhere(clientId))
    .orderBy(asc(slots.startsAt))
    .for('update', { of: bookings });
  let applied = 0;
  for (const r of rows) {
    const pass = await pickPass(tx, clientId, kyivDate(r.startsAt));
    if (!pass) break;
    await tx.update(passes).set({ remaining: sql`${passes.remaining} - 1` }).where(eq(passes.id, pass.id));
    await tx.update(bookings).set({ deducted: true, passId: pass.id }).where(eq(bookings.id, r.id));
    applied++;
  }
  if (applied) await audit(tx, clientId, 'booking', null, 'apply_unpaid', { applied });
  return applied;
}

export function registerMoneyRoutes(app: FastifyInstance, db: Db, hooks: CalendarHooks = {}) {
  const trainerOnly = { preHandler: requireTrainer };

  /** Відмітка запису: прийшов / неявка / скасовано / повернути в «записаний». */
  app.patch('/api/bookings/:id', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const b = parse(markBody, req.body);
    const r = await db.transaction((tx) => markBooking(tx, id, b.status, b.deduct));
    if (b.status === 'CANCELLED' && r.prevStatus !== 'CANCELLED') await hooks.onSeatsFreed?.(r.booking.slotId);
    return {
      slot: await loadTrainerSlot(db, r.booking.slotId),
      ...(r.warning ? { warning: r.warning } : {}),
    };
  });

  /** Абонементи, платежі, відвідування й журнал клієнта — для картки тренера. */
  app.get('/api/clients/:id/history', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    await requireClient(db, id);
    const [summary, visitRows, paymentRows, auditRows] = await Promise.all([
      clientSummary(db, id),
      visits(db, id, 200),
      db.select().from(payments).where(eq(payments.clientId, id)).orderBy(desc(payments.paidAt), desc(payments.id)),
      db.select().from(auditLog).where(eq(auditLog.clientId, id)).orderBy(desc(auditLog.id)).limit(50),
    ]);
    return { summary, visits: visitRows, payments: paymentRows, audit: auditRows };
  });

  /** Ручне відвідування в минулому (поза календарем). */
  app.post('/api/clients/:id/visits', trainerOnly, async (req, reply) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const b = parse(visitCreate, req.body);
    const startsAt = kyivToDate(b.date, b.time);
    const r = await db.transaction(async (tx) => {
      await requireClient(tx, id);
      if (b.isTrial) {
        const [t] = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.clientId, id), eq(bookings.isTrial, true), ne(bookings.status, 'CANCELLED')));
        if (t) throw new HttpError(409, 'trial_used');
      }
      // Ручне відвідування може перетинатися з іншими слотами — тренеру видніше.
      await assertNoOverlap(tx, startsAt, b.durationMin, true);
      const [slot] = await tx
        .insert(slots)
        .values({ startsAt, durationMin: b.durationMin, type: 'INDIVIDUAL', capacity: 1 })
        .returning();
      const [booking] = await tx
        .insert(bookings)
        .values({ slotId: slot!.id, clientId: id, isTrial: b.isTrial })
        .returning();
      return markBooking(tx, booking!.id, b.status, b.deduct);
    });
    return reply.code(201).send({ booking: r.booking, ...(r.warning ? { warning: r.warning } : {}) });
  });

  app.post('/api/clients/:id/apply-unpaid', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const applied = await db.transaction(async (tx) => {
      await requireClient(tx, id);
      return applyUnpaid(tx, id);
    });
    return { applied, summary: await clientSummary(db, id) };
  });

  app.post('/api/clients/:id/payments', trainerOnly, async (req, reply) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const b = parse(paymentCreate, req.body);
    if (b.pass && b.purpose !== 'PASS') throw new HttpError(400, 'pass_only_for_pass_payment');
    const result = await db.transaction(async (tx) => {
      await requireClient(tx, id);
      const [payment] = await tx
        .insert(payments)
        .values({
          clientId: id,
          amountUah: b.amountUah,
          paidAt: b.paidAt,
          method: b.method,
          purpose: b.purpose,
          note: b.note ?? null,
        })
        .returning();
      await audit(tx, id, 'payment', payment!.id, 'create', { amountUah: b.amountUah, purpose: b.purpose });
      let pass = null;
      if (b.pass) {
        [pass] = await tx
          .insert(passes)
          .values({
            clientId: id,
            totalSessions: b.pass.totalSessions,
            remaining: b.pass.totalSessions,
            purchasedAt: b.paidAt,
            expiresAt: b.pass.expiresAt ?? null,
            paymentId: payment!.id,
          })
          .returning();
        await audit(tx, id, 'pass', pass!.id, 'create', { totalSessions: b.pass.totalSessions });
      }
      return { payment: payment!, pass };
    });
    return reply.code(201).send({ ...result, summary: await clientSummary(db, id) });
  });

  app.patch('/api/payments/:id', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const b = parse(paymentPatch, req.body);
    const payment = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
      if (!old) throw new HttpError(404, 'not_found');
      const [p] = await tx.update(payments).set(b).where(eq(payments.id, id)).returning();
      await audit(tx, old.clientId, 'payment', id, 'update', { before: pick(old, b), after: b });
      return p!;
    });
    return { payment };
  });

  app.delete('/api/payments/:id', trainerOnly, async (req, reply) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    await db.transaction(async (tx) => {
      const [old] = await tx.delete(payments).where(eq(payments.id, id)).returning();
      if (!old) throw new HttpError(404, 'not_found');
      await audit(tx, old.clientId, 'payment', id, 'delete', { amountUah: old.amountUah, paidAt: old.paidAt });
    });
    return reply.code(204).send();
  });

  /** Абонемент без оплати (подарунок, перенесення з паперового обліку тощо). */
  app.post('/api/clients/:id/passes', trainerOnly, async (req, reply) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const b = parse(
      z.object({
        totalSessions: passFields.totalSessions,
        remaining: passFields.remaining.optional(),
        purchasedAt: localDate.optional(),
        expiresAt: localDate.nullable().optional(),
        note: passFields.note.optional(),
      }),
      req.body,
    );
    const pass = await db.transaction(async (tx) => {
      await requireClient(tx, id);
      const [p] = await tx
        .insert(passes)
        .values({
          clientId: id,
          totalSessions: b.totalSessions,
          remaining: b.remaining ?? b.totalSessions,
          purchasedAt: b.purchasedAt ?? today(),
          expiresAt: b.expiresAt ?? null,
          note: b.note ?? null,
        })
        .returning();
      await audit(tx, id, 'pass', p!.id, 'create', { totalSessions: b.totalSessions, remaining: p!.remaining });
      return p!;
    });
    return reply.code(201).send({ pass, summary: await clientSummary(db, id) });
  });

  app.patch('/api/passes/:id', trainerOnly, async (req) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    const b = parse(passPatch, req.body);
    const pass = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(passes).where(eq(passes.id, id)).for('update');
      if (!old) throw new HttpError(404, 'not_found');
      const [p] = await tx.update(passes).set(b).where(eq(passes.id, id)).returning();
      await audit(tx, old.clientId, 'pass', id, 'update', { before: pick(old, b), after: b });
      return p!;
    });
    return { pass, summary: await clientSummary(db, pass.clientId) };
  });

  app.delete('/api/passes/:id', trainerOnly, async (req, reply) => {
    const { id } = parse(idParam, req.params, 'invalid_id');
    await db.transaction(async (tx) => {
      const [old] = await tx.select().from(passes).where(eq(passes.id, id)).for('update');
      if (!old) throw new HttpError(404, 'not_found');
      // Заняття, списані з цього абонемента, стають «без абонемента».
      await tx.update(bookings).set({ deducted: false, passId: null }).where(eq(bookings.passId, id));
      await tx.delete(passes).where(eq(passes.id, id));
      await audit(tx, old.clientId, 'pass', id, 'delete', { totalSessions: old.totalSessions, remaining: old.remaining });
    });
    return reply.code(204).send();
  });

  /** Для клієнта: залишок занять, найближчі записи й історія відвідувань. */
  app.get('/api/me/summary', async (req) => {
    const c = req.authUser!.client;
    if (!c) return { summary: null, upcoming: [], history: [] };
    const [summary, rows] = await Promise.all([clientSummary(db, c.id), visits(db, c.id, 100)]);
    const now = Date.now();
    const visible = rows.filter((r) => r.status !== 'CANCELLED' && r.slotStatus === 'OPEN');
    return {
      summary: {
        remaining: summary.remaining,
        activePasses: summary.activePasses.map(({ id, totalSessions, remaining, expiresAt }) => ({
          id,
          totalSessions,
          remaining,
          expiresAt,
        })),
        attended: summary.attended,
      },
      upcoming: visible.filter((r) => r.startsAt.getTime() >= now && r.status === 'BOOKED').reverse(),
      history: visible
        .filter((r) => r.status === 'ATTENDED' || r.status === 'NO_SHOW')
        .map(({ startsAt, durationMin, type, status, isTrial }) => ({ startsAt, durationMin, type, status, isTrial })),
    };
  });
}

function pick<T extends Record<string, unknown>>(obj: T, keysFrom: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(keysFrom).map((k) => [k, obj[k]]));
}
