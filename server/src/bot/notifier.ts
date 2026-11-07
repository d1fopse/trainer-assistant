import { and, asc, eq, gt, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { bookings, clients, notificationsLog, passes, settings, slots, users, waitlist } from '../db/schema.js';
import { renderMarkPrompt } from './marks.js';
import { kyivDate, kyivDayStart, kyivTime, addDays } from '../time.js';
import { TelegramError, escapeHtml, keyboard, type InlineButton, type TelegramApi } from './telegram.js';
import { formatDay, formatWhen, tx } from './texts.js';

export const REMINDER_HOURS = 3;

export type BotSettings = {
  dailySummaryTime: string;
  remindersEnabled: boolean;
  /** Після заняття питати тренера в боті, хто прийшов. */
  markPromptsEnabled: boolean;
  /** Писати клієнту, коли абонемент закінчується. */
  renewalRemindersEnabled: boolean;
};
export const DEFAULT_SETTINGS: BotSettings = {
  dailySummaryTime: '08:00',
  remindersEnabled: true,
  markPromptsEnabled: true,
  renewalRemindersEnabled: true,
};

/** Як давно мало закінчитися заняття, щоб ще питати про відмітку. */
export const MARK_PROMPT_LOOKBACK_HOURS = 6;
/** Абонемент «закінчується»: лишилось ≤ стільки занять… */
export const RENEWAL_LOW_SESSIONS = 1;
/** …або до кінця строку ≤ стільки днів. */
export const RENEWAL_DAYS_BEFORE = 3;
/** Клієнтам пишемо лише вдень. */
const DAYTIME = ['10:00', '20:00'] as const;

export async function loadSettings(db: Db): Promise<BotSettings> {
  const rows = await db.select().from(settings);
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    dailySummaryTime: m.get('dailySummaryTime') ?? DEFAULT_SETTINGS.dailySummaryTime,
    remindersEnabled: (m.get('remindersEnabled') ?? 'true') === 'true',
    markPromptsEnabled: (m.get('markPromptsEnabled') ?? 'true') === 'true',
    renewalRemindersEnabled: (m.get('renewalRemindersEnabled') ?? 'true') === 'true',
  };
}

type Recipient = { userId: number; telegramId: bigint; language: string };

export class Notifier {
  private running = false;

  constructor(
    private db: Db,
    private tg: TelegramApi,
    private config: Config,
    private now: () => Date = () => new Date(),
    private log: { error: (o: unknown, msg?: string) => void } = console,
  ) {}

  /** Займає ключ у журналі; false — уже надсилали. */
  private async claim(key: string, type: string) {
    const r = await this.db.insert(notificationsLog).values({ key, type }).onConflictDoNothing().returning({ id: notificationsLog.id });
    return r.length > 0;
  }

  /** Надсилає повідомлення; позначає користувача, якщо він заблокував бота. */
  async send(to: Recipient, text: string, buttons?: InlineButton[][]) {
    try {
      await this.tg.call('sendMessage', {
        chat_id: String(to.telegramId),
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(buttons ? { reply_markup: keyboard(buttons) } : {}),
      });
      return true;
    } catch (e) {
      await this.handleSendError(to.userId, e);
      return false;
    }
  }

  async handleSendError(userId: number, e: unknown) {
    if (e instanceof TelegramError && e.isBlocked) {
      await this.db.update(users).set({ botBlockedAt: this.now() }).where(eq(users.id, userId));
    } else {
      this.log.error(e, 'telegram send failed');
    }
  }

  async trainerUsername() {
    const ids = [...this.config.trainerIds].filter((s) => /^\d+$/.test(s)).map(BigInt);
    if (!ids.length) return null;
    const [r] = await this.db
      .select({ username: users.username })
      .from(users)
      .where(and(inArray(users.telegramId, ids), isNotNull(users.username)))
      .limit(1);
    return r?.username ?? null;
  }

