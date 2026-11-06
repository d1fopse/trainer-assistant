import { DateTime } from 'luxon';
import { eq, inArray } from 'drizzle-orm';
import { bookings, clients, passes, payments, prices, slots, waitlist } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { ZONE } from '../time.js';

/**
 * Великий набір демо-даних: ~40 клієнтів, 12 тижнів історії й 3 тижні наперед,
 * постійні клієнти зі своїми днями, групи, разові записи, пробні, неявки й скасування,
 * абонементи, що закінчуються й продовжуються, оплати, лист очікування.
 * Генератор детермінований (той самий результат для тієї самої дати).
 */

const WEEKS_BACK = 12;
const WEEKS_AHEAD = 3;

const FIRST_M = ['Олег', 'Тарас', 'Дмитро', 'Сергій', 'Андрій', 'Максим', 'Віктор', 'Богдан', 'Ігор', 'Роман', 'Юрій', 'Артем', 'Назар', 'Євген', 'Олександр', 'Владислав'];
const FIRST_F = ['Анна', 'Ірина', 'Марія', 'Катерина', 'Олена', 'Наталія', 'Юлія', 'Софія', 'Дарина', 'Вікторія', 'Оксана', 'Тетяна', 'Христина', 'Аліна', 'Людмила', 'Ярослава'];
const LAST = ['Коваль', 'Шевченко', 'Ткач', 'Мельник', 'Бойко', 'Лисенко', 'Савчук', 'Гнатюк', 'Кравченко', 'Бондар', 'Олійник', 'Поліщук', 'Мороз', 'Марченко', 'Руденко', 'Павленко', 'Литвин', 'Козак', 'Гончар', 'Захарченко', 'Клименко', 'Петренко', 'Романюк', 'Сидоренко'];
const LAST_F: Record<string, string> = { Кравченко: 'Кравченко', Петренко: 'Петренко' };
const GOALS = ['weight_loss', 'muscle_gain', 'strength', 'health', 'other'];
const LEVELS = ['none', 'beginner', 'intermediate', 'advanced'];
const INJURIES = [
  'Протрузія L5–S1, без осьового навантаження',
  'Болить коліно після бігу',
  'Операція на плечі 2 роки тому',
  'Плоскостопість',
  'Гіпертонія, контроль пульсу',
  'Розтягнення ахілла минулого літа',
];
const NOTES = [
  'Любить ранкові тренування.',
  'Готується до півмарафону у квітні.',
  'Працює змінами — розклад може мінятися.',
  'Мотивація — весілля в червні.',
  'Після пологів, обережно з пресом.',
  'Хоче підтягуватися 10 разів.',
  'Приходить з другом, можна в пару.',
];

type Slot = { time: string; dur: number; group?: { cap: number; note: string } };

/** Шаблон тижня тренера (1 = понеділок). */
const TEMPLATE: Record<number, Slot[]> = {
  1: [
    { time: '07:00', dur: 60 },
    { time: '08:00', dur: 60 },
    { time: '10:00', dur: 60 },
    { time: '12:00', dur: 60, group: { cap: 6, note: 'Мобільність і спина' } },
    { time: '17:00', dur: 60 },
    { time: '18:00', dur: 60 },
    { time: '19:00', dur: 60 },
    { time: '20:00', dur: 90, group: { cap: 8, note: 'Функціональний тренінг' } },
  ],
  2: [
    { time: '07:00', dur: 60 },
    { time: '09:00', dur: 60 },
    { time: '11:00', dur: 60 },
    { time: '17:00', dur: 60 },
    { time: '18:00', dur: 60 },
    { time: '19:00', dur: 60 },
    { time: '20:00', dur: 60, group: { cap: 6, note: 'Силова група' } },
  ],
  3: [
    { time: '07:00', dur: 60 },
    { time: '08:00', dur: 60 },
    { time: '10:00', dur: 90, group: { cap: 6, note: 'Мобільність і спина' } },
    { time: '17:00', dur: 60 },
    { time: '18:00', dur: 60 },
    { time: '19:00', dur: 60 },
    { time: '20:00', dur: 90, group: { cap: 8, note: 'Функціональний тренінг' } },
  ],
  4: [
    { time: '07:00', dur: 60 },
    { time: '09:00', dur: 60 },
    { time: '11:00', dur: 60 },
    { time: '17:00', dur: 60 },
    { time: '18:00', dur: 60 },
    { time: '19:00', dur: 60 },
    { time: '20:00', dur: 60, group: { cap: 6, note: 'Силова група' } },
  ],
  5: [
    { time: '07:00', dur: 60 },
    { time: '08:00', dur: 60 },
    { time: '12:00', dur: 60, group: { cap: 6, note: 'Мобільність і спина' } },
    { time: '17:00', dur: 60 },
    { time: '18:00', dur: 60 },
    { time: '19:00', dur: 60 },
    { time: '20:00', dur: 90, group: { cap: 8, note: 'Функціональний тренінг' } },
  ],
  6: [
    { time: '09:00', dur: 60 },
    { time: '10:00', dur: 90, group: { cap: 8, note: 'Суботній кросфіт' } },
    { time: '12:00', dur: 60, group: { cap: 2, note: 'Пара' } },
    { time: '13:30', dur: 60 },
  ],
  7: [{ time: '11:00', dur: 60 }],
};

