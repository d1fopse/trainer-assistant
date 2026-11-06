import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { createAuthHook } from './auth.js';
import { registerMeRoutes } from './routes/me.js';

export async function buildApp(config: Config, prisma: PrismaClient) {
  const app = Fastify({ logger: config.nodeEnv !== 'test' });

  await app.register(cors, {
    origin: config.webOrigin,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  app.get('/health', async () => ({ ok: true }));

  // Усі маршрути /api/* потребують валідного підпису Telegram.
  await app.register(async (api) => {
    api.addHook('preHandler', createAuthHook(prisma, config));
    registerMeRoutes(api, prisma);
  });

  return app;
}
