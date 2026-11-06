import type { FastifyInstance } from 'fastify';
import { asc, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { prices, type Price } from '../db/schema.js';
import { requireTrainer } from '../auth.js';
import { idParam, optionalText } from './validation.js';

const fields = {
  kind: z.enum(['SINGLE', 'PASS']),
  titleUk: z.string().trim().min(1).max(100),
  titleRu: optionalText(100),
  descriptionUk: optionalText(500),
  descriptionRu: optionalText(500),
  priceUah: z.number().int().min(0).max(1_000_000),
  sessionsCount: z.number().int().min(1).max(500).nullable(),
  isVisible: z.boolean(),
};

const createBody = z.object(fields).partial().required({ kind: true, titleUk: true, priceUah: true });
const patchBody = z.object(fields).partial().strict();
const orderBody = z.object({ ids: z.array(z.number().int().positive()).max(500) });

/** Абонемент обов'язково має кількість занять; у разового її немає. */
function normalizeSessions(kind: Price['kind'], sessionsCount: number | null | undefined) {
  if (kind === 'SINGLE') return { ok: true as const, sessionsCount: null };
  if (sessionsCount == null) return { ok: false as const };
  return { ok: true as const, sessionsCount };
}

export function registerPriceRoutes(app: FastifyInstance, db: Db) {
  const trainerOnly = { preHandler: requireTrainer };

  app.get('/api/prices', async (req) => {
    const isTrainer = req.authUser!.role === 'TRAINER';
    const rows = await db
      .select()
      .from(prices)
      .where(isTrainer ? undefined : eq(prices.isVisible, true))
      .orderBy(asc(prices.sortOrder), asc(prices.id));
    return { prices: rows };
  });

  app.post('/api/prices', trainerOnly, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const b = parsed.data;
    const s = normalizeSessions(b.kind, b.sessionsCount);
    if (!s.ok) return reply.code(400).send({ error: 'sessions_required' });

    const [{ last } = { last: null }] = await db.select({ last: max(prices.sortOrder) }).from(prices);
    const [row] = await db
      .insert(prices)
      .values({ ...b, sessionsCount: s.sessionsCount, sortOrder: (last ?? -1) + 1 })
      .returning();
    return reply.code(201).send({ price: row });
  });

  app.patch('/api/prices/:id', trainerOnly, async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const [current] = await db.select().from(prices).where(eq(prices.id, p.data.id));
    if (!current) return reply.code(404).send({ error: 'not_found' });

    const kind = parsed.data.kind ?? current.kind;
    const s = normalizeSessions(
      kind,
      parsed.data.sessionsCount !== undefined ? parsed.data.sessionsCount : current.sessionsCount,
    );
    if (!s.ok) return reply.code(400).send({ error: 'sessions_required' });

    const [row] = await db
      .update(prices)
      .set({ ...parsed.data, sessionsCount: s.sessionsCount })
      .where(eq(prices.id, p.data.id))
      .returning();
    return { price: row };
  });

  app.delete('/api/prices/:id', trainerOnly, async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const deleted = await db.delete(prices).where(eq(prices.id, p.data.id)).returning({ id: prices.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  /** Новий порядок позицій: ids у потрібній послідовності. */
  app.put('/api/prices/order', trainerOnly, async (req, reply) => {
    const parsed = orderBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { ids } = parsed.data;
    if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: 'duplicate_ids' });

    await db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.update(prices).set({ sortOrder: sql`${index}` }).where(eq(prices.id, id));
      }
    });
    const rows = await db.select().from(prices).orderBy(asc(prices.sortOrder), asc(prices.id));
    return { prices: rows };
  });
}
