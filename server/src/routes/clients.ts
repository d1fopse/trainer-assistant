import type { FastifyInstance } from 'fastify';
import { and, asc, eq, ilike, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { auditLog, bookings, clients, passes, payments, series, users, type Client } from '../db/schema.js';
import { requireTrainer } from '../auth.js';
import { GOALS, LEVELS, idParam, optionalText, phoneSchema } from './validation.js';

const STATUSES = ['GUEST', 'ACTIVE', 'INACTIVE'] as const;

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  /** Лише картки без Telegram (для вибору при прив'язці). */
  withoutTelegram: z.enum(['true', 'false']).optional(),
  /** Лише картки з Telegram. */
  withTelegram: z.enum(['true', 'false']).optional(),
});

const editableFields = {
  name: z.string().trim().min(1).max(100),
  phone: phoneSchema.transform((s) => (s === '' ? null : s)).nullable(),
  status: z.enum(STATUSES),
  goal: z.enum(GOALS).nullable(),
  experience: z.enum(LEVELS).nullable(),
  health: optionalText(1000),
  injuries: optionalText(1000),
  trainerNotes: optionalText(5000),
  referredByClientId: z.number().int().positive().nullable(),
};

const createBody = z.object(editableFields).partial().required({ name: true });
const patchBody = z.object(editableFields).partial().strict();
const linkBody = z.object({ sourceClientId: z.number().int().positive() });

const listColumns = {
  id: clients.id,
  name: clients.name,
  phone: clients.phone,
  status: clients.status,
  createdAt: clients.createdAt,
  username: users.username,
  hasTelegram: sql<boolean>`${clients.userId} is not null`,
  /** Залишок занять в активних абонементах; null — абонементів немає. */
  remaining: sql<number | null>`(
    select sum(p.remaining)::int from passes p
    where p.client_id = ${clients.id} and p.remaining > 0
      and (p.expires_at is null or p.expires_at >= (now() at time zone 'Europe/Kyiv')::date)
  )`,
};

async function loadCard(db: Db, id: number) {
  const [row] = await db
    .select({ client: clients, username: users.username, tgFirstName: users.firstName })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.userId))
    .where(eq(clients.id, id));
  if (!row) return null;

  const c = row.client;
  const [referredBy] = c.referredByClientId
    ? await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(eq(clients.id, c.referredByClientId))
    : [];
  const referrals = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.referredByClientId, c.id))
    .orderBy(asc(clients.name));

  const { userId, ...rest } = c;
  return {
    ...rest,
    telegram: userId ? { username: row.username, firstName: row.tgFirstName } : null,
    referredBy: referredBy ?? null,
    referrals,
  };
}

/** Перевіряє, що реферер існує і не є самим клієнтом. */
async function validReferrer(db: Db, clientId: number | null, referrerId: number | null | undefined) {
  if (referrerId == null) return true;
  if (referrerId === clientId) return false;
  const [r] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, referrerId));
  return Boolean(r);
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Переносить записи, серії (а з наступних етапів — абонементи й платежі) з картки на картку. */
async function moveClientData(tx: Tx, fromId: number, toId: number) {
  // Якщо обидві картки записані на той самий слот — лишаємо запис основної.
  await tx.execute(sql`
    update bookings b set status = 'CANCELLED'
    where b.client_id = ${fromId} and b.status <> 'CANCELLED'
      and exists (select 1 from bookings t where t.slot_id = b.slot_id and t.client_id = ${toId} and t.status <> 'CANCELLED')`);
  // Пробне заняття може бути лише одне.
  const [toTrial] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.clientId, toId), eq(bookings.isTrial, true), ne(bookings.status, 'CANCELLED')));
  if (toTrial) await tx.update(bookings).set({ isTrial: false }).where(eq(bookings.clientId, fromId));
  await tx.update(bookings).set({ clientId: toId }).where(eq(bookings.clientId, fromId));
  await tx.update(series).set({ clientId: toId }).where(eq(series.clientId, fromId));
  await tx.update(passes).set({ clientId: toId }).where(eq(passes.clientId, fromId));
  await tx.update(payments).set({ clientId: toId }).where(eq(payments.clientId, fromId));
  await tx.update(auditLog).set({ clientId: toId }).where(eq(auditLog.clientId, fromId));
}

