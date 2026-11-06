import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { eq } from 'drizzle-orm';
import { requireTrainer } from '../auth.js';
import { HttpError } from '../http.js';
import { bookings, clients, passes, payments, prices, slots, waitlist } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { ZONE } from '../time.js';

/**
 * Демо-дані для перевірки застосунку: клієнти, розклад за 3 тижні назад і 2 вперед,
 * відмітки, абонементи, оплати, лист очікування. Усе позначено is_demo і видаляється
 * однією дією (записи, платежі й абонементи видаляються разом із клієнтами).
 * Демо-клієнти не мають Telegram, тож бот їм нічого не надсилає.
 */
export function registerDemoRoutes(app: FastifyInstance, db: Db, now: () => Date = () => new Date()) {
  app.get('/api/demo', { preHandler: requireTrainer }, async () => {
    const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.isDemo, true)).limit(1);
    return { exists: Boolean(row) };
  });

  app.post('/api/demo', { preHandler: requireTrainer }, async () => {
    const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.isDemo, true)).limit(1);
    if (row) throw new HttpError(409, 'demo_exists');
    return db.transaction((tx) => seed(tx as unknown as Db, now()));
  });

  app.delete('/api/demo', { preHandler: requireTrainer }, async () => {
    return db.transaction(async (tx) => {
      // Записи, платежі, абонементи, черга й журнал видаляються каскадом разом із клієнтами.
      const c = await tx.delete(clients).where(eq(clients.isDemo, true)).returning({ id: clients.id });
      const s = await tx.delete(slots).where(eq(slots.isDemo, true)).returning({ id: slots.id });
      const p = await tx.delete(prices).where(eq(prices.isDemo, true)).returning({ id: prices.id });
      return { clients: c.length, slots: s.length, prices: p.length };
    });
  });
}

type Key = 'oleh' | 'anna' | 'iryna' | 'taras' | 'mariia' | 'dmytro' | 'kateryna' | 'serhii';

const PEOPLE: Record<Key, Partial<typeof clients.$inferInsert> & { name: string }> = {
  oleh: {
    name: 'Олег Коваль',
    phone: '+380 67 123 45 67',
    status: 'ACTIVE',
    goal: 'strength',
    experience: 'intermediate',
    injuries: 'Протрузія L5–S1, без осьового навантаження',
    trainerNotes: 'Любить ранкові тренування. Запросив Анну.',
  },
  anna: { name: 'Анна Шевченко', phone: '+380 50 111 22 33', status: 'ACTIVE', goal: 'weight_loss', experience: 'beginner' },
  iryna: {
    name: 'Ірина Ткач',
    phone: '+380 93 555 12 34',
    status: 'ACTIVE',
    goal: 'health',
    experience: 'beginner',
    injuries: 'Болить коліно після бігу',
  },
  taras: { name: 'Тарас Мельник', phone: '+380 66 777 88 99', status: 'ACTIVE', goal: 'muscle_gain', experience: 'advanced' },
  mariia: { name: 'Марія Бойко', phone: '+380 97 222 33 44', status: 'ACTIVE', goal: 'health', experience: 'intermediate' },
  dmytro: {
    name: 'Дмитро Лисенко',
    phone: '+380 63 444 55 66',
    status: 'ACTIVE',
    goal: 'muscle_gain',
    experience: 'none',
    trainerNotes: 'Прийшов на пробне, купив абонемент.',
  },
  kateryna: {
    name: 'Катерина Савчук',
    phone: '+380 68 999 00 11',
    status: 'GUEST',
    goal: 'weight_loss',
    experience: 'none',
    health: 'Невисокий тиск',
  },
  serhii: { name: 'Сергій Гнатюк', phone: '+380 95 321 65 87', status: 'INACTIVE', goal: 'other', experience: 'beginner' },
};

type SlotPlan = { time: string; dur: number; group?: { cap: number; note: string }; who: Key[] };

/** Типовий тиждень тренера (1 = понеділок). */
const WEEK: Record<number, SlotPlan[]> = {
  1: [
    { time: '07:00', dur: 60, who: ['dmytro'] },
    { time: '18:00', dur: 60, who: ['oleh'] },
    { time: '20:00', dur: 90, group: { cap: 6, note: 'Функціональний тренінг' }, who: ['oleh', 'anna', 'iryna'] },
  ],
  2: [
    { time: '09:00', dur: 60, who: ['anna'] },
    { time: '18:00', dur: 60, who: ['taras'] },
    { time: '19:00', dur: 60, who: [] },
  ],
  3: [
    { time: '07:00', dur: 60, who: ['dmytro'] },
    { time: '10:00', dur: 90, group: { cap: 4, note: 'Мобільність і спина' }, who: ['iryna', 'mariia'] },
    { time: '18:00', dur: 60, who: ['oleh'] },
  ],
  4: [
    { time: '09:00', dur: 60, who: ['anna'] },
    { time: '18:00', dur: 60, who: ['mariia'] },
    { time: '20:00', dur: 60, who: [] },
  ],
  5: [
    { time: '18:00', dur: 60, who: ['taras'] },
    { time: '19:00', dur: 60, who: [] },
    { time: '20:00', dur: 90, group: { cap: 6, note: 'Функціональний тренінг' }, who: ['oleh', 'anna', 'dmytro'] },
  ],
  6: [
    { time: '10:00', dur: 60, group: { cap: 2, note: 'Пара' }, who: ['iryna', 'mariia'] },
    { time: '12:00', dur: 60, who: ['taras'] },
    { time: '14:00', dur: 60, who: [] },
  ],
};

