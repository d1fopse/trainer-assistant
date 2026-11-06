import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { clients, users } from '../db/schema.js';
import { GOALS, LEVELS, phoneSchema } from './validation.js';

const languageBody = z.object({ language: z.enum(['uk', 'ru']) });

const onboardingBody = z.object({
  name: z.string().trim().min(1).max(100),
  phone: phoneSchema.optional(),
  goal: z.enum(GOALS),
  experience: z.enum(LEVELS),
  health: z.string().trim().max(1000).optional(),
  injuries: z.string().trim().max(1000).optional(),
  consent: z.literal(true),
});

/** Username тренера в Telegram — для кнопки «Записатися у тренера». */
async function trainerUsername(db: Db, config: Config): Promise<string | null> {
  const ids = [...config.trainerIds].filter((s) => /^\d+$/.test(s)).map((s) => BigInt(s));
  if (ids.length === 0) return null;
  const [row] = await db
    .select({ username: users.username })
    .from(users)
    .where(and(inArray(users.telegramId, ids), isNotNull(users.username)))
    .limit(1);
  return row?.username ?? null;
}

export function registerMeRoutes(app: FastifyInstance, db: Db, config: Config) {
  app.get('/api/me', async (req) => {
    const u = req.authUser!;
    return {
      user: { id: u.id, role: u.role, language: u.language, firstName: u.firstName },
      client: u.client && { id: u.client.id, name: u.client.name, status: u.client.status },
      needsOnboarding: u.role !== 'TRAINER' && !u.client,
      trainerUsername: await trainerUsername(db, config),
    };
  });

  app.patch('/api/me/language', async (req, reply) => {
    const parsed = languageBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const [user] = await db
      .update(users)
      .set({ language: parsed.data.language })
      .where(eq(users.id, req.authUser!.id))
      .returning();
    return { language: user!.language };
  });

  app.post('/api/onboarding', async (req, reply) => {
    const u = req.authUser!;
    if (u.role === 'TRAINER') return reply.code(400).send({ error: 'not_applicable' });

    const parsed = onboardingBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    if (u.client) return reply.code(409).send({ error: 'already_submitted' });

    const b = parsed.data;
    const [client] = await db
      .insert(clients)
      .values({
        userId: u.id,
        name: b.name,
        phone: b.phone || null,
        goal: b.goal,
        experience: b.experience,
        health: b.health || null,
        injuries: b.injuries || null,
        consentAt: new Date(),
        status: 'GUEST',
      })
      .onConflictDoNothing({ target: clients.userId })
      .returning();
    if (!client) return reply.code(409).send({ error: 'already_submitted' });
    return reply.code(201).send({ client: { id: client.id, name: client.name, status: client.status } });
  });
}