export function registerClientRoutes(app: FastifyInstance, db: Db) {
  // Усі маршрути клієнтів — лише для тренера.
  const opts = { preHandler: requireTrainer };

  app.get('/api/clients', opts, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
    const { status, q, withoutTelegram, withTelegram } = parsed.data;

    const where: SQL[] = [];
    if (status) where.push(eq(clients.status, status));
    if (withoutTelegram === 'true') where.push(isNull(clients.userId));
    if (withTelegram === 'true') where.push(isNotNull(clients.userId));
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      const conds = [ilike(clients.name, pattern), ilike(clients.phone, pattern)];
      // Юзернейм Telegram: «@oleg_k», «oleg» — без урахування регістру й «@».
      const handle = q.trim().replace(/^@+/, '');
      if (handle) conds.push(ilike(users.username, `%${handle.replace(/[\\%_]/g, (m) => '\\' + m)}%`));
      // Пошук за цифрами незалежно від пробілів: «0671234», «67 123», «380671…».
      const digits = q.replace(/\D/g, '').replace(/^380|^0/, '');
      if (digits.length >= 3) conds.push(sql`regexp_replace(${clients.phone}, '[^0-9]', '', 'g') like ${`%${digits}%`}`);
      where.push(or(...conds)!);
    }

    const rows = await db
      .select(listColumns)
      .from(clients)
      .leftJoin(users, eq(users.id, clients.userId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(clients.name), asc(clients.id));
    return { clients: rows };
  });

  app.post('/api/clients', opts, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const b = parsed.data;
    if (!(await validReferrer(db, null, b.referredByClientId))) {
      return reply.code(400).send({ error: 'invalid_referrer' });
    }
    // Картку, створену тренером, вважаємо активною, якщо не вказано інше.
    const [created] = await db
      .insert(clients)
      .values({ ...b, status: b.status ?? 'ACTIVE' })
      .returning();
    return reply.code(201).send({ client: await loadCard(db, created!.id) });
  });

  app.get('/api/clients/:id', opts, async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const card = await loadCard(db, p.data.id);
    if (!card) return reply.code(404).send({ error: 'not_found' });
    return { client: card };
  });

  app.patch('/api/clients/:id', opts, async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const id = p.data.id;
    if (!(await validReferrer(db, id, parsed.data.referredByClientId))) {
      return reply.code(400).send({ error: 'invalid_referrer' });
    }
    if (Object.keys(parsed.data).length > 0) {
      const updated = await db
        .update(clients)
        .set(parsed.data)
        .where(eq(clients.id, id))
        .returning({ id: clients.id });
      if (updated.length === 0) return reply.code(404).send({ error: 'not_found' });
    }
    const card = await loadCard(db, id);
    if (!card) return reply.code(404).send({ error: 'not_found' });
    return { client: card };
  });

  /**
   * Прив'язка Telegram: картка гостя (з Telegram, заповнена ним самим) зливається
   * з карткою, яку тренер створив вручну (без Telegram). Історія ручної картки зберігається,
   * порожні поля анкети доповнюються з картки гостя, а сама картка гостя видаляється.
   */
  app.post('/api/clients/:id/link', opts, async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = linkBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const targetId = p.data.id;
    const sourceId = parsed.data.sourceClientId;
    if (targetId === sourceId) return reply.code(400).send({ error: 'same_client' });

    const result = await db.transaction(async (tx) => {
      const [target] = await tx.select().from(clients).where(eq(clients.id, targetId)).for('update');
      const [source] = await tx.select().from(clients).where(eq(clients.id, sourceId)).for('update');
      if (!target || !source) return { error: 'not_found' as const, code: 404 };
      if (target.userId) return { error: 'target_has_telegram' as const, code: 409 };
      if (!source.userId) return { error: 'source_has_no_telegram' as const, code: 409 };

      const fill = <K extends keyof Client>(k: K) => target[k] ?? source[k];

      await moveClientData(tx, sourceId, targetId);

      // Посилання «хто кого запросив» переносимо з картки гостя на основну.
      await tx
        .update(clients)
        .set({ referredByClientId: targetId })
        .where(and(eq(clients.referredByClientId, sourceId), ne(clients.id, targetId)));
      await tx.delete(clients).where(eq(clients.id, sourceId));
      await tx
        .update(clients)
        .set({
          userId: source.userId,
          phone: fill('phone'),
          goal: fill('goal'),
          experience: fill('experience'),
          health: fill('health'),
          injuries: fill('injuries'),
          consentAt: fill('consentAt'),
          referredByClientId:
            target.referredByClientId ??
            (source.referredByClientId === targetId ? null : source.referredByClientId),
        })
        .where(eq(clients.id, targetId));
      return { ok: true as const };
    });

    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return { client: await loadCard(db, targetId) };
  });
}
