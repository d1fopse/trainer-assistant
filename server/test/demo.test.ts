import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createTestDb, TRAINER_ID } from './helpers.js';

describe('demo data', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let call: Awaited<ReturnType<typeof createTestApp>>['call'];
  const NOW = new Date('2026-11-06T16:40:00Z'); // пт, 18:40 у Києві

  beforeAll(async () => {
    t = await createTestDb();
    ({ call } = await createTestApp(t.db, { now: () => NOW }));
  });
  afterAll(() => t.pg.close());

  it('fills the app with consistent demo data and removes it completely', async () => {
    // Власна позиція тренера: демо не додає ціни і не чіпає наявні.
    await call(TRAINER_ID, 'POST', '/api/prices', { kind: 'SINGLE', titleUk: 'Моє', priceUah: 500 });
    await call(TRAINER_ID, 'POST', '/api/clients', { name: 'Справжній клієнт', status: 'ACTIVE' });
    expect((await call(TRAINER_ID, 'GET', '/api/demo')).json()).toEqual({ exists: false });

    const res = await call(TRAINER_ID, 'POST', '/api/demo', { size: 'small' });
    expect(res.statusCode).toBe(200);
    const made = res.json();
    expect(made.clients).toBe(8);
    expect(made.prices).toBe(0);
    expect(made.slots).toBeGreaterThan(70);
    expect((await call(TRAINER_ID, 'GET', '/api/demo')).json()).toEqual({ exists: true });
    expect((await call(TRAINER_ID, 'POST', '/api/demo', { size: 'small' })).statusCode).toBe(409);

    const active = (await call(TRAINER_ID, 'GET', '/api/clients?status=ACTIVE')).json().clients as { id: number; name: string; remaining: number | null }[];
    const by = Object.fromEntries(active.map((c) => [c.name, c]));
    expect(by['Олег Коваль']!.remaining).toBe(5);
    expect(by['Тарас Мельник']!.remaining).toBe(1);
    expect((await call(TRAINER_ID, 'GET', '/api/clients?status=GUEST')).json().clients).toHaveLength(1);

    // Залишок абонемента відповідає списаним заняттям.
    const h = (await call(TRAINER_ID, 'GET', `/api/clients/${by['Олег Коваль']!.id}/history`)).json();
    const pass = h.summary.activePasses[0];
    const deducted = h.visits.filter((v: { passId: number | null; deducted: boolean }) => v.passId === pass.id && v.deducted).length;
    expect(pass.totalSessions - pass.remaining).toBe(deducted);
    expect(h.summary.unpaid).toBe(0);

    // Дмитро: пробне → абонемент (конверсія в аналітиці).
    const a = (await call(TRAINER_ID, 'GET', '/api/analytics?from=2026-10-01&to=2026-11-30')).json();
    expect(a.trials.converted).toBe(1);
    expect(a.income.total).toBeGreaterThan(0);

    const del = (await call(TRAINER_ID, 'DELETE', '/api/demo')).json();
    expect(del.clients).toBe(8);
    expect(del.slots).toBe(made.slots);
    expect((await call(TRAINER_ID, 'GET', '/api/demo')).json()).toEqual({ exists: false });
    const left = (await call(TRAINER_ID, 'GET', '/api/clients?status=ACTIVE')).json().clients;
    expect(left.map((c: { name: string }) => c.name)).toEqual(['Справжній клієнт']);
    expect((await call(TRAINER_ID, 'GET', '/api/prices')).json().prices).toHaveLength(1);
    const cal = (await call(TRAINER_ID, 'GET', `/api/calendar?from=${encodeURIComponent('2026-10-01T00:00:00+03:00')}&to=${encodeURIComponent('2026-12-01T00:00:00+02:00')}`)).json();
    expect(cal.slots).toHaveLength(0);
  });

  it('adds demo prices when the trainer has none, and removes them', async () => {
    await t.reset();
    expect((await call(TRAINER_ID, 'POST', '/api/demo', { size: 'small' })).json().prices).toBe(5);
    expect((await call(TRAINER_ID, 'GET', '/api/prices')).json().prices).toHaveLength(5);
    await call(TRAINER_ID, 'DELETE', '/api/demo');
    expect((await call(TRAINER_ID, 'GET', '/api/prices')).json().prices).toHaveLength(0);
  });

  it('large set: many clients, consistent passes, removable', async () => {
    await t.reset();
    const r = (await call(TRAINER_ID, 'POST', '/api/demo')).json();
    expect(r.clients).toBe(42);
    expect(r.slots).toBeGreaterThan(400);
    expect(r.bookings).toBeGreaterThan(500);
    expect(r.passes).toBeGreaterThan(20);
    const list = (await call(TRAINER_ID, 'GET', '/api/clients?status=ACTIVE')).json().clients as { id: number }[];
    expect(list.length).toBe(32);
    for (const c of list.slice(0, 8)) {
      const h = (await call(TRAINER_ID, 'GET', `/api/clients/${c.id}/history`)).json();
      for (const p of h.summary.passes) {
        const used = h.visits.filter((v: { passId: number | null; deducted: boolean }) => v.passId === p.id && v.deducted).length;
        expect(p.totalSessions - p.remaining).toBe(used);
      }
    }
    const a = (await call(TRAINER_ID, 'GET', '/api/analytics?from=2026-08-01&to=2026-11-30')).json();
    expect(a.attendance.attended).toBeGreaterThan(300);
    expect(a.trials.total).toBeGreaterThan(5);
    const del = (await call(TRAINER_ID, 'DELETE', '/api/demo')).json();
    expect(del.clients).toBe(42);
    expect((await call(TRAINER_ID, 'GET', '/api/clients?status=ACTIVE')).json().clients).toHaveLength(0);
  });
});