  /** Кнопки «Написати тренеру» та «Відкрити додаток» (якщо адреса додатку https). */
  async clientButtons(lang: string): Promise<InlineButton[][]> {
    const t = tx(lang);
    const row: InlineButton[] = [];
    const username = await this.trainerUsername();
    if (username) row.push({ text: t.writeTrainer, url: `https://t.me/${username}` });
    const rows = row.length ? [row] : [];
    if (this.config.webOrigin.startsWith('https://')) rows.push([{ text: t.openApp, web_app: { url: this.config.webOrigin } }]);
    return rows;
  }

  /** Нагадування за 3 години до заняття клієнтам із Telegram. */
  async sendReminders() {
    const now = this.now();
    const until = new Date(now.getTime() + REMINDER_HOURS * 3_600_000);
    const due = await this.db
      .select({
        bookingId: bookings.id,
        startsAt: slots.startsAt,
        type: slots.type,
        isTrial: bookings.isTrial,
        userId: users.id,
        telegramId: users.telegramId,
        language: users.language,
      })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(clients, eq(clients.id, bookings.clientId))
      .innerJoin(users, eq(users.id, clients.userId))
      .where(
        and(
          eq(bookings.status, 'BOOKED'),
          eq(slots.status, 'OPEN'),
          gt(slots.startsAt, now),
          lte(slots.startsAt, until),
          sql`${users.botBlockedAt} is null`,
        ),
      );
    let sent = 0;
    for (const r of due) {
      if (!(await this.claim(`reminder:${r.bookingId}`, 'reminder'))) continue;
      const t = tx(r.language);
      const kind = r.isTrial ? t.trial : r.type === 'GROUP' ? t.group : t.individual;
      if (await this.send(r, t.reminder(formatWhen(r.startsAt, r.language, now), kind), await this.clientButtons(r.language))) sent++;
    }
    return sent;
  }

  /** Текст плану дня для тренера. */
  async summaryText(date: string, lang: string) {
    const t = tx(lang);
    const rows = await this.db
      .select({
        id: slots.id,
        startsAt: slots.startsAt,
        durationMin: slots.durationMin,
        type: slots.type,
        capacity: slots.capacity,
        note: slots.note,
      })
      .from(slots)
      .where(and(eq(slots.status, 'OPEN'), sql`${slots.startsAt} >= ${kyivDayStart(date).toISOString()}::timestamptz`, sql`${slots.startsAt} < ${kyivDayStart(addDays(date, 1)).toISOString()}::timestamptz`))
      .orderBy(asc(slots.startsAt));
    const day = formatDay(kyivDayStart(date), lang);
    if (rows.length === 0) return t.summaryEmpty(day);
    const people = await this.db
      .select({ slotId: bookings.slotId, name: clients.name, isTrial: bookings.isTrial })
      .from(bookings)
      .innerJoin(clients, eq(clients.id, bookings.clientId))
      .where(and(inArray(bookings.slotId, rows.map((r) => r.id)), ne(bookings.status, 'CANCELLED')))
      .orderBy(asc(bookings.id));
    const lines = rows.map((s) => {
      const end = new Date(s.startsAt.getTime() + s.durationMin * 60_000);
      const who = people.filter((p) => p.slotId === s.id);
      const names = who.map((p) => escapeHtml(p.name) + (p.isTrial ? ` (${t.trial})` : '')).join(', ');
      const range = `<b>${kyivTime(s.startsAt)}–${kyivTime(end)}</b>`;
      const body = s.type === 'GROUP' ? `${t.group} ${who.length}/${s.capacity}${names ? `: ${names}` : ''}` : names || `<i>${t.free}</i>`;
      return `${range} ${body}`;
    });
    return [t.summaryHead(day, rows.length), '', ...lines].join('\n');
  }

  /** Ранковий план дня тренеру — раз на добу після налаштованого часу. */
  async sendDailySummary(cfg: BotSettings) {
    const now = this.now();
    if (kyivTime(now) < cfg.dailySummaryTime) return 0;
    const date = kyivDate(now);
    let sent = 0;
    for (const id of this.config.trainerIds) {
      if (!/^\d+$/.test(id)) continue;
      const [u] = await this.db.select().from(users).where(eq(users.telegramId, BigInt(id)));
      if (!u || u.botBlockedAt) continue;
      if (!(await this.claim(`summary:${date}:${id}`, 'summary'))) continue;
      if (await this.send({ userId: u.id, telegramId: u.telegramId, language: u.language }, await this.summaryText(date, u.language))) sent++;
    }
    return sent;
  }

