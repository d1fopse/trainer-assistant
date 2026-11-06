import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createTestApp, createTestDb, signInitData, TRAINER_ID } from './helpers.js';

const CLIENT = 555;

const validOnboarding = {
  name: 'Ірина',
  phone: '+380501234567',
  goal: 'weight_loss',
  experience: 'beginner',
  health: '',
  injuries: 'болить коліно',
  consent: true,
};

describe('auth, roles, onboarding', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let call: Awaited<ReturnType<typeof createTestApp>>['call'];
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];

  beforeAll(async () => {
    t = await createTestDb();
    ({ app, call } = await createTestApp(t.db));
  });
  beforeEach(() => t.reset());
  afterAll(() => t.pg.close());

  it('rejects requests without authorization', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects initData signed by another bot', async () => {
    const forged = signInitData('666:FAKE', { id: TRAINER_ID }, Math.floor(Date.now() / 1000));
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'tma ' + forged },
    });
    expect(res.statusCode).toBe(401);
  });

  it('ignores dev bypass header when disabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `dev ${TRAINER_ID}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to start with dev bypass in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'x', BOT_TOKEN: 'x', DEV_AUTH_BYPASS: 'true' }),
    ).toThrow();
  });

  it('recognises the trainer by server-side id list', async () => {
    const body = (await call(TRAINER_ID, 'GET', '/api/me')).json();
    expect(body.user.role).toBe('TRAINER');
    expect(body.needsOnboarding).toBe(false);
  });

  it('a stranger is a guest who must complete onboarding, language uk by default', async () => {
    const body = (await call(CLIENT, 'GET', '/api/me')).json();
    expect(body.user.role).toBe('GUEST');
    expect(body.user.language).toBe('uk');
    expect(body.needsOnboarding).toBe(true);
  });

  it('onboarding requires consent', async () => {
    const res = await call(CLIENT, 'POST', '/api/onboarding', { ...validOnboarding, consent: false });
    expect(res.statusCode).toBe(400);
  });

  it('onboarding creates a guest card exactly once and records consent time', async () => {
    expect((await call(CLIENT, 'POST', '/api/onboarding', validOnboarding)).statusCode).toBe(201);
    expect((await call(CLIENT, 'POST', '/api/onboarding', validOnboarding)).statusCode).toBe(409);

    const [row] = await t.db.query.clients.findMany();
    expect(row).toMatchObject({ name: 'Ірина', status: 'GUEST', injuries: 'болить коліно', health: null });
    expect(row!.consentAt).toBeInstanceOf(Date);

    const me = (await call(CLIENT, 'GET', '/api/me')).json();
    expect(me.needsOnboarding).toBe(false);
    expect(me.user.role).toBe('GUEST');
  });

  it('client role comes only from an ACTIVE card approved by the trainer', async () => {
    await call(CLIENT, 'POST', '/api/onboarding', validOnboarding);
    const { clients } = (await call(TRAINER_ID, 'GET', '/api/clients?status=GUEST')).json();
    await call(TRAINER_ID, 'PATCH', `/api/clients/${clients[0].id}`, { status: 'ACTIVE' });
    expect((await call(CLIENT, 'GET', '/api/me')).json().user.role).toBe('CLIENT');

    await call(TRAINER_ID, 'PATCH', `/api/clients/${clients[0].id}`, { status: 'INACTIVE' });
    expect((await call(CLIENT, 'GET', '/api/me')).json().user.role).toBe('GUEST');
  });

  it('the trainer does not fill the onboarding form', async () => {
    expect((await call(TRAINER_ID, 'POST', '/api/onboarding', validOnboarding)).statusCode).toBe(400);
  });

  it('language can be switched to ru but not to an unknown one', async () => {
    expect((await call(CLIENT, 'PATCH', '/api/me/language', { language: 'ru' })).json().language).toBe('ru');
    expect((await call(CLIENT, 'GET', '/api/me')).json().user.language).toBe('ru');
    expect((await call(CLIENT, 'PATCH', '/api/me/language', { language: 'en' })).statusCode).toBe(400);
  });

  it('exposes the trainer username for the "contact trainer" button', async () => {
    expect((await call(CLIENT, 'GET', '/api/me')).json().trainerUsername).toBeNull();
    await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: {
        authorization:
          'tma ' +
          signInitData(
            '123456:TEST_TOKEN',
            { id: TRAINER_ID, first_name: 'Vlad', username: 'vlad_coach' },
            Math.floor(Date.now() / 1000),
          ),
      },
    });
    expect((await call(CLIENT, 'GET', '/api/me')).json().trainerUsername).toBe('vlad_coach');
  });
});

describe('migration from the stage-1 Prisma tables', () => {
  it('drops the old tables and creates the new ones', async () => {
    const t = await createTestDb(async (pg) => {
      await pg.exec(`
        CREATE TYPE "Role" AS ENUM ('TRAINER','CLIENT','GUEST');
        CREATE TABLE "User" (id serial primary key, role "Role");
        CREATE TABLE "Client" (id serial primary key, "userId" int references "User"(id));
        INSERT INTO "User"(role) VALUES ('GUEST');
      `);
    });
    const res = await t.pg.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public' order by 1`,
    );
    const names = res.rows.map((r) => r.table_name);
    expect(names).toEqual(expect.arrayContaining(['users', 'clients', 'prices', 'settings']));
    expect(names).not.toContain('User');
    expect(names).not.toContain('Client');
    await t.pg.close();
  });
});
