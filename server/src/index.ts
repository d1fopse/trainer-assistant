import { loadConfig } from './config.js';
import { connectDb } from './db/index.js';
import { buildApp } from './app.js';
import { createTelegramApi } from './bot/telegram.js';
import { WEBHOOK_PATH, webhookSecret } from './bot/webhook.js';

const config = loadConfig();
// Підключення до бази й застосування міграцій (створення/оновлення таблиць).
const { db } = await connectDb(config.databaseUrl);
const tg = createTelegramApi(config.botToken);
const app = await buildApp(config, db, { tg });

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Бот отримує повідомлення через webhook на цьому ж сервері.
if (config.publicUrl) {
  try {
    await tg.call('setWebhook', {
      url: `${config.publicUrl}${WEBHOOK_PATH}`,
      secret_token: webhookSecret(config.botToken),
      allowed_updates: ['message', 'callback_query'],
    });
    await tg.call('setMyCommands', { commands: [{ command: 'start', description: 'Почати / Начать' }] });
    app.log.info(`webhook set to ${config.publicUrl}${WEBHOOK_PATH}`);
  } catch (e) {
    app.log.error(e, 'failed to set webhook');
  }
} else {
  app.log.warn('PUBLIC_URL / RAILWAY_PUBLIC_DOMAIN not set — bot webhook is not configured');
}

// Нагадування та ранковий план — щохвилини.
const tick = () => void app.notifier?.tick();
setTimeout(tick, 5_000);
setInterval(tick, 60_000);
