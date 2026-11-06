import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Bot, Update } from './bot.js';

export const WEBHOOK_PATH = '/telegram/webhook';

/** Секрет webhook: Telegram надсилає його в заголовку, тож чужі запити відкидаються. */
export function webhookSecret(botToken: string) {
  return createHash('sha256').update(`webhook:${botToken}`).digest('hex').slice(0, 48);
}

export function registerWebhook(app: FastifyInstance, bot: Bot, botToken: string) {
  const secret = Buffer.from(webhookSecret(botToken));
  app.post(WEBHOOK_PATH, async (req, reply) => {
    const given = Buffer.from(String(req.headers['x-telegram-bot-api-secret-token'] ?? ''));
    if (given.length !== secret.length || !timingSafeEqual(given, secret)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    await bot.handleUpdate(req.body as Update);
    return { ok: true };
  });
}