  /** Тренери, яким бот може писати (запускали бота, не заблокували). */
  private async trainerRecipients(): Promise<Recipient[]> {
    const ids = [...this.config.trainerIds].filter((s) => /^\d+$/.test(s)).map(BigInt);
    if (!ids.length) return [];
    const rows = await this.db.select().from(users).where(inArray(users.telegramId, ids));
    return rows.filter((u) => !u.botBlockedAt).map((u) => ({ userId: u.id, telegramId: u.telegramId, language: u.language }));
  }

  /** Після заняття — тренеру повідомлення з кнопками «прийшов / неявка» для невідмічених. */
  async sendMarkPrompts() {
    const now = this.now();
    const since = new Date(now.getTime() - MARK_PROMPT_LOOKBACK_HOURS * 3_600_000);
    const ended = await this.db
      .selectDistinct({ id: slots.id })
      .from(slots)
      .innerJoin(bookings, eq(bookings.slotId, slots.id))
      .where(
        and(
          eq(slots.status, 'OPEN'),
          eq(bookings.status, 'BOOKED'),
          sql`${slots.startsAt} + make_interval(mins => ${slots.durationMin}) <= ${now.toISOString()}::timestamptz`,
          sql`${slots.startsAt} + make_interval(mins => ${slots.durationMin}) > ${since.toISOString()}::timestamptz`,
        ),
      );
    if (!ended.length) return 0;
    const trainers = await this.trainerRecipients();
    let sent = 0;
    for (const s of ended) {
      if (!(await this.claim(`markprompt:${s.id}`, 'markprompt'))) continue;
      for (const tr of trainers) {
        const msg = await renderMarkPrompt(this.db, s.id, tr.language);
        if (msg && msg.open && (await this.send(tr, msg.text, msg.buttons))) sent++;
      }
    }
    return sent;
  }