type Person = {
  id: number;
  status: 'ACTIVE' | 'GUEST' | 'INACTIVE';
  joinWeek: number; // тиждень першого заняття (0 = найдавніший)
  leaveWeek: number; // після цього тижня не ходить
  regular: { day: number; idx: number }[];
  noPass: boolean; // забуває платити — останні заняття без абонемента
  trial: boolean;
  method: 'CASH' | 'CARD' | 'TRANSFER';
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedLarge(db: Db, nowDate: Date) {
  const now = DateTime.fromJSDate(nowDate, { zone: ZONE });
  const rand = rng(Number(now.toFormat('yyyyLLdd')));
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!;
  const chance = (p: number) => rand() < p;
  const start = now.startOf('week').minus({ weeks: WEEKS_BACK });
  const totalWeeks = WEEKS_BACK + WEEKS_AHEAD;
  const nowWeek = WEEKS_BACK;
  const today = now.startOf('day');

  // ---------- Ціни ----------
  const existing = await db.select({ id: prices.id }).from(prices).limit(1);
  let priceCount = 0;
  if (existing.length === 0) {
    const list: (typeof prices.$inferInsert)[] = [
      { kind: 'SINGLE', titleUk: 'Персональне тренування', titleRu: 'Персональная тренировка', descriptionUk: '60 хвилин, індивідуальна програма', priceUah: 700 },
      { kind: 'SINGLE', titleUk: 'Пробне заняття', titleRu: 'Пробное занятие', descriptionUk: 'Знайомство, тестування, план', priceUah: 350 },
      { kind: 'SINGLE', titleUk: 'Групове заняття', titleRu: 'Групповое занятие', descriptionUk: '60–90 хвилин, до 8 людей', priceUah: 400 },
      { kind: 'PASS', titleUk: 'Абонемент 8 занять', titleRu: 'Абонемент 8 занятий', descriptionUk: 'Діє 6 тижнів', priceUah: 5000, sessionsCount: 8 },
      { kind: 'PASS', titleUk: 'Абонемент 12 занять', titleRu: 'Абонемент 12 занятий', descriptionUk: 'Діє 6 тижнів', priceUah: 6900, sessionsCount: 12 },
      { kind: 'PASS', titleUk: 'Груповий 8', titleRu: 'Групповой 8', descriptionUk: '8 групових занять, 6 тижнів', priceUah: 2800, sessionsCount: 8, isVisible: false },
    ];
    await db.insert(prices).values(list.map((p, i) => ({ ...p, sortOrder: i, isDemo: true })));
    priceCount = list.length;
  }

  // ---------- Клієнти ----------
  const usedNames = new Set<string>();
  const people: Person[] = [];
  const total = 42;
  const indivSeats: { day: number; idx: number }[] = [];
  const groupSeats: { day: number; idx: number }[] = [];
  for (const [d, list] of Object.entries(TEMPLATE)) {
    list.forEach((s, idx) => (s.group ? groupSeats : indivSeats).push({ day: Number(d), idx }));
  }
  const takenIndiv = new Set<string>();

  const rows: (typeof clients.$inferInsert)[] = [];
  const meta: Omit<Person, 'id'>[] = [];
  for (let i = 0; i < total; i++) {
    const female = chance(0.55);
    let name = '';
    do {
      const last = pick(LAST);
      name = `${pick(female ? FIRST_F : FIRST_M)} ${female ? (LAST_F[last] ?? feminine(last)) : last}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const status: Person['status'] = i < 4 ? 'GUEST' : i < 10 ? 'INACTIVE' : 'ACTIVE';
    // Більшість клієнтів — давні, частина прийшла нещодавно.
    const joinWeek = status === 'GUEST' ? nowWeek : Math.floor(rand() * rand() * (WEEKS_BACK - 1));
    const leaveWeek = status === 'INACTIVE' ? Math.min(nowWeek - 2, joinWeek + 2 + Math.floor(rand() * 5)) : totalWeeks;

    // Постійні слоти: 1–3 на тиждень, індивідуальні — без конфліктів.
    const regular: { day: number; idx: number }[] = [];
    if (status !== 'GUEST') {
      const want = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < want; k++) {
        if (chance(0.45)) {
          regular.push(pick(groupSeats));
        } else {
          const free = indivSeats.filter((s) => !takenIndiv.has(`${s.day}:${s.idx}`) && !regular.some((r) => r.day === s.day));
          if (free.length) {
            const s = pick(free);
            takenIndiv.add(`${s.day}:${s.idx}`);
            regular.push(s);
          } else regular.push(pick(groupSeats));
        }
      }
    }

    const goal = pick(GOALS);
    rows.push({
      name,
      phone: `+380 ${pick(['50', '63', '66', '67', '68', '73', '93', '95', '97', '98'])} ${String(100 + Math.floor(rand() * 900))} ${String(10 + Math.floor(rand() * 90))} ${String(10 + Math.floor(rand() * 90))}`,
      status,
      goal,
      experience: pick(LEVELS),
      injuries: chance(0.25) ? pick(INJURIES) : null,
      health: chance(0.1) ? 'Невисокий тиск' : null,
      trainerNotes: chance(0.35) ? pick(NOTES) : null,
      consentAt: start.plus({ weeks: joinWeek }).minus({ days: 2 }).toJSDate(),
      createdAt: (status === 'GUEST' ? now.minus({ days: 1 + Math.floor(rand() * 5) }) : start.plus({ weeks: joinWeek }).minus({ days: 3 })).toJSDate(),
      isDemo: true,
    });
    meta.push({
      status,
      joinWeek,
      leaveWeek,
      regular,
      noPass: status === 'ACTIVE' && chance(0.08),
      trial: status !== 'INACTIVE' && chance(0.5),
      method: pick(['CASH', 'CARD', 'TRANSFER'] as const),
    });
  }
  const inserted = await db.insert(clients).values(rows).returning({ id: clients.id });
  inserted.forEach((r, i) => people.push({ id: r.id, ...meta[i]! }));

  // Рефери: кожен п'ятий активний прийшов за запрошенням.
  const active = people.filter((p) => p.status === 'ACTIVE');
  for (let i = 0; i < active.length; i += 5) {
    const inviter = active[(i + 3) % active.length]!;
    if (inviter.id !== active[i]!.id) {
      await db.update(clients).set({ referredByClientId: inviter.id }).where(eq(clients.id, active[i]!.id));
    }
  }

  // ---------- Слоти ----------
  type SlotRow = { key: string; at: DateTime; day: number; idx: number; week: number; plan: Slot };
  const slotRows: SlotRow[] = [];
  for (let w = 0; w < totalWeeks; w++) {
    for (let day = 1; day <= 7; day++) {
      const date = start.plus({ weeks: w, days: day - 1 });
      // Неділя — не щотижня.
      if (day === 7 && w % 2 === 1) continue;
      (TEMPLATE[day] ?? []).forEach((plan, idx) => {
        const [h, m] = plan.time.split(':').map(Number);
        slotRows.push({ key: `${w}:${day}:${idx}`, at: date.set({ hour: h!, minute: m!, second: 0, millisecond: 0 }), day, idx, week: w, plan });
      });
    }
  }
  const slotIds = new Map<string, number>();
  for (let i = 0; i < slotRows.length; i += 200) {
    const chunk = slotRows.slice(i, i + 200);
    const res = await db
      .insert(slots)
      .values(
        chunk.map((s) => ({
          startsAt: s.at.toJSDate(),
          durationMin: s.plan.dur,
          type: s.plan.group ? ('GROUP' as const) : ('INDIVIDUAL' as const),
          capacity: s.plan.group?.cap ?? 1,
          note: s.plan.group?.note ?? null,
          // Зрідка тренер скасовує слот (хвороба, свято).
          status: s.at < today && chance(0.015) ? ('CANCELLED' as const) : ('OPEN' as const),
          isDemo: true,
        })),
      )
      .returning({ id: slots.id, status: slots.status });
    chunk.forEach((s, k) => res[k]!.status === 'OPEN' && slotIds.set(s.key, res[k]!.id));
  }

  // ---------- Записи ----------
  type B = { person: Person; slot: SlotRow; slotId: number; status: 'BOOKED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED'; trial: boolean };
  const plan: B[] = [];
  const occupancy = new Map<string, number>();
  const add = (person: Person, slot: SlotRow, trial = false) => {
    const id = slotIds.get(slot.key);
    if (!id) return false;
    const cap = slot.plan.group?.cap ?? 1;
    if ((occupancy.get(slot.key) ?? 0) >= cap) return false;
    if (plan.some((b) => b.slotId === id && b.person.id === person.id)) return false;
    occupancy.set(slot.key, (occupancy.get(slot.key) ?? 0) + 1);
    const past = slot.at < today;
    let status: B['status'] = 'BOOKED';
    if (past) status = trial ? 'ATTENDED' : chance(0.06) ? 'NO_SHOW' : chance(0.03) ? 'CANCELLED' : 'ATTENDED';
    else if (chance(0.02)) status = 'CANCELLED';
    plan.push({ person, slot, slotId: id, status, trial });
    return true;
  };
  const byKey = new Map(slotRows.map((s) => [s.key, s]));

  for (const p of people) {
    if (p.status === 'GUEST') continue;
    // Пробне — у перший тиждень, на вільний індивідуальний слот.
    let firstWeek = p.joinWeek;
    if (p.trial) {
      const options = slotRows.filter((s) => s.week === p.joinWeek && !s.plan.group);
      for (const s of options.sort(() => rand() - 0.5)) if (add(p, s, true)) break;
      firstWeek = p.joinWeek + 1;
    }
    for (let w = firstWeek; w <= Math.min(p.leaveWeek, totalWeeks - 1); w++) {
      // Відпустка: зрідка пропускає тиждень повністю.
      if (w < nowWeek && chance(0.06)) continue;
      for (const r of p.regular) {
        const s = byKey.get(`${w}:${r.day}:${r.idx}`);
        if (s) add(p, s);
      }
    }
  }
  // Разові записи на вільні індивідуальні слоти.
  const actives = people.filter((p) => p.status === 'ACTIVE');
  for (const s of slotRows) {
    if (s.plan.group || (occupancy.get(s.key) ?? 0) > 0) continue;
    const fill = s.week < nowWeek ? 0.45 : s.week === nowWeek ? 0.4 : 0.2;
    if (chance(fill)) {
      const p = pick(actives);
      if (s.week >= p.joinWeek) add(p, s);
    }
  }
  // Нові заявки: двоє вже записані на пробне.
  for (const g of people.filter((p) => p.status === 'GUEST').slice(0, 2)) {
    const s = slotRows.filter((x) => x.at > now && x.week <= nowWeek + 1 && !x.plan.group && !(occupancy.get(x.key) ?? 0));
    if (s.length) add(g, pick(s), true);
  }

  // ---------- Абонементи й оплати ----------
  plan.sort((a, b) => a.slot.at.toMillis() - b.slot.at.toMillis());
  const passFor = new Map<B, number>();
  let paymentCount = 0;
  let passCount = 0;
  for (const p of people) {
    const mine = plan.filter((b) => b.person.id === p.id);
    const trialB = mine.find((b) => b.trial);
    if (trialB && trialB.status === 'ATTENDED') {
      await db.insert(payments).values({ clientId: p.id, amountUah: 350, paidAt: trialB.slot.at.toISODate()!, method: p.method, purpose: 'TRIAL' });
      paymentCount++;
    }
    const chargeable = mine.filter((b) => !b.trial && (b.status === 'ATTENDED' || (b.status === 'NO_SHOW' && chance(0.5))));
    const perWeek = Math.max(1, p.regular.length);
    const size = perWeek >= 3 ? 12 : 8;
    let cur: { id: number; left: number; expires: DateTime; total: number; used: number } | null = null;
    const finish = async () => {
      if (cur) {
          await db.update(passes).set({ remaining: cur.left }).where(eq(passes.id, cur.id));
      }
    };
    for (const b of chargeable) {
      if (b.slot.at >= today) break;
      if (!cur || cur.left === 0 || b.slot.at > cur.expires) {
        // Хтось забуває оплатити — останні 1–2 тижні без абонемента.
        if (p.noPass && b.slot.week >= nowWeek - 2) continue;
        await finish();
        const bought = b.slot.at.minus({ days: Math.floor(rand() * 3) }).startOf('day');
        const amount = size === 12 ? 6900 : 5000;
        const [pay] = await db
          .insert(payments)
          .values({ clientId: p.id, amountUah: amount, paidAt: bought.toISODate()!, method: p.method, purpose: 'PASS', note: `Абонемент ${size}` })
          .returning({ id: payments.id });
        const expires = bought.plus({ weeks: 6 });
        const [pass] = await db
          .insert(passes)
          .values({ clientId: p.id, totalSessions: size, remaining: size, purchasedAt: bought.toISODate()!, expiresAt: expires.toISODate()!, paymentId: pay!.id })
          .returning({ id: passes.id });
        paymentCount++;
        passCount++;
        cur = { id: pass!.id, left: size, expires: expires.endOf('day'), total: size, used: 0 };
      }
      cur.left--;
      passFor.set(b, cur.id);
    }
    await finish();
    // Хтось оплачує разові заняття.
    if (p.status === 'ACTIVE' && chance(0.15)) {
      const last = mine.filter((b) => b.status === 'ATTENDED' && b.slot.at < today).slice(-1)[0];
      if (last) {
        await db.insert(payments).values({ clientId: p.id, amountUah: last.slot.plan.group ? 400 : 700, paidAt: last.slot.at.toISODate()!, method: 'CASH', purpose: 'SINGLE', note: 'Разове' });
        paymentCount++;
      }
    }
  }

  // Сьогоднішні минулі заняття лишаємо невідміченими — щоб було що відмітити.
  const rowsB = plan.map((b) => {
    const passId = passFor.get(b) ?? null;
    const unmarkedToday = b.slot.at >= today && b.slot.at < now;
    const status = unmarkedToday && b.status !== 'CANCELLED' ? 'BOOKED' : b.status;
    return {
      slotId: b.slotId,
      clientId: b.person.id,
      status,
      isTrial: b.trial,
      deducted: passId !== null && status !== 'BOOKED',
      passId: status !== 'BOOKED' ? passId : null,
      markedAt: status === 'BOOKED' || status === 'CANCELLED' ? null : b.slot.at.plus({ minutes: b.slot.plan.dur + 5 }).toJSDate(),
      createdAt: b.slot.at.minus({ days: 1 + Math.floor(rand() * 6) }).toJSDate(),
    };
  });
  for (let i = 0; i < rowsB.length; i += 300) await db.insert(bookings).values(rowsB.slice(i, i + 300));

  // Минулі слоти без жодного запису тренер зазвичай не тримає в календарі — лишаємо небагато.
  const emptyPast = slotRows.filter((x) => x.at < today && slotIds.has(x.key) && !(occupancy.get(x.key) ?? 0) && !chance(0.12));
  for (let i = 0; i < emptyPast.length; i += 300) {
    await db.delete(slots).where(inArray(slots.id, emptyPast.slice(i, i + 300).map((x) => slotIds.get(x.key)!)));
  }
  for (const x of emptyPast) slotIds.delete(x.key);

  // ---------- Лист очікування на повні майбутні слоти ----------
  let waitCount = 0;
  const full = slotRows.filter((s) => s.at > now && (occupancy.get(s.key) ?? 0) >= (s.plan.group?.cap ?? 1)).slice(0, 10);
  for (const s of full) {
    const inside = new Set(plan.filter((b) => b.slot.key === s.key).map((b) => b.person.id));
    const candidates = actives.filter((p) => !inside.has(p.id));
    const n = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < n && candidates.length; k++) {
      const c = candidates.splice(Math.floor(rand() * candidates.length), 1)[0]!;
      await db.insert(waitlist).values({ slotId: slotIds.get(s.key)!, clientId: c.id, createdAt: now.minus({ hours: 1 + Math.floor(rand() * 40) }).toJSDate() });
      waitCount++;
    }
  }

  return {
    clients: people.length,
    slots: slotIds.size,
    bookings: rowsB.length,
    payments: paymentCount,
    passes: passCount,
    waitlist: waitCount,
    prices: priceCount,
  };
}

/** Прізвище в жіночому роді для тих, що змінюються. */
function feminine(last: string) {
  if (last.endsWith('ський')) return last.replace(/ський$/, 'ська');
  return last;
}
