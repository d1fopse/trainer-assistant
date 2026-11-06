import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { createAuthHook } from './auth.js';
import { registerErrorHandler } from './http.js';
import { registerMeRoutes } from './routes/me.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerPriceRoutes } from './routes/prices.js';
import { registerCalendarRoutes, type CalendarHooks } from './routes/calendar.js';
import { registerMoneyRoutes } from './routes/money.js';
import { registerWaitlistRoutes } from './routes/waitlist.js';
import { Notifier } from './bot/notifier.js';
import { Bot } from './bot/bot.js';
import { registerWebhook } from './bot/webhook.js';
import type { TelegramApi } from './bot/telegram.js';

export type AppDeps = {
  /** Клієнт Telegram Bot API; без нього бот і сповіщення вимкнені. */
  tg?: TelegramApi;
  now?: () => Date;
  botSendDelayMs?: number;
};

declare module 'fastify' {
  interface FastifyInstance {
    notifier: Notifier | null;
    bot: Bot | null;
  }
}

export async function buildApp(config: Config, db: Db, deps: AppDeps = {}) {
  const app = Fastify({ logger: config.nodeEnv !== 'test' });

  const notifier = deps.tg ? new Notifier(db, deps.tg, config, deps.now, app.log) : null;
  const bot = deps.tg && notifier ? new Bot(db, deps.tg, config, notifier, app.log, deps.botSendDelayMs) : null;
  const hooks: CalendarHooks = notifier
    ? {
        onSeatsFreed: (slotId) => notifier.onSeatsFreed(slotId),
        onBooked: (slotId, clientId) => notifier.onBooked(slotId, clientId),
      }
    : {};
  app.decorate('notifier', notifier);
  app.decorate('bot', bot);

  await app.register(cors, {
    origin: config.webOrigin,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  registerErrorHandler(app);

  app.get('/health', async () => ({ ok: true }));
  if (bot) registerWebhook(app, bot, config.botToken);

  // Усі маршрути /api/* потребують валідного підпису Telegram.
  await app.register(async (api) => {
    api.addHook('preHandler', createAuthHook(db, config));
    registerMeRoutes(api, db, config);
    registerClientRoutes(api, db);
    registerPriceRoutes(api, db);
    registerCalendarRoutes(api, db, hooks);
    registerMoneyRoutes(api, db, hooks);
    registerWaitlistRoutes(api, db, notifier);
  });

  return app;
}
