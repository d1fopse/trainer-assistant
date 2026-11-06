import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  /** Telegram ID тренера (або кількох, через кому). Єдине джерело ролі тренера. */
  TRAINER_TELEGRAM_IDS: z.string().default(''),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Лише для локальної розробки в браузері без Telegram. У production заборонено. */
  DEV_AUTH_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Максимальний вік підпису initData, секунд. */
  INIT_DATA_MAX_AGE_SEC: z.coerce.number().default(24 * 60 * 60),
  /** Публічна адреса сервера для webhook бота. На Railway береться з RAILWAY_PUBLIC_DOMAIN. */
  PUBLIC_URL: z.string().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
});

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  botToken: string;
  trainerIds: Set<string>;
  webOrigin: string;
  devAuthBypass: boolean;
  initDataMaxAgeSec: number;
  /** https://… адреса сервера або null (тоді бот не налаштовує webhook). */
  publicUrl: string | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = schema.parse(env);
  if (e.NODE_ENV === 'production' && e.DEV_AUTH_BYPASS) {
    throw new Error('DEV_AUTH_BYPASS must not be enabled in production');
  }
  const trainerIds = new Set(
    e.TRAINER_TELEGRAM_IDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    botToken: e.BOT_TOKEN,
    trainerIds,
    webOrigin: e.WEB_ORIGIN,
    devAuthBypass: e.DEV_AUTH_BYPASS,
    initDataMaxAgeSec: e.INIT_DATA_MAX_AGE_SEC,
    publicUrl:
      e.PUBLIC_URL?.replace(/\/$/, '') || (e.RAILWAY_PUBLIC_DOMAIN ? `https://${e.RAILWAY_PUBLIC_DOMAIN}` : null),
  };
}
