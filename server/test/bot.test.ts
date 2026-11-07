import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema.js';
import { webhookSecret } from '../src/bot/webhook.js';
import { createTestApp, createTestDb, FakeTelegram, TOKEN, TRAINER_ID } from './helpers.js';

const ANNA = 701; // клієнт з Telegram
const BORYS = 702; // клієнт з Telegram
const GUEST = 703;

describe('bot: webhook, reminders, summary, waitlist, broadcasts', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let call: Awaited<ReturnType<typeof createTestApp>>['call'];
  const tg = new FakeTelegram();
  let now = new Date('2026-11-10T13:00:00Z'); // 15:00 за Києвом
  let annaId: number;
  let borysId: number;
  let updateId = 1;

  const webhook = (update: Record<string, unknown>, secret = webhookSecret(TOKEN)) =>
    app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      payload: { update_id: updateId++, ...update },
    });
  const message = (from: number, text: string, extra: Record<string, unknown> = {}) =>
    webhook({
      message: {
        message_id: updateId,
        chat: { id: from, type: 'private' },
        from: { id: from, first_name: `U${from}`, ...extra },
        text,
      },
    });
  const callback = (from: number, data: string) =>
    webhook({ callback_query: { id: `cb${updateId}`, from: { id: from }, data, message: { message_id: 1, chat: { id: from, type: 'private' } } } });

  async function client(tgId: number, name: string) {
    await call(tgId, 'POST', '/api/onboarding', { name, goal: 'health', experience: 'none', consent: true });
    const id = (await call(tgId, 'GET', '/api/me')).json().client.id;
    await call(TRAINER_ID, 'PATCH', `/api/clients/${id}`, { status: 'ACTIVE' });
    return id as number;
  }
  const slot = async (startsAt: string, clientIds: number[], extra: Record<string, unknown> = {}) => {
    const res = await call(TRAINER_ID, 'POST', '/api/slots', { startsAt, durationMin: 60, type: 'INDIVIDUAL', clientIds, ...extra });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().slot;
  };

  beforeAll(async () => {
    t = await createTestDb();
    ({ app, call } = await createTestApp(t.db, { tg, now: () => now, botSendDelayMs: 0 }, { [TRAINER_ID]: { username: 'coach' } }));
  });
  beforeEach(async () => {
    await t.reset();
    now = new Date('2026-11-10T13:00:00Z');
    // Тренер відкрив додаток із username — потрібен для кнопки «Написати тренеру».
    await call(TRAINER_ID, 'GET', '/api/me');
    annaId = await client(ANNA, 'Анна');
    borysId = await client(BORYS, 'Борис');
    tg.clear();
  });
  afterAll(() => t.pg.close());

  it('rejects webhook calls without the secret', async () => {
    expect((await webhook({}, 'wrong')).statusCode).toBe(401);
    expect((await webhook({})).statusCode).toBe(200);
  });

  it('/start greets a client with a contact button and records that the bot may write', async () => {
    await message(GUEST, '/start', { language_code: 'ru', username: 'guesty' });
    const [m] = tg.to(GUEST);
    expect(m!.params.text).toContain('Привет');
    expect(JSON.stringify(m!.params.reply_markup)).toContain('https://t.me/coach');
    // web_app-кнопка лише для https-адреси додатку (у тестах http)
    expect(JSON.stringify(m!.params.reply_markup)).not.toContain('web_app');
    const [u] = await t.db.select().from(users).where(eq(users.telegramId, BigInt(GUEST)));
    expect(u).toMatchObject({ language: 'ru', username: 'guesty' });
    expect(u!.botStartedAt).toBeInstanceOf(Date);
  });

  it('/start for the trainer lists commands and sets them', async () => {
    await message(TRAINER_ID, '/start');
    expect(tg.to(TRAINER_ID)[0]!.params.text).toContain('/broadcast');
    expect(tg.sent('setMyCommands')).toHaveLength(1);
  });

  it('clients get a hint; trainer-only commands are refused', async () => {
    await message(ANNA, 'Можна завтра?');
    expect(tg.to(ANNA)[0]!.params.text).toContain('напишіть тренеру');
    await message(ANNA, '/broadcast');
    expect(tg.to(ANNA)[1]!.params.text).toContain('лише тренеру');
  });

  describe('reminders 3 hours before', () => {
    it('sends once to clients with Telegram, only within 3 hours', async () => {
      await slot('2026-11-10T17:00:00+02:00', [annaId]); // через 2 год
      await slot('2026-11-10T19:00:00+02:00', [borysId]); // через 4 год
      const manual = (await call(TRAINER_ID, 'POST', '/api/clients', { name: 'Без Telegram' })).json().client.id;
      await slot('2026-11-10T16:00:00+02:00', [manual]);

      await app.notifier!.tick();
      expect(tg.to(ANNA)).toHaveLength(1);
      expect(tg.to(BORYS)).toHaveLength(0);
      expect(tg.to(ANNA)[0]!.params.text).toContain('сьогодні о 17:00');

      await app.notifier!.tick();
      expect(tg.to(ANNA)).toHaveLength(1); // без дублів

      now = new Date('2026-11-10T15:30:00Z'); // 17:30 — до заняття Бориса 1,5 год
      await app.notifier!.tick();
      expect(tg.to(BORYS)).toHaveLength(1);
    });

    it('skips cancelled bookings and respects the setting', async () => {
      const s = await slot('2026-11-10T17:00:00+02:00', [annaId]);
      await call(TRAINER_ID, 'PATCH', `/api/bookings/${s.bookings[0].id}`, { status: 'CANCELLED' });
      await slot('2026-11-10T16:00:00+02:00', [borysId]);
      await call(TRAINER_ID, 'PATCH', '/api/settings', { remindersEnabled: false });
      await app.notifier!.tick();
      expect(tg.sent().filter((c) => String(c.params.text).includes('Нагадування'))).toHaveLength(0);
      await call(TRAINER_ID, 'PATCH', '/api/settings', { remindersEnabled: true });
      await app.notifier!.tick();
      expect(tg.to(BORYS)).toHaveLength(1);
      expect(tg.to(ANNA)).toHaveLength(0);
    });

    it('marks users who blocked the bot and stops writing to them', async () => {
      tg.blocked.add(String(ANNA));
      await slot('2026-11-10T17:00:00+02:00', [annaId]);
      await app.notifier!.tick();
      const [u] = await t.db.select().from(users).where(eq(users.telegramId, BigInt(ANNA)));
      expect(u!.botBlockedAt).toBeInstanceOf(Date);
      // /start знімає позначку
      tg.blocked.clear();
      await message(ANNA, '/start');
      const [u2] = await t.db.select().from(users).where(eq(users.telegramId, BigInt(ANNA)));
      expect(u2!.botBlockedAt).toBeNull();
    });
  });

  describe('daily summary for the trainer', () => {
    it('is sent once per day after the configured time, with names', async () => {
      await slot('2026-11-10T18:00:00+02:00', [annaId], { isTrial: true });
      await call(TRAINER_ID, 'POST', '/api/slots', { startsAt: '2026-11-10T19:00:00+02:00', durationMin: 90, type: 'GROUP', capacity: 6, clientIds: [borysId] });
      await call(TRAINER_ID, 'POST', '/api/slots', { startsAt: '2026-11-10T21:00:00+02:00', durationMin: 60, type: 'INDIVIDUAL' });

      now = new Date('2026-11-10T05:30:00Z'); // 07:30
      await app.notifier!.tick();
      expect(tg.to(TRAINER_ID)).toHaveLength(0);

      now = new Date('2026-11-10T06:01:00Z'); // 08:01
      await app.notifier!.tick();
      await app.notifier!.tick();
      const msgs = tg.to(TRAINER_ID);
      expect(msgs).toHaveLength(1);
      const text = String(msgs[0]!.params.text);
      expect(text).toContain('3 заняття');
      expect(text).toContain('<b>18:00–19:00</b> Анна (пробне)');
      expect(text).toContain('група 1/6: Борис');
      expect(text).toContain('<i>вільно</i>');
    });

    it('follows the configured time and /today works on demand', async () => {
      await call(TRAINER_ID, 'PATCH', '/api/settings', { dailySummaryTime: '06:30' });
      expect((await call(TRAINER_ID, 'GET', '/api/settings')).json().settings).toEqual({ dailySummaryTime: '06:30', remindersEnabled: true });
      expect((await call(ANNA, 'GET', '/api/settings')).statusCode).toBe(403);
      now = new Date('2026-11-10T04:35:00Z'); // 06:35
      await app.notifier!.tick();
      expect(String(tg.to(TRAINER_ID)[0]!.params.text)).toContain('занять немає');

      await message(TRAINER_ID, '/today');
      expect(tg.to(TRAINER_ID)).toHaveLength(2);
    });
  });

  describe('waitlist 🔔', () => {
    const FUTURE = '2099-01-10T18:00:00+02:00';

    it('only active clients can queue, only on full future slots', async () => {
      const free = await slot('2099-01-11T18:00:00+02:00', []);
      expect((await call(BORYS, 'POST', `/api/slots/${free.id}/waitlist`)).json().error).toBe('slot_has_seats');
      const full = await slot(FUTURE, [annaId]);
      expect((await call(ANNA, 'POST', `/api/slots/${full.id}/waitlist`)).json().error).toBe('already_booked');
      expect((await call(GUEST, 'POST', `/api/slots/${full.id}/waitlist`)).statusCode).toBe(403);
      expect((await call(BORYS, 'POST', `/api/slots/${full.id}/waitlist`)).statusCode).toBe(201);
      // повторно — без помилки й без дубля
      expect((await call(BORYS, 'POST', `/api/slots/${full.id}/waitlist`)).statusCode).toBe(201);

      // Клієнт бачить лише 4 тижні вперед — «переносимось» ближче до слота.
      const saved = now;
      now = new Date('2099-01-09T10:00:00Z');
      const cal = (await call(BORYS, 'GET', `/api/calendar?from=${encodeURIComponent('2099-01-10T00:00:00+02:00')}&to=${encodeURIComponent('2099-01-12T00:00:00+02:00')}`)).json().slots;
      now = saved;
      expect(cal.find((s: { id: number }) => s.id === full.id)).toMatchObject({ freeSeats: 0, waiting: true });

      const trainerView = (await call(TRAINER_ID, 'GET', `/api/slots/${full.id}`)).json().slot;
      expect(trainerView.waitlist).toEqual([expect.objectContaining({ name: 'Борис', status: 'WAITING' })]);

      expect((await call(BORYS, 'DELETE', `/api/slots/${full.id}/waitlist`)).json().waiting).toBe(false);
      expect((await call(TRAINER_ID, 'GET', `/api/slots/${full.id}`)).json().slot.waitlist).toHaveLength(0);
    });

    it('when a seat frees up, only the first in line is notified', async () => {
      const veraTg = 704;
      await client(veraTg, 'Віра');
      const full = await slot(FUTURE, [annaId]);
      await call(BORYS, 'POST', `/api/slots/${full.id}/waitlist`);
      await call(veraTg, 'POST', `/api/slots/${full.id}/waitlist`);
      tg.clear();

      await call(TRAINER_ID, 'PATCH', `/api/bookings/${full.bookings[0].id}`, { status: 'CANCELLED' });
      expect(tg.to(BORYS)).toHaveLength(1);
      expect(String(tg.to(BORYS)[0]!.params.text)).toContain('Звільнилось місце');
      expect(JSON.stringify(tg.to(BORYS)[0]!.params.reply_markup)).toContain('https://t.me/coach');
      expect(tg.to(veraTg)).toHaveLength(0);

      const wl = (await call(TRAINER_ID, 'GET', `/api/slots/${full.id}`)).json().slot.waitlist;
      expect(wl.map((w: { status: string }) => w.status)).toEqual(['NOTIFIED', 'WAITING']);

      // Тренер вручну повідомляє наступного
      const r = await call(TRAINER_ID, 'POST', `/api/waitlist/${wl[1].id}/notify`);
      expect(r.json().delivered).toBe(true);
      expect(tg.to(veraTg)).toHaveLength(1);

      // Бориса записали — він зникає з черги
      await call(TRAINER_ID, 'POST', `/api/slots/${full.id}/bookings`, { clientId: borysId });
      const wl2 = (await call(TRAINER_ID, 'GET', `/api/slots/${full.id}`)).json().slot.waitlist;
      expect(wl2.map((w: { name: string }) => w.name)).toEqual(['Віра']);
    });

    it('raising group capacity also notifies the queue', async () => {
      const g = (await call(TRAINER_ID, 'POST', '/api/slots', { startsAt: FUTURE, durationMin: 60, type: 'GROUP', capacity: 2, clientIds: [annaId, (await call(TRAINER_ID, 'POST', '/api/clients', { name: 'X' })).json().client.id] })).json().slot;
      await call(BORYS, 'POST', `/api/slots/${g.id}/waitlist`);
      tg.clear();
      await call(TRAINER_ID, 'PATCH', `/api/slots/${g.id}`, { capacity: 3 });
      expect(tg.to(BORYS)).toHaveLength(1);
    });
  });

  describe('broadcasts', () => {
    it('trainer composes, picks an audience, previews, and sends once', async () => {
      const archivedTg = 705;
      const archived = await client(archivedTg, 'Архів');
      await call(TRAINER_ID, 'PATCH', `/api/clients/${archived}`, { status: 'INACTIVE' });
      await call(GUEST, 'POST', '/api/onboarding', { name: 'Гість', goal: 'health', experience: 'none', consent: true });
      tg.blocked.add(String(BORYS));
      tg.clear();

      await message(TRAINER_ID, '/broadcast');
      expect(String(tg.to(TRAINER_ID).at(-1)!.params.text)).toContain('Надішліть повідомлення');
      await message(TRAINER_ID, 'У п\'ятницю зал зачинено');
      expect(JSON.stringify(tg.to(TRAINER_ID).at(-1)!.params.reply_markup)).toContain('bc:aud:ACTIVE');

      await callback(TRAINER_ID, 'bc:aud:ALL');
      // попередній перегляд: копія тренеру + кнопки
      expect(tg.to(TRAINER_ID, 'copyMessage')).toHaveLength(1);
      const preview = tg.to(TRAINER_ID).at(-1)!;
      expect(String(preview.params.text)).toContain('Усім клієнтам — 3'); // Анна, Борис, Гість; без архіву й тренера
      const sendData = JSON.stringify(preview.params.reply_markup).match(/bc:send:\d+/)![0];

      await callback(TRAINER_ID, sendData);
      await Promise.all([...app.bot!.pending]);
      const copies = tg.sent('copyMessage').filter((c) => String(c.params.chat_id) !== String(TRAINER_ID));
      expect(copies.map((c) => String(c.params.chat_id)).sort()).toEqual([String(ANNA), String(BORYS), String(GUEST)].sort());
      expect(String(tg.to(TRAINER_ID).at(-1)!.params.text)).toContain('доставлено 2, не доставлено 1');

      // Повторне натискання нічого не надсилає
      const before = tg.sent('copyMessage').length;
      await callback(TRAINER_ID, sendData);
      expect(tg.sent('copyMessage').length).toBe(before);
      expect(String(tg.to(TRAINER_ID).at(-1)!.params.text)).toContain('неактуальна');
    });

    it('audiences: active only and group participants', async () => {
      await call(GUEST, 'POST', '/api/onboarding', { name: 'Гість', goal: 'health', experience: 'none', consent: true });
      await call(TRAINER_ID, 'POST', '/api/slots', { startsAt: '2026-11-12T10:00:00+02:00', durationMin: 60, type: 'GROUP', capacity: 5, clientIds: [borysId] });
      expect(await app.bot!.recipients('ACTIVE')).toHaveLength(2);
      const group = await app.bot!.recipients('GROUP');
      expect(group.map((r) => String(r.telegramId))).toEqual([String(BORYS)]);
    });

    it('can be cancelled; ignores callbacks from non-trainers', async () => {
      await message(TRAINER_ID, '/broadcast');
      await message(TRAINER_ID, 'текст');
      await message(TRAINER_ID, '/cancel');
      await callback(TRAINER_ID, 'bc:aud:ALL');
      expect(String(tg.to(TRAINER_ID).at(-1)!.params.text)).toContain('неактуальна');
      tg.clear();
      await callback(ANNA, 'bc:send:1');
      expect(tg.sent('copyMessage')).toHaveLength(0);
    });
  });
});
