import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const languageBody = z.object({ language: z.enum(['uk', 'ru']) });

const onboardingBody = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/)
    .optional(),
  goal: z.enum(['weight_loss', 'muscle_gain', 'strength', 'health', 'other']),
  experience: z.enum(['none', 'beginner', 'intermediate', 'advanced']),
  health: z.string().trim().max(1000).optional(),
  injuries: z.string().trim().max(1000).optional(),
  consent: z.literal(true),
});

export function registerMeRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get('/api/me', async (req) => {
    const u = req.authUser!;
    const client = await prisma.client.findUnique({ where: { userId: u.id } });
    return {
      user: {
        id: u.id,
        role: u.effectiveRole,
        language: u.language,
        firstName: u.firstName,
      },
      client: client && {
        id: client.id,
        name: client.name,
        status: client.status,
      },
      needsOnboarding: u.effectiveRole !== 'TRAINER' && !client,
    };
  });

  app.patch('/api/me/language', async (req, reply) => {
    const parsed = languageBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const user = await prisma.user.update({
      where: { id: req.authUser!.id },
      data: { language: parsed.data.language },
    });
    return { language: user.language };
  });

  app.post('/api/onboarding', async (req, reply) => {
    const u = req.authUser!;
    if (u.effectiveRole === 'TRAINER') return reply.code(400).send({ error: 'not_applicable' });

    const parsed = onboardingBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    }
    const existing = await prisma.client.findUnique({ where: { userId: u.id } });
    if (existing) return reply.code(409).send({ error: 'already_submitted' });

    const b = parsed.data;
    const client = await prisma.client.create({
      data: {
        userId: u.id,
        name: b.name,
        phone: b.phone ?? null,
        goal: b.goal,
        experience: b.experience,
        health: b.health || null,
        injuries: b.injuries || null,
        consentAt: new Date(),
        status: 'GUEST',
      },
    });
    return reply.code(201).send({ client: { id: client.id, name: client.name, status: client.status } });
  });
}
