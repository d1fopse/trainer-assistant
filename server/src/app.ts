import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { createAuthHook } from './auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerPriceRoutes } from './routes/prices.js';
import { registerCalendarRoutes, type CalendarHooks } from './routes/calendar.js';
import { registerErrorHandler } from './http.js';
import { registerMoneyRoutes } from './routes/money.js';

export async function buildApp(config: Config, db: Db, hooks: CalendarHooks = {}) {
  const app = Fastify({ logger: config.nodeEnv !== 'test' });

  await app.register(cors, {
    origin: config.webOrigin,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  registerErrorHandler(app);

  app.get('/health', async () => ({ ok: true }));

  // Усі маршрути /api/* потребують валідного підпису Telegram.
  await app.register(async (api) => {
    api.addHook('preHandler', createAuthHook(db, config));
    registerMeRoutes(api, db, config);
    registerClientRoutes(api, db);
    registerPriceRoutes(api, db);
    registerCalendarRoutes(api, db, hooks);
    registerMoneyRoutes(api, db, hooks);
  });

  return app;
}
