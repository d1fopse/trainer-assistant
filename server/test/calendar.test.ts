import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createTestDb, TRAINER_ID } from './helpers.js';

const CLIENT_A = 501;
const CLIENT_B = 502;

type Call = Awaited<ReturnType<typeof createTestApp>>['call'];

describe('calendar', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let call: Call;
  let anna: number; // клієнт з Telegram (CLIENT_A)
  let boris: number; // клієнт з Telegram (CLIENT_B)
  let oleh: number; // ручна картка

  const range = (from: string, to: string) =>
    `/api/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const WEEK = range('2026-11-09T00:00:00+02:00', '2026-11-16T00:00:00+02:00');

  async function onboardAndApprove(tgId: number, name: string) {
    await call(tgId, 'POST', '/api/onboarding', { name, goal: 'health', experience: 'none', consent: true });
    const me = (await call(tgId, 'GET', '/api/me')).json();
    await call(TRAINER_ID, 'PATCH', `/api/clients/${me.client.id}`, { status: 'ACTIVE' });
    return me.client.id as number;
  }

  const slot = async (body: Record<string, unknown>, expected = 201) => {
    const res = await call(TRAINER_ID, 'POST', '/api/slots', body);
    expect(res.statusCode, res.body).toBe(expected);
    return res.json();
  };

  beforeAll(async () => {
    t = await createTestDb();
    ({ call } = await createTestApp(t.db));
  });
  beforeEach(async () => {
    await t.reset();
    anna = await onboardAndApprove(CLIENT_A, 'Анна');
    boris = await onboardAndApprove(CLIENT_B, 'Борис');
    oleh = (await call(TRAINER_ID, 'POST', '/api/clients', { name: 'Олег' })).json().client.id;
  });
  afterAll(() => t.pg.close());

  it('mutations are trainer-only', async () => {
    const body = { startsAt: '2026-11-10T18:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL' };
    expect((await call(CLIENT_A, 'POST', '/api/slots', body)).statusCode).toBe(403);
    expect((await call(CLIENT_A, 'POST', '/api/slots/1/cancel')).statusCode).toBe(403);
    expect((await call(CLIENT_A, 'POST', '/api/slots/1/bookings', { clientId: anna })).statusCode).toBe(403);
    expect((await call(CLIENT_A, 'PATCH', '/api/bookings/1', { status: 'CANCELLED' })).statusCode).toBe(403);
    expect((await call(CLIENT_A, 'POST', '/api/series', {})).statusCode).toBe(403);
    expect((await call(CLIENT_A, 'GET', '/api/slots/1')).statusCode).toBe(403);
  });

  it('trainer sees names; clients see only free/busy and their own bookings', async () => {
    await slot({ startsAt: '2026-11-10T18:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL' });
    await slot({ startsAt: '2026-11-10T19:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL', clientIds: [anna] });

    const trainer = (await call(TRAINER_ID, 'GET', WEEK)).json().slots;
    expect(trainer).toHaveLength(2);
    expect(trainer[1].bookings[0]).toMatchObject({ clientId: anna, name: 'Анна', status: 'BOOKED' });

    const a = (await call(CLIENT_A, 'GET', WEEK)).json().slots;
    expect(a.map((s: { freeSeats: number; mine: boolean }) => [s.freeSeats, s.mine])).toEqual([
      [1, false],
      [0, true],
    ]);
    const b = (await call(CLIENT_B, 'GET', WEEK)).json().slots;
    expect(b[1]).toMatchObject({ freeSeats: 0, mine: false });
    expect(JSON.stringify(b)).not.toContain('Анна');

    // Гість теж бачить вільно/зайнято
    const guest = (await call(999, 'GET', WEEK)).json().slots;
    expect(guest).toHaveLength(2);
    expect(JSON.stringify(guest)).not.toContain('Анна');
  });

  it('validates the requested range', async () => {
    expect((await call(CLIENT_A, 'GET', '/api/calendar')).statusCode).toBe(400);
    expect((await call(CLIENT_A, 'GET', range('2026-11-16T00:00:00Z', '2026-11-09T00:00:00Z'))).statusCode).toBe(400);
    expect((await call(CLIENT_A, 'GET', range('2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'))).statusCode).toBe(400);
  });

  it('group slots: capacity, free seats, full and duplicate bookings', async () => {
    const { slot: g } = await slot({
      startsAt: '2026-11-11T10:00:00+02:00',
      durationMin: 60,
      type: 'GROUP',
      capacity: 2,
      clientIds: [anna],
    });
    expect(g).toMatchObject({ capacity: 2, bookedCount: 1 });
    expect((await call(CLIENT_B, 'GET', WEEK)).json().slots[0].freeSeats).toBe(1);

    expect((await call(TRAINER_ID, 'POST', `/api/slots/${g.id}/bookings`, { clientId: anna })).json().error).toBe(
      'already_booked',
    );
    expect((await call(TRAINER_ID, 'POST', `/api/slots/${g.id}/bookings`, { clientId: boris })).statusCode).toBe(201);
    const full = await call(TRAINER_ID, 'POST', `/api/slots/${g.id}/bookings`, { clientId: oleh });
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toBe('slot_full');

    // Не можна зменшити місткість нижче кількості записів
    expect((await call(TRAINER_ID, 'PATCH', `/api/slots/${g.id}`, { capacity: 1 })).statusCode).toBe(400);
    await call(TRAINER_ID, 'PATCH', `/api/slots/${g.id}`, { capacity: 3 });
    expect((await call(TRAINER_ID, 'POST', `/api/slots/${g.id}/bookings`, { clientId: oleh })).statusCode).toBe(201);
    expect((await call(TRAINER_ID, 'PATCH', `/api/slots/${g.id}`, { capacity: 2 })).json().error).toBe(
      'capacity_below_bookings',
    );

    // Групі потрібна місткість ≥ 2
    await slot({ startsAt: '2026-11-12T10:00:00+02:00', durationMin: 60, type: 'GROUP' }, 400);
  });

  it('detects overlaps unless forced', async () => {
    await slot({ startsAt: '2026-11-10T18:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL' });
    const res = await call(TRAINER_ID, 'POST', '/api/slots', {
      startsAt: '2026-11-10T18:30:00+02:00',
      durationMin: 60,
      type: 'INDIVIDUAL',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('overlap');
    expect(res.json().overlaps).toHaveLength(1);
    // Стик у стик — не перетин
    await slot({ startsAt: '2026-11-10T19:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL' });
    // Примусово
    await slot({ startsAt: '2026-11-10T18:30:00+02:00', durationMin: 30, type: 'INDIVIDUAL', force: true });
  });

  it('allows one trial session per client', async () => {
    await slot({ startsAt: '2026-11-10T18:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL', clientIds: [oleh], isTrial: true });
    const second = await call(TRAINER_ID, 'POST', '/api/slots', {
      startsAt: '2026-11-11T18:00:00+02:00',
      durationMin: 60,
      type: 'INDIVIDUAL',
      clientIds: [oleh],
      isTrial: true,
    });
    expect(second.json().error).toBe('trial_used');
    // Слот не створився (транзакція відкотилась)
    expect((await call(TRAINER_ID, 'GET', WEEK)).json().slots).toHaveLength(1);
  });

  it('cancelling a booking frees the seat; cancelling a slot hides it', async () => {
    const { slot: s } = await slot({ startsAt: '2026-11-10T18:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL', clientIds: [anna] });
    const bookingId = s.bookings[0].id;
    const res = await call(TRAINER_ID, 'PATCH', `/api/bookings/${bookingId}`, { status: 'CANCELLED' });
    expect(res.json().slot.bookedCount).toBe(0);
    expect((await call(CLIENT_B, 'GET', WEEK)).json().slots[0].freeSeats).toBe(1);
    expect((await call(TRAINER_ID, 'PATCH', `/api/bookings/${bookingId}`, { status: 'CANCELLED' })).statusCode).toBe(409);

    await call(TRAINER_ID, 'POST', `/api/slots/${s.id}/bookings`, { clientId: boris });
    await call(TRAINER_ID, 'POST', `/api/slots/${s.id}/cancel`);
    expect((await call(TRAINER_ID, 'GET', WEEK)).json().slots).toHaveLength(0);
    expect((await call(TRAINER_ID, 'POST', `/api/slots/${s.id}/bookings`, { clientId: oleh })).json().error).toBe(
      'slot_cancelled',
    );
  });

  it('moves a slot with overlap check', async () => {
    const { slot: a } = await slot({ startsAt: '2026-11-10T18:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL' });
    await slot({ startsAt: '2026-11-10T20:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL' });
    expect((await call(TRAINER_ID, 'PATCH', `/api/slots/${a.id}`, { startsAt: '2026-11-10T19:30:00+02:00' })).statusCode).toBe(409);
    const ok = await call(TRAINER_ID, 'PATCH', `/api/slots/${a.id}`, { startsAt: '2026-11-10T17:00:00+02:00', note: 'зал 2' });
    expect(ok.json().slot).toMatchObject({ startsAt: '2026-11-10T15:00:00.000Z', note: 'зал 2' });
  });

  describe('series', () => {
    it('creates slots on chosen weekdays in Kyiv time, across the DST switch', async () => {
      // 29.03.2026 Київ переходить на літній час (UTC+2 → UTC+3).
      const res = await call(TRAINER_ID, 'POST', '/api/series', {
        clientId: anna,
        weekdays: [2, 4], // вт, чт
        startTime: '18:00',
        durationMin: 60,
        startDate: '2026-03-23',
        endDate: '2026-04-03',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ created: 4, skipped: [] });

      const all = (
        await call(TRAINER_ID, 'GET', range('2026-03-23T00:00:00+02:00', '2026-04-04T00:00:00+03:00'))
      ).json().slots;
      expect(all.map((s: { startsAt: string }) => s.startsAt)).toEqual([
        '2026-03-24T16:00:00.000Z',
        '2026-03-26T16:00:00.000Z',
        '2026-03-31T15:00:00.000Z', // 18:00 за літнім часом
        '2026-04-02T15:00:00.000Z',
      ]);
      expect(all.every((s: { bookings: { clientId: number }[] }) => s.bookings[0]!.clientId === anna)).toBe(true);
    });

    it('skips dates that overlap existing slots', async () => {
      await slot({ startsAt: '2026-11-12T18:30:00+02:00', durationMin: 60, type: 'INDIVIDUAL' });
      const res = await call(TRAINER_ID, 'POST', '/api/series', {
        clientId: anna,
        weekdays: [2, 4],
        startTime: '18:00',
        durationMin: 60,
        startDate: '2026-11-09',
        endDate: '2026-11-15',
      });
      expect(res.json()).toMatchObject({ created: 1, skipped: ['2026-11-12'] });
    });

    it('validates span and client', async () => {
      const base = { clientId: anna, weekdays: [1], startTime: '18:00', durationMin: 60 };
      expect((await call(TRAINER_ID, 'POST', '/api/series', { ...base, startDate: '2026-11-10', endDate: '2026-11-01' })).json().error).toBe('end_before_start');
      expect((await call(TRAINER_ID, 'POST', '/api/series', { ...base, startDate: '2026-01-01', endDate: '2027-06-01' })).json().error).toBe('series_too_long');
      expect((await call(TRAINER_ID, 'POST', '/api/series', { ...base, startTime: '25:00', startDate: '2026-11-10', endDate: '2026-11-20' })).statusCode).toBe(400);
      expect((await call(TRAINER_ID, 'POST', '/api/series', { ...base, clientId: 9999, startDate: '2026-11-10', endDate: '2026-11-20' })).statusCode).toBe(404);
    });

    it('cancels "this and following" and shortens the series', async () => {
      const { series: s } = (
        await call(TRAINER_ID, 'POST', '/api/series', {
          clientId: anna,
          weekdays: [1, 3, 5],
          startTime: '09:00',
          durationMin: 60,
          startDate: '2026-11-09',
          endDate: '2026-11-22',
        })
      ).json();
      const res = await call(TRAINER_ID, 'POST', `/api/series/${s.id}/cancel`, { fromDate: '2026-11-13' });
      expect(res.json().cancelled).toBe(4); // пт 13, пн 16, ср 18, пт 20
      const left = (await call(TRAINER_ID, 'GET', range('2026-11-09T00:00:00+02:00', '2026-11-23T00:00:00+02:00'))).json().slots;
      expect(left).toHaveLength(2);
      expect((await call(TRAINER_ID, 'GET', `/api/series/${s.id}`)).json().series.endDate).toBe('2026-11-12');
    });

    it('splits a series to change time from a date', async () => {
      const { series: s } = (
        await call(TRAINER_ID, 'POST', '/api/series', {
          clientId: boris,
          weekdays: [2],
          startTime: '18:00',
          durationMin: 60,
          startDate: '2026-11-10',
          endDate: '2026-11-30',
        })
      ).json();
      const res = await call(TRAINER_ID, 'POST', `/api/series/${s.id}/split`, {
        fromDate: '2026-11-17',
        weekdays: [2],
        startTime: '19:30',
        durationMin: 90,
        endDate: '2026-11-30',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().created).toBe(2);
      const all = (await call(TRAINER_ID, 'GET', range('2026-11-09T00:00:00+02:00', '2026-12-01T00:00:00+02:00'))).json().slots;
      expect(all.map((x: { startsAt: string; durationMin: number }) => [x.startsAt, x.durationMin])).toEqual([
        ['2026-11-10T16:00:00.000Z', 60],
        ['2026-11-17T17:30:00.000Z', 90],
        ['2026-11-24T17:30:00.000Z', 90],
      ]);
    });
  });

  it('copies one-off slots of a week to another week without participants', async () => {
    await slot({ startsAt: '2026-11-10T18:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL', clientIds: [anna] });
    await slot({ startsAt: '2026-11-12T10:00:00+02:00', durationMin: 90, type: 'GROUP', capacity: 6 });
    await call(TRAINER_ID, 'POST', '/api/series', {
      clientId: boris,
      weekdays: [3],
      startTime: '08:00',
      durationMin: 60,
      startDate: '2026-11-09',
      endDate: '2026-11-15',
    });
    // На наступному тижні вже є слот, що перетинається з груповим
    await slot({ startsAt: '2026-11-19T10:30:00+02:00', durationMin: 30, type: 'INDIVIDUAL' });

    const res = await call(TRAINER_ID, 'POST', '/api/calendar/copy-week', { from: '2026-11-09', to: '2026-11-16' });
    expect(res.json()).toMatchObject({ created: 1, skipped: ['2026-11-19T08:00:00.000Z'] });
    const next = (await call(TRAINER_ID, 'GET', range('2026-11-16T00:00:00+02:00', '2026-11-23T00:00:00+02:00'))).json().slots;
    const copied = next.find((s: { startsAt: string }) => s.startsAt === '2026-11-17T16:00:00.000Z');
    expect(copied).toMatchObject({ type: 'INDIVIDUAL', bookedCount: 0 });
  });

  it('merging a guest card into a manual card moves bookings and series', async () => {
    await call(777, 'POST', '/api/onboarding', { name: 'G', goal: 'health', experience: 'none', consent: true });
    const guestId = (await call(777, 'GET', '/api/me')).json().client.id;
    await slot({ startsAt: '2026-11-10T18:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL', clientIds: [guestId], isTrial: true });
    await slot({ startsAt: '2026-11-11T18:00:00+02:00', durationMin: 60, type: 'GROUP', capacity: 4, clientIds: [guestId, oleh] });

    const res = await call(TRAINER_ID, 'POST', `/api/clients/${oleh}/link`, { sourceClientId: guestId });
    expect(res.statusCode).toBe(200);
    const all = (await call(TRAINER_ID, 'GET', WEEK)).json().slots;
    expect(all[0].bookings).toEqual([expect.objectContaining({ clientId: oleh, isTrial: true })]);
    // У груповому слоті лишився один запис Олега
    expect(all[1].bookings).toEqual([expect.objectContaining({ clientId: oleh })]);
  });
});
