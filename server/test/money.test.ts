import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createTestDb, TRAINER_ID } from './helpers.js';

const CLIENT_TG = 601;

describe('attendance, passes, payments', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let call: Awaited<ReturnType<typeof createTestApp>>['call'];
  let anna: number;

  beforeAll(async () => {
    t = await createTestDb();
    ({ call } = await createTestApp(t.db));
  });
  beforeEach(async () => {
    await t.reset();
    await call(CLIENT_TG, 'POST', '/api/onboarding', { name: 'Анна', goal: 'health', experience: 'none', consent: true });
    anna = (await call(CLIENT_TG, 'GET', '/api/me')).json().client.id;
    await call(TRAINER_ID, 'PATCH', `/api/clients/${anna}`, { status: 'ACTIVE' });
  });
  afterAll(() => t.pg.close());

  async function booking(startsAt: string, opts: { isTrial?: boolean; clientId?: number } = {}) {
    const res = await call(TRAINER_ID, 'POST', '/api/slots', {
      startsAt,
      durationMin: 60,
      type: 'INDIVIDUAL',
      clientIds: [opts.clientId ?? anna],
      isTrial: opts.isTrial ?? false,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().slot.bookings[0].id as number;
  }
  const mark = (id: number, status: string, deduct?: boolean) =>
    call(TRAINER_ID, 'PATCH', `/api/bookings/${id}`, deduct === undefined ? { status } : { status, deduct });
  const history = async (id = anna) => (await call(TRAINER_ID, 'GET', `/api/clients/${id}/history`)).json();
  const buyPass = (sessions: number, paidAt = '2026-11-01', expiresAt: string | null = null) =>
    call(TRAINER_ID, 'POST', `/api/clients/${anna}/payments`, {
      amountUah: sessions * 600,
      paidAt,
      method: 'CARD',
      purpose: 'PASS',
      pass: { totalSessions: sessions, expiresAt },
    });

  it('is trainer-only (except /me/summary)', async () => {
    expect((await call(CLIENT_TG, 'PATCH', '/api/bookings/1', { status: 'ATTENDED' })).statusCode).toBe(403);
    expect((await call(CLIENT_TG, 'GET', `/api/clients/${anna}/history`)).statusCode).toBe(403);
    expect((await call(CLIENT_TG, 'POST', `/api/clients/${anna}/payments`, {})).statusCode).toBe(403);
    expect((await call(CLIENT_TG, 'PATCH', '/api/passes/1', { remaining: 99 })).statusCode).toBe(403);
    expect((await call(CLIENT_TG, 'DELETE', '/api/payments/1')).statusCode).toBe(403);
    expect((await call(CLIENT_TG, 'GET', '/api/me/summary')).statusCode).toBe(200);
  });

  it('a pass payment creates a pass; "attended" deducts automatically', async () => {
    const res = await buyPass(8);
    expect(res.statusCode).toBe(201);
    expect(res.json().pass).toMatchObject({ totalSessions: 8, remaining: 8, purchasedAt: '2026-11-01' });
    expect(res.json().summary.remaining).toBe(8);

    const b = await booking('2026-11-10T18:00:00+02:00');
    const r = await mark(b, 'ATTENDED');
    expect(r.statusCode).toBe(200);
    expect(r.json().slot.bookings[0]).toMatchObject({ status: 'ATTENDED', deducted: true });
    expect(r.json().warning).toBeUndefined();

    const h = await history();
    expect(h.summary).toMatchObject({ remaining: 7, attended: 1, unpaid: 0 });
    expect(h.visits[0]).toMatchObject({ status: 'ATTENDED', deducted: true });
    expect(h.payments).toHaveLength(1);
  });

  it('no-show deducts only when the trainer chooses to', async () => {
    await buyPass(4);
    const a = await booking('2026-11-10T18:00:00+02:00');
    const b = await booking('2026-11-11T18:00:00+02:00');
    await mark(a, 'NO_SHOW');
    await mark(b, 'NO_SHOW', true);
    const h = await history();
    expect(h.summary).toMatchObject({ remaining: 3, noShows: 2 });
  });

  it('re-marking refunds the previous deduction', async () => {
    await buyPass(4);
    const b = await booking('2026-11-10T18:00:00+02:00');
    await mark(b, 'ATTENDED');
    await mark(b, 'ATTENDED'); // повторно — не списує двічі
    expect((await history()).summary.remaining).toBe(3);
    await mark(b, 'NO_SHOW'); // без списання
    expect((await history()).summary.remaining).toBe(4);
    await mark(b, 'NO_SHOW', true);
    expect((await history()).summary.remaining).toBe(3);
    await mark(b, 'CANCELLED');
    expect((await history()).summary.remaining).toBe(4);
    await mark(b, 'BOOKED');
    const h = await history();
    expect(h.summary.remaining).toBe(4);
    expect(h.visits[0]).toMatchObject({ status: 'BOOKED', deducted: false, markedAt: null });
  });

  it('a trial session is never deducted', async () => {
    await buyPass(4);
    const b = await booking('2026-11-10T18:00:00+02:00', { isTrial: true });
    await mark(b, 'ATTENDED');
    const h = await history();
    expect(h.summary).toMatchObject({ remaining: 4, unpaid: 0, trialStatus: 'ATTENDED' });
  });

  it('without an active pass the visit is unpaid; a later pass can cover it', async () => {
    const b = await booking('2026-11-10T18:00:00+02:00');
    const r = await mark(b, 'ATTENDED');
    expect(r.json().warning).toBe('no_active_pass');
    expect((await history()).summary.unpaid).toBe(1);

    await buyPass(8, '2026-11-12');
    const applied = await call(TRAINER_ID, 'POST', `/api/clients/${anna}/apply-unpaid`);
    expect(applied.json()).toMatchObject({ applied: 1, summary: { remaining: 7, unpaid: 0 } });
  });

  it('uses the oldest active pass first and skips expired ones', async () => {
    await buyPass(2, '2026-09-01', '2026-10-01'); // прострочений
    await buyPass(1, '2026-10-15');
    await buyPass(5, '2026-11-01');
    const a = await booking('2026-11-10T18:00:00+02:00');
    const b = await booking('2026-11-11T18:00:00+02:00');
    await mark(a, 'ATTENDED');
    await mark(b, 'ATTENDED');
    const h = await history();
    const byDate = Object.fromEntries(h.summary.passes.map((p: { purchasedAt: string; remaining: number }) => [p.purchasedAt, p.remaining]));
    expect(byDate).toEqual({ '2026-09-01': 2, '2026-10-15': 0, '2026-11-01': 4 });
    expect(h.summary.remaining).toBe(4); // прострочений не рахується
  });

  it('trainer edits the remaining count manually; changes are logged', async () => {
    const { pass } = (await buyPass(8)).json();
    const r = await call(TRAINER_ID, 'PATCH', `/api/passes/${pass.id}`, { remaining: 5, expiresAt: '2026-12-31' });
    expect(r.json().pass).toMatchObject({ remaining: 5, expiresAt: '2026-12-31' });
    const h = await history();
    expect(h.summary.remaining).toBe(5);
    const update = h.audit.find((a: { entity: string; action: string }) => a.entity === 'pass' && a.action === 'update');
    expect(update.details).toMatchObject({ before: { remaining: 8, expiresAt: null }, after: { remaining: 5 } });
  });

  it('deleting a pass marks its deducted visits as unpaid', async () => {
    const { pass } = (await buyPass(4)).json();
    const b = await booking('2026-11-10T18:00:00+02:00');
    await mark(b, 'ATTENDED');
    expect((await call(TRAINER_ID, 'DELETE', `/api/passes/${pass.id}`)).statusCode).toBe(204);
    const h = await history();
    expect(h.summary).toMatchObject({ remaining: 0, unpaid: 1 });
    // Скасування такого запису не ламається
    expect((await mark(b, 'CANCELLED')).statusCode).toBe(200);
  });

  it('payments: create, edit, delete with audit; pass only for PASS payments', async () => {
    const res = await call(TRAINER_ID, 'POST', `/api/clients/${anna}/payments`, {
      amountUah: 700,
      paidAt: '2026-11-05',
      method: 'CASH',
      purpose: 'SINGLE',
      note: 'разове',
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().payment.id;
    expect(res.json().pass).toBeNull();

    expect((await call(TRAINER_ID, 'PATCH', `/api/payments/${id}`, { amountUah: 650, method: 'TRANSFER' })).json().payment).toMatchObject({
      amountUah: 650,
      method: 'TRANSFER',
    });
    expect((await call(TRAINER_ID, 'DELETE', `/api/payments/${id}`)).statusCode).toBe(204);
    expect((await call(TRAINER_ID, 'DELETE', `/api/payments/${id}`)).statusCode).toBe(404);

    const h = await history();
    expect(h.payments).toHaveLength(0);
    expect(h.audit.map((a: { action: string }) => a.action)).toEqual(['delete', 'update', 'create']);

    const bad = await call(TRAINER_ID, 'POST', `/api/clients/${anna}/payments`, {
      amountUah: 1,
      paidAt: '2026-11-05',
      method: 'CASH',
      purpose: 'SINGLE',
      pass: { totalSessions: 4 },
    });
    expect(bad.json().error).toBe('pass_only_for_pass_payment');
    expect((await call(TRAINER_ID, 'POST', `/api/clients/${anna}/payments`, { amountUah: -5, paidAt: '2026-11-05', method: 'CASH', purpose: 'OTHER' })).statusCode).toBe(400);
  });

  it('a gift pass without a payment', async () => {
    const r = await call(TRAINER_ID, 'POST', `/api/clients/${anna}/passes`, { totalSessions: 10, remaining: 6, note: 'з паперового обліку' });
    expect(r.statusCode).toBe(201);
    expect(r.json().summary.remaining).toBe(6);
  });

  it('restoring a cancelled booking respects capacity', async () => {
    const b = await booking('2026-11-10T18:00:00+02:00');
    await mark(b, 'CANCELLED');
    const other = (await call(TRAINER_ID, 'POST', '/api/clients', { name: 'Інший' })).json().client.id;
    const slotId = (await call(TRAINER_ID, 'GET', `/api/clients/${anna}/history`)).json().visits[0].slotId;
    await call(TRAINER_ID, 'POST', `/api/slots/${slotId}/bookings`, { clientId: other });
    expect((await mark(b, 'BOOKED')).json().error).toBe('slot_full');
  });

  it('records a manual past visit', async () => {
    await buyPass(4);
    const r = await call(TRAINER_ID, 'POST', `/api/clients/${anna}/visits`, { date: '2026-10-20', time: '18:00', status: 'ATTENDED' });
    expect(r.statusCode).toBe(201);
    const h = await history();
    // Абонемент куплено пізніше за візит — заняття все одно списується з нього (оплата «заднім числом»).
    expect(h.visits[0]).toMatchObject({ status: 'ATTENDED', deducted: true, startsAt: '2026-10-20T15:00:00.000Z' });
    expect(h.summary.remaining).toBe(3);
  });

  it('client sees own remaining, upcoming bookings and history only', async () => {
    await buyPass(8);
    const past = await booking('2026-10-01T18:00:00+03:00');
    await mark(past, 'ATTENDED');
    await booking('2099-01-01T18:00:00+02:00');
    const s = (await call(CLIENT_TG, 'GET', '/api/me/summary')).json();
    expect(s.summary).toMatchObject({ remaining: 7, attended: 1 });
    expect(s.upcoming).toHaveLength(1);
    expect(s.history).toEqual([expect.objectContaining({ status: 'ATTENDED' })]);
    expect(JSON.stringify(s)).not.toContain('amountUah');

    // Гість без картки
    expect((await call(999, 'GET', '/api/me/summary')).json().summary).toBeNull();
  });

  it('client list shows remaining sessions', async () => {
    await buyPass(1);
    const list = (await call(TRAINER_ID, 'GET', '/api/clients?status=ACTIVE')).json().clients;
    expect(list[0].remaining).toBe(1);
  });

  it('merging moves passes and payments', async () => {
    await buyPass(5);
    const manual = (await call(TRAINER_ID, 'POST', '/api/clients', { name: 'Анна (ручна)' })).json().client.id;
    // Повертаємо гостя в GUEST, щоб злити його в ручну картку
    await call(TRAINER_ID, 'POST', `/api/clients/${manual}/link`, { sourceClientId: anna });
    const h = await history(manual);
    expect(h.summary.remaining).toBe(5);
    expect(h.payments).toHaveLength(1);
  });
});
