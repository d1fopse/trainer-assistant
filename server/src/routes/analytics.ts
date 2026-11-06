import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { requireTrainer } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { ZONE, addDays, daysBetween, isValidDate, kyivDayStart } from '../time.js';

const query = z.object({
  from: z.string().refine(isValidDate).optional(),
  to: z.string().refine(isValidDate).optional(),
});

type Row = Record<string, unknown>;
const rows = async <T extends Row>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];
const num = (v: unknown) => (v == null ? 0 : Number(v));
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function registerAnalyticsRoutes(app: FastifyInstance, db: Db, now: () => Date = () => new Date()) {
  /**
   * Аналітика за період (місцеві дати включно; за замовчуванням — поточний місяць):
   * дохід, завантаження розкладу, відвідуваність, конверсія пробних, абонементи, що закінчуються.
   */
  app.get('/api/analytics', { preHandler: requireTrainer }, async (req) => {
    const q = parse(query, req.query, 'invalid_query');
    const today = DateTime.fromJSDate(now(), { zone: ZONE });
    const from = q.from ?? today.startOf('month').toISODate()!;
    const to = q.to ?? today.endOf('month').toISODate()!;
    if (daysBetween(from, to) < 0 || daysBetween(from, to) > 400) throw new HttpError(400, 'invalid_range');
    const fromTs = kyivDayStart(from).toISOString();
    const toTs = kyivDayStart(addDays(to, 1)).toISOString();
    const nowTs = now().toISOString();
    const todayDate = today.toISODate()!;

    // --- Дохід ---
    const [incomeTotal] = await rows<{ total: unknown; count: unknown }>(
      db,
      sql`select coalesce(sum(amount_uah), 0) as total, count(*) as count from payments where paid_at between ${from}::date and ${to}::date`,
    );
    const byPurpose = await rows<{ purpose: string; total: unknown }>(
      db,
      sql`select purpose, sum(amount_uah) as total from payments where paid_at between ${from}::date and ${to}::date group by purpose order by total desc`,
    );
    const byMethod = await rows<{ method: string; total: unknown }>(
      db,
      sql`select method, sum(amount_uah) as total from payments where paid_at between ${from}::date and ${to}::date group by method order by total desc`,
    );
    // Останні 12 місяців до кінця періоду — для графіка.
    const monthsEnd = DateTime.fromISO(to).startOf('month');
    const monthsStart = monthsEnd.minus({ months: 11 });
    const monthly = await rows<{ month: string; total: unknown }>(
      db,
      sql`select to_char(date_trunc('month', paid_at), 'YYYY-MM') as month, sum(amount_uah) as total
          from payments where paid_at >= ${monthsStart.toISODate()}::date and paid_at < ${monthsEnd.plus({ months: 1 }).toISODate()}::date
          group by 1`,
    );
    const monthMap = new Map(monthly.map((m) => [m.month, num(m.total)]));
    const byMonth = Array.from({ length: 12 }, (_, i) => {
      const m = monthsStart.plus({ months: i }).toFormat('yyyy-MM');
      return { month: m, total: monthMap.get(m) ?? 0 };
    });

    // --- Завантаження розкладу (місця в слотах періоду) ---
    const load = await rows<{ weekday: unknown; slots: unknown; seats: unknown; booked: unknown; empty: unknown }>(
      db,
      sql`select extract(isodow from s.starts_at at time zone 'Europe/Kyiv')::int as weekday,
                 count(*) as slots, sum(s.capacity) as seats,
                 sum((select count(*) from bookings b where b.slot_id = s.id and b.status <> 'CANCELLED')) as booked,
                 count(*) filter (where not exists (select 1 from bookings b where b.slot_id = s.id and b.status <> 'CANCELLED')) as empty
          from slots s
          where s.status = 'OPEN' and s.starts_at >= ${fromTs}::timestamptz and s.starts_at < ${toTs}::timestamptz
          group by 1 order by 1`,
    );
    const byWeekday = [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const r = load.find((x) => num(x.weekday) === d);
      return { weekday: d, slots: num(r?.slots), seats: num(r?.seats), booked: num(r?.booked) };
    });
    const seats = byWeekday.reduce((n, d) => n + d.seats, 0);
    const booked = byWeekday.reduce((n, d) => n + d.booked, 0);
    const slotCount = byWeekday.reduce((n, d) => n + d.slots, 0);
    const emptySlots = load.reduce((n, d) => n + num(d.empty), 0);

    // --- Відвідуваність (лише заняття, що вже минули) ---
    const att = await rows<{ client_id: unknown; name: string; attended: unknown; no_show: unknown; cancelled: unknown }>(
      db,
      sql`select c.id as client_id, c.name,
                 count(*) filter (where b.status = 'ATTENDED') as attended,
                 count(*) filter (where b.status = 'NO_SHOW') as no_show,
                 count(*) filter (where b.status = 'CANCELLED') as cancelled
          from bookings b join slots s on s.id = b.slot_id join clients c on c.id = b.client_id
          where s.starts_at >= ${fromTs}::timestamptz and s.starts_at < ${toTs}::timestamptz and s.starts_at < ${nowTs}::timestamptz
          group by c.id, c.name`,
    );
    const perClient = att
      .map((r) => {
        const a = num(r.attended);
        const n = num(r.no_show);
        return { clientId: num(r.client_id), name: r.name, attended: a, noShows: n, cancelled: num(r.cancelled), rate: pct(a, a + n) };
      })
      .filter((r) => r.attended + r.noShows + r.cancelled > 0)
      .sort((x, y) => y.attended - x.attended || y.noShows - x.noShows || x.name.localeCompare(y.name));
    const attended = perClient.reduce((n, c) => n + c.attended, 0);
    const noShows = perClient.reduce((n, c) => n + c.noShows, 0);
    const cancelled = perClient.reduce((n, c) => n + c.cancelled, 0);
    const [unmarked] = await rows<{ n: unknown }>(
      db,
      sql`select count(*) as n from bookings b join slots s on s.id = b.slot_id
          where b.status = 'BOOKED' and s.status = 'OPEN'
            and s.starts_at >= ${fromTs}::timestamptz and s.starts_at < ${toTs}::timestamptz and s.starts_at < ${nowTs}::timestamptz`,
    );

    // --- Пробні заняття та конверсія в абонемент ---
    const trials = await rows<{ client_id: unknown; name: string; trial_at: Date | string; status: string; converted: unknown }>(
      db,
      sql`select c.id as client_id, c.name, s.starts_at as trial_at, b.status,
                 exists (select 1 from payments p where p.client_id = c.id and p.purpose = 'PASS'
                         and p.paid_at >= (s.starts_at at time zone 'Europe/Kyiv')::date) as converted
          from bookings b join slots s on s.id = b.slot_id join clients c on c.id = b.client_id
          where b.is_trial and b.status <> 'CANCELLED'
            and s.starts_at >= ${fromTs}::timestamptz and s.starts_at < ${toTs}::timestamptz
          order by s.starts_at`,
    );
    const trialDone = trials.filter((r) => r.status === 'ATTENDED');
    const converted = trialDone.filter((r) => r.converted === true || r.converted === 't').length;

    // --- Абонементи, що закінчуються (на сьогодні, незалежно від періоду) ---
    const ending = await rows<{ client_id: unknown; name: string; remaining: unknown; expires_at: string | null }>(
      db,
      sql`select c.id as client_id, c.name, sum(p.remaining) as remaining, min(p.expires_at)::text as expires_at
          from passes p join clients c on c.id = p.client_id
          where c.status <> 'INACTIVE' and p.remaining > 0 and (p.expires_at is null or p.expires_at >= ${todayDate}::date)
          group by c.id, c.name
          having sum(p.remaining) <= 1 or min(p.expires_at) <= ${addDays(todayDate, 7)}::date
          order by sum(p.remaining), c.name`,
    );

    const [newClients] = await rows<{ n: unknown }>(
      db,
      sql`select count(*) as n from clients where created_at >= ${fromTs}::timestamptz and created_at < ${toTs}::timestamptz`,
    );
    const [unpaid] = await rows<{ n: unknown }>(
      db,
      sql`select count(*) as n from bookings where status = 'ATTENDED' and not is_trial and not deducted`,
    );

    return {
      period: { from, to },
      income: {
        total: num(incomeTotal?.total),
        payments: num(incomeTotal?.count),
        byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, total: num(r.total) })),
        byMethod: byMethod.map((r) => ({ method: r.method, total: num(r.total) })),
        byMonth,
      },
      load: { slots: slotCount, emptySlots, seats, booked, rate: pct(booked, seats), byWeekday },
      attendance: { attended, noShows, cancelled, unmarked: num(unmarked?.n), rate: pct(attended, attended + noShows), perClient },
      trials: {
        total: trials.length,
        attended: trialDone.length,
        converted,
        rate: pct(converted, trialDone.length),
        list: trials.map((r) => ({
          clientId: num(r.client_id),
          name: r.name,
          at: new Date(r.trial_at).toISOString(),
          status: r.status,
          converted: r.converted === true || r.converted === 't',
        })),
      },
      endingPasses: ending.map((r) => ({ clientId: num(r.client_id), name: r.name, remaining: num(r.remaining), expiresAt: r.expires_at })),
      newClients: num(newClients?.n),
      unpaidVisits: num(unpaid?.n),
    };
  });
}