/** Скільки занять має лишитися на абонементі після всіх відміток. */
const PASS_LEFT: Partial<Record<Key, { left: number; validDays: number | null; method: 'CASH' | 'CARD' | 'TRANSFER' }>> = {
  oleh: { left: 5, validDays: 45, method: 'CARD' },
  anna: { left: 3, validDays: 45, method: 'CASH' },
  iryna: { left: 7, validDays: null, method: 'TRANSFER' },
  taras: { left: 1, validDays: 45, method: 'CARD' },
  mariia: { left: 2, validDays: 24, method: 'CASH' },
  dmytro: { left: 6, validDays: 45, method: 'TRANSFER' },
};

/** Хто вже продовжив абонемент і скільки днів тому. */
const RENEW: Partial<Record<Key, number>> = { oleh: 5, anna: 2, iryna: 4 };

const PRICE_LIST: (typeof prices.$inferInsert)[] = [
  { kind: 'SINGLE', titleUk: 'Персональне тренування', titleRu: 'Персональная тренировка', descriptionUk: '60 хвилин, індивідуальна програма', priceUah: 700 },
  { kind: 'SINGLE', titleUk: 'Пробне заняття', titleRu: 'Пробное занятие', descriptionUk: 'Знайомство, тестування, план', priceUah: 350 },
  { kind: 'SINGLE', titleUk: 'Групове заняття', titleRu: 'Групповое занятие', descriptionUk: '90 хвилин, до 6 людей', priceUah: 400 },
  { kind: 'PASS', titleUk: 'Абонемент 8 занять', titleRu: 'Абонемент 8 занятий', descriptionUk: 'Діє 6 тижнів', priceUah: 5000, sessionsCount: 8 },
  { kind: 'PASS', titleUk: 'Абонемент 12 занять', titleRu: 'Абонемент 12 занятий', descriptionUk: 'Діє 6 тижнів', priceUah: 6900, sessionsCount: 12 },
];