  /**
   * Нагадування клієнту продовжити абонемент: лишилось ≤ 1 заняття
   * або до кінця строку ≤ 3 днів (і ще є заняття). Кожне — один раз на абонемент, лише вдень.
   */
  async sendRenewalReminders() {
    const now = this.now();
    const time = kyivTime(now);
    if (time < DAYTIME[0] || time >= DAYTIME[1]) return 0;
    const today = kyivDate(now);
    const soon = addDays(today, RENEWAL_DAYS_BEFORE);
    const recentFrom = addDays(today, -120);
    const rows = await this.db
      .select({
        clientId: clients.id,
        passId: passes.id,
        remaining: passes.remaining,
        purchasedAt: passes.purchasedAt,
        expiresAt: passes.expiresAt,
        userId: users.id,
        telegramId: users.telegramId,
        language: users.language,
      })
      .from(passes)
      .innerJoin(clients, eq(clients.id, passes.clientId))
      .innerJoin(users, eq(users.id, clients.userId))
      .where(and(eq(clients.status, 'ACTIVE'), sql`${users.botBlockedAt} is null`, sql`${passes.purchasedAt} >= ${recentFrom}`))
      .orderBy(asc(passes.clientId), asc(passes.purchasedAt), asc(passes.id));

    // По кожному клієнту: найновіший абонемент і загальний залишок на діючих.
    const byClient = new Map<number, typeof rows>();
    for (const r of rows) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);
    let sent = 0;
    for (const list of byClient.values()) {
      const latest = list[list.length - 1]!;
      const active = list.filter((p) => p.remaining > 0 && (!p.expiresAt || p.expiresAt >= today));
      const left = active.reduce((n, p) => n + p.remaining, 0);
      const t = tx(latest.language);
      const latestActive = latest.remaining > 0 && (!latest.expiresAt || latest.expiresAt >= today);

      // Порожній абонемент — лише якщо з нього списували нещодавно (не будимо тих, хто давно не ходить).
      const recentlyUsed =
        latest.remaining === 0 &&
        (
          await this.db
            .select({ id: bookings.id })
            .from(bookings)
            .innerJoin(slots, eq(slots.id, bookings.slotId))
            .where(and(eq(bookings.passId, latest.passId), gt(slots.startsAt, new Date(now.getTime() - 14 * 86_400_000))))
            .limit(1)
        ).length > 0;
      if (left <= RENEWAL_LOW_SESSIONS && (latestActive || recentlyUsed)) {
        if (await this.claim(`renew:low:${latest.passId}`, 'renewal')) {
          if (await this.send(latest, left === 0 ? t.renewEmpty : t.renewLow(left), await this.clientButtons(latest.language))) sent++;
        }
        continue;
      }
      // Строк закінчується, а заняття ще є (і немає іншого абонемента, що діє довше).
      const expiring = active.find((p) => p.expiresAt && p.expiresAt <= soon);
      const outlives = active.some((p) => !p.expiresAt || p.expiresAt > soon);
      if (expiring && !outlives && (await this.claim(`renew:exp:${expiring.passId}`, 'renewal'))) {
        const until = formatDay(kyivDayStart(expiring.expiresAt!), latest.language).toLowerCase();
        if (await this.send(latest, t.renewExpiring(until, left), await this.clientButtons(latest.language))) sent++;
      }
    }
    return sent;
  }

  /** Виклик щохвилини з планувальника. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const cfg = await loadSettings(this.db);
      if (cfg.remindersEnabled) await this.sendReminders();
      await this.sendDailySummary(cfg);
      if (cfg.markPromptsEnabled) await this.sendMarkPrompts();
      if (cfg.renewalRemindersEnabled) await this.sendRenewalReminders();
    } catch (e) {
      this.log.error(e, 'notifier tick failed');
    } finally {
      this.running = false;
    }
  }

  /** Звільнилось місце — повідомляємо першого в листі очікування. */
  async onSeatsFreed(slotId: number) {
    try {
      const [slot] = await this.db.select().from(slots).where(eq(slots.id, slotId));
      if (!slot || slot.status !== 'OPEN' || slot.startsAt <= this.now()) return;
      const [{ n } = { n: 0 }] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(bookings)
        .where(and(eq(bookings.slotId, slotId), ne(bookings.status, 'CANCELLED')));
      if (n >= slot.capacity) return;
      const [first] = await this.db
        .select({ id: waitlist.id })
        .from(waitlist)
        .where(and(eq(waitlist.slotId, slotId), eq(waitlist.status, 'WAITING')))
        .orderBy(asc(waitlist.createdAt), asc(waitlist.id))
        .limit(1);
      if (first) await this.notifyEntry(first.id);
    } catch (e) {
      this.log.error(e, 'waitlist notify failed');
    }
  }

  /** Повідомити конкретного клієнта з черги (автоматично або на прохання тренера). */
  async notifyEntry(entryId: number) {
    const [row] = await this.db
      .select({
        id: waitlist.id,
        startsAt: slots.startsAt,
        userId: users.id,
        telegramId: users.telegramId,
        language: users.language,
      })
      .from(waitlist)
      .innerJoin(slots, eq(slots.id, waitlist.slotId))
      .innerJoin(clients, eq(clients.id, waitlist.clientId))
      .innerJoin(users, eq(users.id, clients.userId))
      .where(eq(waitlist.id, entryId));
    if (!row) return false;
    const t = tx(row.language);
    const ok = await this.send(row, t.waitlist(formatWhen(row.startsAt, row.language, this.now())), await this.clientButtons(row.language));
    await this.db.update(waitlist).set({ status: 'NOTIFIED', notifiedAt: this.now() }).where(eq(waitlist.id, entryId));
    return ok;
  }

  /** Клієнта записали на слот — прибираємо його з черги. */
  async onBooked(slotId: number, clientId: number) {
    await this.db
      .update(waitlist)
      .set({ status: 'REMOVED' })
      .where(and(eq(waitlist.slotId, slotId), eq(waitlist.clientId, clientId), ne(waitlist.status, 'REMOVED')));
  }
}
