import { beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { requireTrainer } from '../src/auth.js';
import { signInitData } from './helpers.js';

const TOKEN = '123456:TEST_TOKEN';
const TRAINER_ID = 1001;

type U = {
  id: number;
  telegramId: bigint;
  role: 'TRAINER' | 'CLIENT' | 'GUEST';
  language: 'uk' | 'ru';
  firstName: string | null;
  username: string | null;
};
type C = { id: number; userId: number; name: string; status: string; consentAt?: Date };

/** Мінімальна in-memory заглушка Prisma — достатньо для перевірки логіки авторизації та ролей. */
function fakePrisma() {
  const users: U[] = [];
  const clients: C[] = [];
  let uid = 1;
  let cid = 1;
  const prisma = {
    user: {
      upsert: async ({ where, create, update }: any) => {
        let u = users.find((x) => x.telegramId === where.telegramId);
        if (u) Object.assign(u, update);
        else {
          u = { id: uid++, role: 'GUEST', language: 'uk', ...create };
          users.push(u!);
        }
        return u;
      },
      update: async ({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id)!;
        Object.assign(u, data);
        return u;
      },
    },
    client: {
      findUnique: async ({ where }: any) => clients.find((c) => c.userId === where.userId) ?? null,
      create: async ({ data }: any) => {
        const c = { id: cid++, ...data };
        clients.push(c);
        return c;
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, users, clients };
}

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://x',
  BOT_TOKEN: TOKEN,
  TRAINER_TELEGRAM_IDS: String(TRAINER_ID),
});

const authHeader = (id: number) => ({
  authorization:
    'tma ' + signInitData(TOKEN, { id, first_name: 'T' }, Math.floor(Date.now() / 1000) - 5),
});

const validOnboarding = {
  name: 'Ірина',
  phone: '+380501234567',
  goal: 'weight_loss',
  experience: 'beginner',
  health: '',
  injuries: 'болить коліно',
  consent: true,
};

describe('API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: ReturnType<typeof fakePrisma>;

  beforeEach(async () => {
    db = fakePrisma();
    app = await buildApp(config, db.prisma);
  });

  it('rejects requests without authorization', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects forged initData', async () => {
    const forged = signInitData('666:FAKE', { id: TRAINER_ID }, Math.floor(Date.now() / 1000));
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'tma ' + forged },
    });
    expect(res.statusCode).toBe(401);
  });

  it('dev bypass is ignored when disabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `dev ${TRAINER_ID}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to start with dev bypass in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'x',
        BOT_TOKEN: 'x',
        DEV_AUTH_BYPASS: 'true',
      }),
    ).toThrow();
  });

  it('trainer is recognised by server-side id list and needs no onboarding', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: authHeader(TRAINER_ID) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.role).toBe('TRAINER');
    expect(body.needsOnboarding).toBe(false);
  });

  it('a stranger is a guest and must complete onboarding', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: authHeader(555) });
    const body = res.json();
    expect(body.user.role).toBe('GUEST');
    expect(body.user.language).toBe('uk');
    expect(body.needsOnboarding).toBe(true);
  });

  it('a user cannot become trainer via a stored role', async () => {
    await app.inject({ method: 'GET', url: '/api/me', headers: authHeader(555) });
    db.users[0]!.role = 'CLIENT';
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: authHeader(555) });
    expect(res.json().user.role).toBe('CLIENT');
  });

  it('onboarding requires consent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: authHeader(555),
      payload: { ...validOnboarding, consent: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it('onboarding creates a client card once', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: authHeader(555),
      payload: validOnboarding,
    });
    expect(first.statusCode).toBe(201);
    expect(db.clients).toHaveLength(1);
    expect(db.clients[0]).toMatchObject({ name: 'Ірина', status: 'GUEST' });
    expect(db.clients[0]!.consentAt).toBeInstanceOf(Date);

    const second = await app.inject({
      method: 'POST',
      url: '/api/onboarding',
      headers: authHeader(555),
      payload: validOnboarding,
    });
    expect(second.statusCode).toBe(409);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: authHeader(555) });
    expect(me.json().needsOnboarding).toBe(false);
  });

  it('language can be switched to ru, but not to an unknown one', async () => {
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/me/language',
      headers: authHeader(555),
      payload: { language: 'ru' },
    });
    expect(ok.json().language).toBe('ru');
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/me/language',
      headers: authHeader(555),
      payload: { language: 'en' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('requireTrainer blocks non-trainers with 403', async () => {
    const { createAuthHook } = await import('../src/auth.js');
    const { default: Fastify } = await import('fastify');
    const guarded = Fastify();
    guarded.addHook('preHandler', createAuthHook(db.prisma, config));
    guarded.get('/api/secret', { preHandler: requireTrainer }, async () => ({ secret: 1 }));

    const client = await guarded.inject({
      method: 'GET',
      url: '/api/secret',
      headers: authHeader(555),
    });
    expect(client.statusCode).toBe(403);
    const trainer = await guarded.inject({
      method: 'GET',
      url: '/api/secret',
      headers: authHeader(TRAINER_ID),
    });
    expect(trainer.statusCode).toBe(200);
  });
});
