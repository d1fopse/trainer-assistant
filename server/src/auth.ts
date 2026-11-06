import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient, Role, User } from '@prisma/client';
import type { Config } from './config.js';
import { InitDataError, verifyInitData, type TelegramUser } from './telegram/initData.js';

export type AuthedUser = User & { effectiveRole: Role };

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
    return { id, first_name: 'Dev' };
  }

  throw new InitDataError('unsupported authorization scheme');
}

export function createAuthHook(prisma: PrismaClient, config: Config) {
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
    const user = await prisma.user.upsert({
      where: { telegramId },
      create: {
        telegramId,
        firstName: tgUser.first_name ?? null,
        username: tgUser.username ?? null,
      },
      update: {
        firstName: tgUser.first_name ?? null,
        username: tgUser.username ?? null,
      },
    });

    // Роль тренера визначається ТІЛЬКИ списком на сервері, а не даними з БД чи клієнта.
    const isTrainer = config.trainerIds.has(String(tgUser.id));
    req.authUser = { ...user, effectiveRole: isTrainer ? 'TRAINER' : user.role };
  };
}

export async function requireTrainer(req: FastifyRequest, reply: FastifyReply) {
  if (req.authUser?.effectiveRole !== 'TRAINER') {
    return reply.code(403).send({ error: 'forbidden' });
  }
}
