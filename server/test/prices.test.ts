import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createTestDb, TRAINER_ID } from './helpers.js';

const GUEST = 777;

describe('prices', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let call: Awaited<ReturnType<typeof createTestApp>>['call'];

  beforeAll(async () => {
    t = await createTestDb();
    ({ call } = await createTestApp(t.db));
  });
  beforeEach(() => t.reset());
  afterAll(() => t.pg.close());

  const create = async (body: Record<string, unknown>) => {
    const res = await call(TRAINER_ID, 'POST', '/api/prices', body);
    expect(res.statusCode).toBe(201);
    return res.json().price;
  };

  it('trainer creates a single session and a pass with N sessions', async () => {
    const single = await create({ kind: 'SINGLE', titleUk: 'Разове заняття', priceUah: 600, sessionsCount: 5 });
    expect(single).toMatchObject({ kind: 'SINGLE', sessionsCount: null, sortOrder: 0, isVisible: true });

    const pass = await create({
      kind: 'PASS',
      titleUk: 'Абонемент 8 занять',
      titleRu: 'Абонемент 8 занятий',
      priceUah: 4200,
      sessionsCount: 8,
    });
    expect(pass).toMatchObject({ kind: 'PASS', sessionsCount: 8, sortOrder: 1 });
  });

  it('a pass requires a number of sessions; prices are validated', async () => {
    expect((await call(TRAINER_ID, 'POST', '/api/prices', { kind: 'PASS', titleUk: 'A', priceUah: 1 })).statusCode).toBe(400);
    expect((await call(TRAINER_ID, 'POST', '/api/prices', { kind: 'SINGLE', titleUk: 'A', priceUah: -1 })).statusCode).toBe(400);
    expect((await call(TRAINER_ID, 'POST', '/api/prices', { kind: 'SINGLE', titleUk: '', priceUah: 1 })).statusCode).toBe(400);

    const single = await create({ kind: 'SINGLE', titleUk: 'Разове', priceUah: 600 });
    // Перетворення на абонемент без кількості занять — помилка; з кількістю — ок.
    expect((await call(TRAINER_ID, 'PATCH', `/api/prices/${single.id}`, { kind: 'PASS' })).statusCode).toBe(400);
    const ok = await call(TRAINER_ID, 'PATCH', `/api/prices/${single.id}`, { kind: 'PASS', sessionsCount: 12 });
    expect(ok.json().price).toMatchObject({ kind: 'PASS', sessionsCount: 12 });
    // Назад у разове — кількість занять зникає.
    const back = await call(TRAINER_ID, 'PATCH', `/api/prices/${single.id}`, { kind: 'SINGLE' });
    expect(back.json().price.sessionsCount).toBeNull();
  });

  it('clients see only visible positions; trainer sees all', async () => {
    await create({ kind: 'SINGLE', titleUk: 'Видима', priceUah: 600 });
    const hidden = await create({ kind: 'SINGLE', titleUk: 'Прихована', priceUah: 500 });
    await call(TRAINER_ID, 'PATCH', `/api/prices/${hidden.id}`, { isVisible: false });

    expect((await call(GUEST, 'GET', '/api/prices')).json().prices.map((p: { titleUk: string }) => p.titleUk)).toEqual([
      'Видима',
    ]);
    expect((await call(TRAINER_ID, 'GET', '/api/prices')).json().prices).toHaveLength(2);
  });

  it('only the trainer can change prices', async () => {
    const p = await create({ kind: 'SINGLE', titleUk: 'A', priceUah: 1 });
    expect((await call(GUEST, 'POST', '/api/prices', { kind: 'SINGLE', titleUk: 'B', priceUah: 1 })).statusCode).toBe(403);
    expect((await call(GUEST, 'PATCH', `/api/prices/${p.id}`, { priceUah: 0 })).statusCode).toBe(403);
    expect((await call(GUEST, 'DELETE', `/api/prices/${p.id}`)).statusCode).toBe(403);
    expect((await call(GUEST, 'PUT', '/api/prices/order', { ids: [p.id] })).statusCode).toBe(403);
  });

  it('reorders and deletes', async () => {
    const a = await create({ kind: 'SINGLE', titleUk: 'A', priceUah: 1 });
    const b = await create({ kind: 'SINGLE', titleUk: 'B', priceUah: 1 });
    const c = await create({ kind: 'SINGLE', titleUk: 'C', priceUah: 1 });

    const res = await call(TRAINER_ID, 'PUT', '/api/prices/order', { ids: [c.id, a.id, b.id] });
    expect(res.json().prices.map((p: { titleUk: string }) => p.titleUk)).toEqual(['C', 'A', 'B']);
    expect((await call(TRAINER_ID, 'PUT', '/api/prices/order', { ids: [a.id, a.id] })).statusCode).toBe(400);

    expect((await call(TRAINER_ID, 'DELETE', `/api/prices/${a.id}`)).statusCode).toBe(204);
    expect((await call(TRAINER_ID, 'DELETE', `/api/prices/${a.id}`)).statusCode).toBe(404);
    expect((await call(GUEST, 'GET', '/api/prices')).json().prices).toHaveLength(2);
  });
});
