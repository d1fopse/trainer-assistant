import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createTestDb, FakeTelegram, TRAINER_ID } from './helpers.js';

/** Регресійний захист: кожен маршрут тренера відповідає 403 клієнту й 401 без підпису. */
const TRAINER_ROUTES: [string, string][] = [
  ['GET', '/api/analytics'],
  ['GET', '/api/slots/1'],
  ['POST', '/api/slots'],
  ['PATCH', '/api/slots/1'],
  ['POST', '/api/slots/1/cancel'],
  ['POST', '/api/slots/1/bookings'],
  ['POST', '/api/series'],
  ['GET', '/api/series/1'],
  ['POST', '/api/series/1/cancel'],
  ['POST', '/api/series/1/split'],
  ['POST', '/api/calendar/copy-week'],
  ['GET', '/api/clients'],
  ['POST', '/api/clients'],
  ['GET', '/api/clients/1'],
  ['PATCH', '/api/clients/1'],
  ['POST', '/api/clients/1/link'],
  ['PATCH', '/api/bookings/1'],
  ['GET', '/api/clients/1/history'],
  ['POST', '/api/clients/1/visits'],
  ['POST', '/api/clients/1/apply-unpaid'],
  ['POST', '/api/clients/1/payments'],
  ['PATCH', '/api/payments/1'],
  ['DELETE', '/api/payments/1'],
  ['POST', '/api/clients/1/passes'],
  ['PATCH', '/api/passes/1'],
  ['DELETE', '/api/passes/1'],
  ['POST', '/api/prices'],
  ['PATCH', '/api/prices/1'],
  ['DELETE', '/api/prices/1'],
  ['PUT', '/api/prices/order'],
  ['GET', '/api/slots/1/waitlist'],
  ['POST', '/api/waitlist/1/notify'],
  ['DELETE', '/api/waitlist/1'],
  ['GET', '/api/settings'],
  ['PATCH', '/api/settings'],
];

describe('route guards', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let call: Awaited<ReturnType<typeof createTestApp>>['call'];

  beforeAll(async () => {
    t = await createTestDb();
    ({ app, call } = await createTestApp(t.db, { tg: new FakeTelegram() }));
    // Активний клієнт — найвища «не тренерська» роль.
    await call(900, 'POST', '/api/onboarding', { name: 'C', goal: 'health', experience: 'none', consent: true });
    const id = (await call(900, 'GET', '/api/me')).json().client.id;
    await call(TRAINER_ID, 'PATCH', `/api/clients/${id}`, { status: 'ACTIVE' });
    expect((await call(900, 'GET', '/api/me')).json().user.role).toBe('CLIENT');
  });
  afterAll(() => t.pg.close());

  it.each(TRAINER_ROUTES)('%s %s is trainer-only', async (method, url) => {
    const res = await call(900, method as 'GET', url, method === 'GET' || method === 'DELETE' ? undefined : {});
    expect(res.statusCode).toBe(403);
    const anon = await app.inject({ method: method as 'GET', url });
    expect(anon.statusCode).toBe(401);
  });

  it('every registered /api route is either trainer-only (listed above) or a known client route', () => {
    const clientRoutes = [
      'GET /api/me',
      'PATCH /api/me/language',
      'POST /api/onboarding',
      'GET /api/me/summary',
      'GET /api/calendar',
      'GET /api/prices',
      'POST /api/slots/:id/waitlist',
      'DELETE /api/slots/:id/waitlist',
    ];
    const trainer = TRAINER_ROUTES.map(([m, u]) => `${m} ${u.replace(/\/1(?=\/|$)/g, '/:id')}`);
    const api = app.routeList.filter((r) => r.split(' ')[1]!.startsWith('/api/'));
    expect([...api].sort()).toEqual([...trainer, ...clientRoutes].sort());
  });
});
