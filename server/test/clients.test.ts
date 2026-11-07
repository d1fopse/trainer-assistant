import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createTestDb, TRAINER_ID } from './helpers.js';

const GUEST = 777;

describe('clients (trainer CRM)', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let call: Awaited<ReturnType<typeof createTestApp>>['call'];

  beforeAll(async () => {
    t = await createTestDb();
    ({ call } = await createTestApp(t.db));
  });
  beforeEach(() => t.reset());
  afterAll(() => t.pg.close());

  const create = async (body: Record<string, unknown>) => {
    const res = await call(TRAINER_ID, 'POST', '/api/clients', body);
    expect(res.statusCode).toBe(201);
    return res.json().client;
  };

  it('is closed to non-trainers', async () => {
    expect((await call(GUEST, 'GET', '/api/clients')).statusCode).toBe(403);
    expect((await call(GUEST, 'POST', '/api/clients', { name: 'X' })).statusCode).toBe(403);
    expect((await call(GUEST, 'GET', '/api/clients/1')).statusCode).toBe(403);
    expect((await call(GUEST, 'PATCH', '/api/clients/1', { status: 'ACTIVE' })).statusCode).toBe(403);
    expect((await call(GUEST, 'POST', '/api/clients/1/link', { sourceClientId: 2 })).statusCode).toBe(403);
  });

  it('trainer creates a card without Telegram; it is active by default', async () => {
    const c = await create({ name: 'Олег', phone: '+380 67 123 45 67', injuries: 'спина' });
    expect(c).toMatchObject({ name: 'Олег', status: 'ACTIVE', telegram: null, injuries: 'спина' });
  });

  it('validates input', async () => {
    expect((await call(TRAINER_ID, 'POST', '/api/clients', { name: '' })).statusCode).toBe(400);
    expect((await call(TRAINER_ID, 'POST', '/api/clients', { name: 'A', phone: 'abc' })).statusCode).toBe(400);
    expect((await call(TRAINER_ID, 'POST', '/api/clients', { name: 'A', goal: 'fly' })).statusCode).toBe(400);
    expect((await call(TRAINER_ID, 'PATCH', '/api/clients/1', { userId: 5 })).statusCode).toBe(400);
  });

  it('lists with status filter and search (name or phone)', async () => {
    await create({ name: 'Анна', phone: '+380501111111' });
    await create({ name: 'Богдан', status: 'INACTIVE' });
    await create({ name: 'Віра', phone: '+380502222222' });

    const all = (await call(TRAINER_ID, 'GET', '/api/clients')).json().clients;
    expect(all.map((c: { name: string }) => c.name)).toEqual(['Анна', 'Богдан', 'Віра']);

    const active = (await call(TRAINER_ID, 'GET', '/api/clients?status=ACTIVE')).json().clients;
    expect(active).toHaveLength(2);

    expect((await call(TRAINER_ID, 'GET', '/api/clients?q=анн')).json().clients).toHaveLength(1);
    expect((await call(TRAINER_ID, 'GET', '/api/clients?q=2222')).json().clients[0].name).toBe('Віра');
    expect((await call(TRAINER_ID, 'GET', '/api/clients?q=%25')).json().clients).toHaveLength(0);
    // Пошук за цифрами незалежно від запису.
    expect((await call(TRAINER_ID, 'GET', '/api/clients?q=0502222')).json().clients[0].name).toBe('Віра');
    expect((await call(TRAINER_ID, 'GET', `/api/clients?q=${encodeURIComponent('50 111')}`)).json().clients[0].name).toBe('Анна');
  });

  it('stores every phone as +380 XX XXX XX XX', async () => {
    const cases: [string, string][] = [
      ['0671234567', '+380 67 123 45 67'],
      ['380671234567', '+380 67 123 45 67'],
      ['+38 (067) 123-45-67', '+380 67 123 45 67'],
      ['+380 67 123 45 67', '+380 67 123 45 67'],
      ['67 123 45 67', '+380 67 123 45 67'],
      ['8 067 123 45 67', '+380 67 123 45 67'],
    ];
    for (const [input, stored] of cases) {
      expect((await create({ name: input, phone: input })).phone, input).toBe(stored);
    }
    for (const bad of ['+48 601 234 567', '12345', '+380 06 712 34 56', '+1 415 555 0101']) {
      expect((await call(TRAINER_ID, 'POST', '/api/clients', { name: 'x', phone: bad })).statusCode, bad).toBe(400);
    }
    // Анкета гостя теж нормалізує.
    await call(777, 'POST', '/api/onboarding', { name: 'Гість', phone: '093-555-12-34', goal: 'health', experience: 'none', consent: true });
    const guest = (await call(TRAINER_ID, 'GET', '/api/clients?status=GUEST')).json().clients.find((c: { name: string }) => c.name === 'Гість');
    expect(guest.phone).toBe('+380 93 555 12 34');
  });

  it('edits fields and clears them with empty strings', async () => {
    const c = await create({ name: 'Анна', trainerNotes: 'стара нотатка', phone: '+380501111111' });
    const res = await call(TRAINER_ID, 'PATCH', `/api/clients/${c.id}`, {
      trainerNotes: '',
      phone: '',
      goal: 'strength',
    });
    expect(res.json().client).toMatchObject({ trainerNotes: null, phone: null, goal: 'strength' });
    expect((await call(TRAINER_ID, 'PATCH', '/api/clients/999', { name: 'X' })).statusCode).toBe(404);
  });

  it('sets the referrer manually and shows referrals on the referrer card', async () => {
    const anna = await create({ name: 'Анна' });
    const oleh = await create({ name: 'Олег', referredByClientId: anna.id });
    expect(oleh.referredBy).toEqual({ id: anna.id, name: 'Анна' });

    const card = (await call(TRAINER_ID, 'GET', `/api/clients/${anna.id}`)).json().client;
    expect(card.referrals).toEqual([{ id: oleh.id, name: 'Олег' }]);

    // Не можна запросити самого себе або неіснуючого клієнта.
    expect(
      (await call(TRAINER_ID, 'PATCH', `/api/clients/${anna.id}`, { referredByClientId: anna.id })).statusCode,
    ).toBe(400);
    expect(
      (await call(TRAINER_ID, 'PATCH', `/api/clients/${anna.id}`, { referredByClientId: 999 })).statusCode,
    ).toBe(400);

    const cleared = await call(TRAINER_ID, 'PATCH', `/api/clients/${oleh.id}`, { referredByClientId: null });
    expect(cleared.json().client.referredBy).toBeNull();
  });

  it('approving a guest makes them a client', async () => {
    await call(GUEST, 'POST', '/api/onboarding', {
      name: 'Гість',
      goal: 'health',
      experience: 'none',
      consent: true,
    });
    const guests = (await call(TRAINER_ID, 'GET', '/api/clients?status=GUEST')).json().clients;
    expect(guests).toHaveLength(1);
    expect(guests[0].hasTelegram).toBe(true);

    await call(TRAINER_ID, 'PATCH', `/api/clients/${guests[0].id}`, { status: 'ACTIVE' });
    expect((await call(GUEST, 'GET', '/api/me')).json().user.role).toBe('CLIENT');
  });

  describe('linking Telegram to a manual card', () => {
    it('merges the guest card into the manual card, keeping the manual data', async () => {
      const inviter = await create({ name: 'Запрошувач' });
      const manual = await create({
        name: 'Олег (вручну)',
        phone: '+380671234567',
        trainerNotes: 'ходить з 2024',
        referredByClientId: inviter.id,
      });

      await call(GUEST, 'POST', '/api/onboarding', {
        name: 'Oleh',
        phone: '+380999999999',
        goal: 'strength',
        experience: 'beginner',
        injuries: 'коліно',
        consent: true,
      });
      const [guest] = (await call(TRAINER_ID, 'GET', '/api/clients?withTelegram=true')).json().clients;

      const res = await call(TRAINER_ID, 'POST', `/api/clients/${manual.id}/link`, {
        sourceClientId: guest.id,
      });
      expect(res.statusCode).toBe(200);
      const card = res.json().client;
      expect(card).toMatchObject({
        id: manual.id,
        name: 'Олег (вручну)',
        phone: '+380 67 123 45 67', // ручні дані мають пріоритет
        trainerNotes: 'ходить з 2024',
        goal: 'strength', // порожні поля доповнено з анкети
        injuries: 'коліно',
        status: 'ACTIVE',
        referredBy: { id: inviter.id, name: 'Запрошувач' },
      });
      expect(card.consentAt).not.toBeNull();
      expect(card.telegram).not.toBeNull();

      // Картку гостя видалено, користувач тепер бачить себе як клієнта з ручної картки.
      expect((await call(TRAINER_ID, 'GET', `/api/clients/${guest.id}`)).statusCode).toBe(404);
      const me = (await call(GUEST, 'GET', '/api/me')).json();
      expect(me.user.role).toBe('CLIENT');
      expect(me.client.id).toBe(manual.id);
    });

    it('moves referrals that pointed at the guest card', async () => {
      const manual = await create({ name: 'Основна' });
      await call(GUEST, 'POST', '/api/onboarding', { name: 'G', goal: 'health', experience: 'none', consent: true });
      const [guest] = (await call(TRAINER_ID, 'GET', '/api/clients?status=GUEST')).json().clients;
      const friend = await create({ name: 'Друг', referredByClientId: guest.id });

      await call(TRAINER_ID, 'POST', `/api/clients/${manual.id}/link`, { sourceClientId: guest.id });
      const f = (await call(TRAINER_ID, 'GET', `/api/clients/${friend.id}`)).json().client;
      expect(f.referredBy).toEqual({ id: manual.id, name: 'Основна' });
    });

    it('refuses invalid combinations', async () => {
      const a = await create({ name: 'A' });
      const b = await create({ name: 'B' });
      await call(GUEST, 'POST', '/api/onboarding', { name: 'G', goal: 'health', experience: 'none', consent: true });
      const [guest] = (await call(TRAINER_ID, 'GET', '/api/clients?status=GUEST')).json().clients;

      // Джерело без Telegram
      expect((await call(TRAINER_ID, 'POST', `/api/clients/${a.id}/link`, { sourceClientId: b.id })).statusCode).toBe(409);
      // Ціль уже з Telegram
      expect((await call(TRAINER_ID, 'POST', `/api/clients/${guest.id}/link`, { sourceClientId: a.id })).statusCode).toBe(409);
      // Сам у себе
      expect((await call(TRAINER_ID, 'POST', `/api/clients/${a.id}/link`, { sourceClientId: a.id })).statusCode).toBe(400);
      // Неіснуюча
      expect((await call(TRAINER_ID, 'POST', `/api/clients/999/link`, { sourceClientId: guest.id })).statusCode).toBe(404);
    });
  });
});
