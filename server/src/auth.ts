import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { clients, users, type Client, type User } from './db/schema.js';
import { InitDataError, verifyInitData, type TelegramUser } from './telegram/initData.js';

export type Role = 'TRAINER' | 'CLIENT' | 'GUEST';
export type AuthedUser = User & { role: Role; client: Client | null };

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthedUser;
  }
}

function extractTelegramUser(header: string | undefined, config: Config): TelegramUser {
  if (!header) throw new InitDataError('Authorization header is missing');

  if (header.startsWith('tma ')) {
    return verifyInitData(header.slice(4), config.botToken, {
      maxAgeSec: config.initDataMaxAgeSec,
    }).user;
  }

  // Лише для локальної розробки в браузері; у production конфіг не дозволяє.
  if (config.devAuthBypass && header.startsWith('dev ')) {
    const id = Number(header.slice(4));
    if (!Number.isSafeInteger(id) || id <= 0) throw new InitDataError('bad dev id');
    return { id, first_name: 'Dev', username: `dev${id}` };
  }

  throw new InitDataError('unsupported authorization scheme');
}

/**
 * Роль обчислюється при кожному запиті й ніде не зберігається:
 * тренер — лише за списком ID на сервері; клієнт — якщо картка ACTIVE; інакше гість.
 */
export function resolveRole(telegramId: string, client: Client | null, config: Config): Role {
  if (config.trainerIds.has(telegramId)) return 'TRAINER';
  if (client?.status === 'ACTIVE') return 'CLIENT';
  return 'GUEST';
}

export function createAuthHook(db: Db, config: Config) {
  return async function authHook(req: FastifyRequest, reply: FastifyReply) {
    let tgUser: TelegramUser;
    try {
      tgUser = extractTelegramUser(req.headers.authorization, config);
    } catch (e) {
      if (e instanceof InitDataError) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      throw e;
    }

    const telegramId = BigInt(tgUser.id);
    const profile = { firstName: tgUser.first_name ?? null, username: tgUser.username ?? null };
    const [user] = await db
      .insert(users)
      .values({ telegramId, ...profile })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: { firstName: sql`excluded.first_name`, username: sql`excluded.username` },
      })
      .returning();

    const [client] = await db.select().from(clients).where(eq(clients.userId, user!.id));
    const c = client ?? null;
    req.authUser = { ...user!, client: c, role: resolveRole(String(tgUser.id), c, config) };
  };
}

export async function requireTrainer(req: FastifyRequest, reply: FastifyReply) {
  if (req.authUser?.role !== 'TRAINER') {
    return reply.code(403).send({ error: 'forbidden' });
  }
}
