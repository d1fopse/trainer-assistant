import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp, type AppDeps } from '../src/app.js';
import { TelegramError, type TelegramApi } from '../src/bot/telegram.js';
import { loadConfig } from '../src/config.js';
import { migrationsFolder, schema, type Db } from '../src/db/index.js';

export const TOKEN = '123456:TEST_TOKEN';
export const TRAINER_ID = 1001;

/** Генерує валідний initData, підписаний ботом (так само, як це робить Telegram). */
export function signInitData(
  botToken: string,
  user: Record<string, unknown>,
  authDate: number,
  tamper?: (params: URLSearchParams) => void,
): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAH_test');
  params.set('user', JSON.stringify(user));

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  tamper?.(params);
  return params.toString();
}

/** Справжній Postgres у пам'яті (PGlite) з усіма міграціями. */
export async function createTestDb(prepare?: (pg: PGlite) => Promise<void>) {
  const pg = new PGlite();
  await prepare?.(pg);
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder });
  return {
    pg,
    db: db as unknown as Db,
    reset: () => pg.exec('TRUNCATE users, clients, prices, settings, slots, series, bookings, passes, payments, audit_log, waitlist, notifications_log, broadcasts RESTART IDENTITY CASCADE'),
  };
}

export const testConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused',
  BOT_TOKEN: TOKEN,
  TRAINER_TELEGRAM_IDS: String(TRAINER_ID),
});

export function authAs(id: number, extra: Record<string, unknown> = {}) {
  return {
    authorization:
      'tma ' +
      signInitData(TOKEN, { id, first_name: 'T', ...extra }, Math.floor(Date.now() / 1000) - 5),
  };
}

/** Додаток + зручні запити від імені користувача з Telegram ID. */
/** profiles — додаткові поля Telegram-профілю для окремих ID (наприклад, username тренера). */
export async function createTestApp(db: Db, deps: AppDeps = {}, profiles: Record<number, Record<string, unknown>> = {}) {
  const app = await buildApp(testConfig, db, deps);
  const call = (id: number, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: authAs(id, profiles[id]), payload: payload as never });
  return { app, call };
}

/** Фейковий Telegram Bot API: записує виклики, вміє «блокувати» окремі чати. */
export class FakeTelegram implements TelegramApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  blocked = new Set<string>();
  private nextMessageId = 1000;

  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    const chat = params.chat_id === undefined ? undefined : String(params.chat_id);
    if (chat && this.blocked.has(chat)) throw new TelegramError(method, 403, 'Forbidden: bot was blocked by the user');
    return { message_id: this.nextMessageId++ } as T;
  }

  sent(method = 'sendMessage') {
    return this.calls.filter((c) => c.method === method);
  }

  to(chatId: number | string, method = 'sendMessage') {
    return this.sent(method).filter((c) => String(c.params.chat_id) === String(chatId));
  }

  clear() {
    this.calls = [];
  }
}