async function seed(db: Db, nowDate: Date) {
  const now = DateTime.fromJSDate(nowDate, { zone: ZONE });
  const start = now.startOf('week').minus({ weeks: 3 });
  const end = now.startOf('week').plus({ weeks: 2 });

  // Ціни — лише якщо тренер ще не створив своїх.
  const existing = await db.select({ id: prices.id }).from(prices).limit(1);
  let priceCount = 0;
  if (existing.length === 0) {
    await db.insert(prices).values(PRICE_LIST.map((p, i) => ({ ...p, sortOrder: i, isDemo: true })));
    priceCount = PRICE_LIST.length;
  }

  // Клієнти.
  const ids = {} as Record<Key, number>;
  for (const [key, p] of Object.entries(PEOPLE) as [Key, (typeof PEOPLE)[Key]][]) {
    const [row] = await db
      .insert(clients)
      .values({ ...p, isDemo: true, consentAt: start.toJSDate(), createdAt: start.minus({ weeks: key === 'kateryna' ? -3 : 4 }).toJSDate() })
      .returning({ id: clients.id });
    ids[key] = row!.id;
  }
  await db.update(clients).set({ referredByClientId: ids.oleh }).where(eq(clients.id, ids.anna));

  // Розклад: проходимо дні від start до end.
  type Planned = { key: Key; slotId: number; at: DateTime; trial: boolean };
  const planned: Planned[] = [];
  let slotCount = 0;
  let firstDmytro = true;
  let futureSatPair: number | null = null;
  for (let d = start; d < end; d = d.plus({ days: 1 })) {
    for (const plan of WEEK[d.weekday] ?? []) {
      const [h, m] = plan.time.split(':').map(Number);
      const at = d.set({ hour: h!, minute: m!, second: 0, millisecond: 0 });
      const [slot] = await db
        .insert(slots)
        .values({
          startsAt: at.toJSDate(),
          durationMin: plan.dur,
          type: plan.group ? 'GROUP' : 'INDIVIDUAL',
          capacity: plan.group?.cap ?? 1,
          note: plan.group?.note ?? null,
          isDemo: true,
        })
        .returning({ id: slots.id });
      slotCount++;
      if (plan.group?.note === 'Пара' && at > now && futureSatPair === null) futureSatPair = slot!.id;
      for (const key of plan.who) {
        const trial = key === 'dmytro' && firstDmytro;
        if (key === 'dmytro') firstDmytro = false;
        planned.push({ key, slotId: slot!.id, at, trial });
      }
    }
  }

  // Відмітки: минулі заняття — «прийшов» (подекуди неявка), сьогоднішні й майбутні — записані.
  const today = now.startOf('day');
  let noShowTick = 0;
  type Done = Planned & { status: 'ATTENDED' | 'NO_SHOW' | 'BOOKED' };
  const done: Done[] = planned.map((p) => {
    if (p.at >= today) return { ...p, status: 'BOOKED' };
    noShowTick++;
    // Кожне 9-те минуле заняття — неявка.
    return { ...p, status: !p.trial && noShowTick % 9 === 0 ? 'NO_SHOW' : 'ATTENDED' };
  });

  // Абонементи: перший куплено на початку періоду (у Дмитра — після пробного).
  // Дехто вже продовжив: старий абонемент вичерпано, новий куплено кілька днів тому —
  // так у звіті є дохід і за минулий, і за поточний місяць.
  const passFor = new Map<Done, number>();
  let paymentCount = 0;
  const addPass = async (key: Key, total: number, left: number, bought: DateTime, expires: string | null, method: 'CASH' | 'CARD' | 'TRANSFER') => {
    const [pay] = await db
      .insert(payments)
      .values({
        clientId: ids[key],
        amountUah: Math.round((total * 625) / 50) * 50,
        paidAt: bought.toISODate()!,
        method,
        purpose: 'PASS',
        note: `Абонемент на ${total}`,
      })
      .returning({ id: payments.id });
    paymentCount++;
    const [pass] = await db
      .insert(passes)
      .values({ clientId: ids[key], totalSessions: total, remaining: left, purchasedAt: bought.toISODate()!, expiresAt: expires, paymentId: pay!.id })
      .returning({ id: passes.id });
    return pass!.id;
  };
  for (const [key, cfg] of Object.entries(PASS_LEFT) as [Key, NonNullable<(typeof PASS_LEFT)[Key]>][]) {
    const attended = done.filter((x) => x.key === key && !x.trial && x.status === 'ATTENDED');
    const trialAt = done.find((x) => x.key === key && x.trial)?.at;
    const bought = trialAt ? trialAt.plus({ days: 1 }) : start.minus({ days: 1 });
    const renewDays = RENEW[key];
    const renewAt = renewDays === undefined ? null : now.minus({ days: renewDays }).startOf('day');
    const before = renewAt ? attended.filter((x) => x.at < renewAt) : attended;
    const after = renewAt ? attended.filter((x) => x.at >= renewAt) : [];
    if (renewAt) {
      const oldId = await addPass(key, before.length, 0, bought, bought.plus({ days: 45 }).toISODate()!, cfg.method);
      for (const x of before) passFor.set(x, oldId);
      const newId = await addPass(key, after.length + cfg.left, cfg.left, renewAt, cfg.validDays === null ? null : renewAt.plus({ days: cfg.validDays }).toISODate()!, cfg.method);
      for (const x of after) passFor.set(x, newId);
    } else {
      const expires = cfg.validDays === null ? null : key === 'mariia' ? now.plus({ days: 3 }).toISODate()! : bought.plus({ days: cfg.validDays }).toISODate()!;
      const id = await addPass(key, before.length + cfg.left, cfg.left, bought, expires, cfg.method);
      for (const x of before) passFor.set(x, id);
    }
  }
  // Оплата пробного.
  const trial = done.find((x) => x.trial);
  if (trial) {
    await db.insert(payments).values({ clientId: ids.dmytro, amountUah: 350, paidAt: trial.at.toISODate()!, method: 'CASH', purpose: 'TRIAL' });
    paymentCount++;
  }

  // Записи.
  let bookingCount = 0;
  for (const x of done) {
    const passId = passFor.get(x) ?? null;
    const deducted = passId !== null;
    await db.insert(bookings).values({
      slotId: x.slotId,
      clientId: ids[x.key],
      status: x.status,
      isTrial: x.trial,
      deducted,
      passId,
      markedAt: x.status === 'BOOKED' ? null : x.at.plus({ hours: 1 }).toJSDate(),
      createdAt: x.at.minus({ days: 3 }).toJSDate(),
    });
    bookingCount++;
  }

  // Дмитро чекає місця в повній «парі» в суботу.
  if (futureSatPair !== null) {
    await db.insert(waitlist).values({ slotId: futureSatPair, clientId: ids.dmytro, createdAt: now.minus({ hours: 3 }).toJSDate() });
  }

  return { clients: Object.keys(ids).length, slots: slotCount, bookings: bookingCount, payments: paymentCount, prices: priceCount };
}
