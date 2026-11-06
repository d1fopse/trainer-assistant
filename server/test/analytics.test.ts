import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createTestDb, TRAINER_ID } from './helpers.js';

describe('analytics', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let call: Awaited<ReturnType<typeof createTestApp>>['call'];
  let result: Record<string, any>;

  beforeAll(async () => {
    t = await createTestDb();
    ({ call } = await createTestApp(t.db, { now: () => new Date('2026-11-20T12:00:00Z') }));

    const mk = async (name: string) => (await call(TRAINER_ID, 'POST', '/api/clients', { name })).json().client.id as number;
    const anna = await mk('Анна');
    const borys = await mk('Борис');
    const oleh = await mk('Олег');
    const vira = await mk('Віра');
    const pay = (clientId: number, body: Record<string, unknown>) => call(TRAINER_ID, 'POST', `/api/clients/${clientId}/payments`, body);
    const slot = async (startsAt: string, clientIds: number[], extra: Record<string, unknown> = {}) =>
      (await call(TRAINER_ID, 'POST', '/api/slots', { startsAt, durationMin: 60, type: 'INDIVIDUAL', clientIds, ...extra })).json().slot;
    const mark = (bookingId: number, status: string) => call(TRAINER_ID, 'PATCH', `/api/bookings/${bookingId}`, { status });

    await pay(anna, { amountUah: 3000, paidAt: '2026-10-03', method: 'CASH', purpose: 'PASS', pass: { totalSessions: 4 } });
    await pay(anna, { amountUah: 700, paidAt: '2026-11-05', method: 'CASH', purpose: 'SINGLE' });

    // Пробні: Олег купив абонемент після пробного, Віра — ні.
    const tOleh = await slot('2026-11-03T18:00:00+02:00', [oleh], { isTrial: true });
    await mark(tOleh.bookings[0].id, 'ATTENDED');
    await pay(oleh, { amountUah: 5000, paidAt: '2026-11-04', method: 'CARD', purpose: 'PASS', pass: { totalSessions: 1 } });
    const tVira = await slot('2026-11-08T18:00:00+02:00', [vira], { isTrial: true });
    await mark(tVira.bookings[0].id, 'ATTENDED');

    const s1 = await slot('2026-11-10T18:00:00+02:00', [anna]); // вт
    await mark(s1.bookings[0].id, 'ATTENDED');
    const s2 = await slot('2026-11-12T18:00:00+02:00', [anna]); // чт
    await mark(s2.bookings[0].id, 'NO_SHOW');
    const g = (await call(TRAINER_ID, 'POST', '/api/slots', { startsAt: '2026-11-14T10:00:00+02:00', durationMin: 60, type: 'GROUP', capacity: 4, clientIds: [anna, borys] })).json().slot; // сб
    await mark(g.bookings.find((b: { clientId: number }) => b.clientId === anna).id, 'ATTENDED');
    await mark(g.bookings.find((b: { clientId: number }) => b.clientId === borys).id, 'CANCELLED');
    await slot('2026-11-15T10:00:00+02:00', []); // порожній, нд
    await slot('2026-11-16T10:00:00+02:00', [borys]); // минув, не відмічено
    await slot('2026-11-25T10:00:00+02:00', [borys]); // майбутній

    result = (await call(TRAINER_ID, 'GET', '/api/analytics')).json();
  });
  afterAll(() => t.pg.close());

  it('is trainer-only and validates the range', async () => {
    expect((await call(555, 'GET', '/api/analytics')).statusCode).toBe(403);
    expect((await call(TRAINER_ID, 'GET', '/api/analytics?from=2026-12-01&to=2026-11-01')).statusCode).toBe(400);
  });

  it('defaults to the current month', () => {
    expect(result.period).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('income: total, by purpose/method, 12 months', () => {
    expect(result.income).toMatchObject({ total: 5700, payments: 2 });
    expect(result.income.byPurpose).toEqual([
      { purpose: 'PASS', total: 5000 },
      { purpose: 'SINGLE', total: 700 },
    ]);
    expect(result.income.byMonth).toHaveLength(12);
    expect(result.income.byMonth.at(-1)).toEqual({ month: '2026-11', total: 5700 });
    expect(result.income.byMonth.at(-2)).toEqual({ month: '2026-10', total: 3000 });
  });

  it('schedule load counts seats in open slots', () => {
    // місця: 1+1 (пробні) +1+1 +4 +1 +1 +1 = 11; зайнято: 2 + 2 + 1 (група) + 0 + 1 + 1 = 7
    expect(result.load).toMatchObject({ slots: 8, seats: 11, booked: 7, emptySlots: 1, rate: 63.6 });
    expect(result.load.byWeekday.find((d: { weekday: number }) => d.weekday === 6)).toEqual({ weekday: 6, slots: 1, seats: 4, booked: 1 });
  });

  it('attendance only counts past sessions', () => {
    expect(result.attendance).toMatchObject({ attended: 4, noShows: 1, cancelled: 1, unmarked: 1, rate: 80 });
    expect(result.attendance.perClient[0]).toMatchObject({ name: 'Анна', attended: 2, noShows: 1, rate: 66.7 });
  });

  it('trial conversion to a pass', () => {
    expect(result.trials).toMatchObject({ total: 2, attended: 2, converted: 1, rate: 50 });
    expect(result.trials.list.map((x: { name: string; converted: boolean }) => [x.name, x.converted])).toEqual([
      ['Олег', true],
      ['Віра', false],
    ]);
  });

  it('lists passes that are about to end', () => {
    expect(result.endingPasses).toEqual([expect.objectContaining({ name: 'Олег', remaining: 1 })]);
    expect(result.newClients).toBe(4);
  });

  it('a custom period', async () => {
    const r = (await call(TRAINER_ID, 'GET', '/api/analytics?from=2026-10-01&to=2026-10-31')).json();
    expect(r.income.total).toBe(3000);
    expect(r.load.slots).toBe(0);
    expect(r.attendance.rate).toBeNull();
  });
});
