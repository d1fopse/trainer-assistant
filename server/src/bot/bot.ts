import { and, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { bookings, broadcasts, clients, slots, users } from '../db/schema.js';
import { kyivDate } from '../time.js';
import { loadSettings, type Notifier } from './notifier.js';
import { keyboard, type TelegramApi } from './telegram.js';
import { tx } from './texts.js';

export type Audience = 'ALL' | 'ACTIVE' | 'GROUP';
const AUDIENCES: Audience[] = ['ALL', 'ACTIVE', 'GROUP'];

type TgUser = { id: number; first_name?: string; username?: string; language_code?: string };
type Message = { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string };
type CallbackQuery = { id: string; from: TgUser; data?: string; message?: Message };
export type Update = { update_id: number; message?: Message; callback_query?: CallbackQuery };

/** Стан діалогу розсилки тренера (у пам'яті: втрачається при перезапуску — тоді просто почати знову). */
type Session = { step: 'content' } | { step: 'audience'; messageId: number };

const GROUP_LOOKBACK_DAYS = 60;
const SEND_DELAY_MS = 40; // ≈ 25 повідомлень/с — у межах лімітів Telegram

export class Bot {
  private sessions = new Map<string, Session>();
  /** Розсилки, що зараз надсилаються (для тестів — можна дочекатися). */
  readonly pending = new Set<Promise<void>>();

  constructor(
    private db: Db,
    private tg: TelegramApi,
    private config: Config,
    private notifier: Notifier,
    private log: { error: (o: unknown, msg?: string) => void } = console,
    private sendDelayMs = SEND_DELAY_MS,
  ) {}

  private isTrainer(id: number) {
    return this.config.trainerIds.has(String(id));
  }

  /** Створює/оновлює користувача, повертає його мову. */
  private async touchUser(from: TgUser, started: boolean) {
    const lang = from.language_code?.startsWith('ru') ? 'ru' : 'uk';
    const [u] = await this.db
      .insert(users)
      .values({
        telegramId: BigInt(from.id),
        firstName: from.first_name ?? null,
        username: from.username ?? null,
        language: lang,
        ...(started ? { botStartedAt: new Date() } : {}),
      })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: {
          firstName: sql`excluded.first_name`,
          username: sql`excluded.username`,
          ...(started ? { botStartedAt: sql`now()`, botBlockedAt: sql`null` } : {}),
        },
      })
      .returning();
    return u!;
  }

  private reply(chatId: number, text: string, extra: Record<string, unknown> = {}) {
    return this.tg.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
  }

  async handleUpdate(update: Update) {
    try {
      if (update.callback_query) await this.onCallback(update.callback_query);
      else if (update.message) await this.onMessage(update.message);
    } catch (e) {
      this.log.error(e, 'bot update failed');
    }
  }

  private async onMessage(m: Message) {
    if (!m.from || m.chat.type !== 'private') return;
    const text = m.text?.trim() ?? '';
    const command = text.startsWith('/') ? text.split(/[\s@]/)[0]!.toLowerCase() : null;
    const u = await this.touchUser(m.from, command === '/start');
    const t = tx(u.language);
    const trainer = this.isTrainer(m.from.id);
    const key = String(m.chat.id);

    if (command === '/start') {
      this.sessions.delete(key);
      if (trainer) {
        const cfg = await loadSettings(this.db);
        await this.reply(m.chat.id, t.startTrainer(m.from.first_name ?? '').replace('{time}', cfg.dailySummaryTime));
        await this.setTrainerCommands(m.chat.id);
      } else {
        await this.reply(m.chat.id, t.startClient(m.from.first_name ?? ''), {
          reply_markup: keyboard(await this.notifier.clientButtons(u.language)),
        });
      }
      return;
    }

    if (!trainer) {
      if (command === '/today' || command === '/broadcast') {
        await this.reply(m.chat.id, t.notTrainer);
        return;
      }
      const buttons = await this.notifier.clientButtons(u.language);
      await this.reply(m.chat.id, t.otherMessage, buttons.length ? { reply_markup: keyboard(buttons) } : {});
      return;
    }

    // --- тренер ---
    if (command === '/cancel') {
      this.sessions.delete(key);
      await this.reply(m.chat.id, t.bcCancelled);
      return;
    }
    if (command === '/today') {
      await this.reply(m.chat.id, await this.notifier.summaryText(kyivDate(new Date()), u.language));
      return;
    }
    if (command === '/broadcast') {
      this.sessions.set(key, { step: 'content' });
      await this.reply(m.chat.id, t.bcAskContent);
      return;
    }

    const session = this.sessions.get(key);
    if (session?.step === 'content' && !command) {
      this.sessions.set(key, { step: 'audience', messageId: m.message_id });
      await this.reply(m.chat.id, t.bcAskAudience, {
        reply_markup: keyboard([
          ...AUDIENCES.map((a) => [{ text: t.bcAudience[a]!, callback_data: `bc:aud:${a}` }]),
          [{ text: t.bcCancel, callback_data: 'bc:cancel' }],
        ]),
      });
      return;
    }

    await this.reply(m.chat.id, t.startTrainer(m.from.first_name ?? '').split('\n\n').slice(1, 2).join(''));
  }

  private async onCallback(q: CallbackQuery) {
    const data = q.data ?? '';
    const chatId = q.message?.chat.id;
    const [u] = await this.db.select().from(users).where(eq(users.telegramId, BigInt(q.from.id)));
    const t = tx(u?.language);
    await this.tg.call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => undefined);
    if (!chatId || !this.isTrainer(q.from.id) || !data.startsWith('bc:')) return;
    const key = String(chatId);

    if (data === 'bc:cancel') {
      this.sessions.delete(key);
      await this.reply(chatId, t.bcCancelled);
      return;
    }

    if (data.startsWith('bc:aud:')) {
      const session = this.sessions.get(key);
      const audience = data.slice(7) as Audience;
      if (session?.step !== 'audience' || !AUDIENCES.includes(audience)) {
        await this.reply(chatId, t.bcExpired);
        return;
      }
      this.sessions.delete(key);
      const recipients = await this.recipients(audience);
      if (recipients.length === 0) {
        await this.reply(chatId, t.bcNobody);
        return;
      }
      const [b] = await this.db
        .insert(broadcasts)
        .values({ sourceChatId: BigInt(chatId), sourceMessageId: session.messageId, audience, recipients: recipients.length })
        .returning();
      // Попередній перегляд: копія повідомлення + кнопки.
      await this.tg.call('copyMessage', { chat_id: chatId, from_chat_id: chatId, message_id: session.messageId });
      await this.reply(chatId, t.bcPreview(t.bcAudience[audience]!, recipients.length), {
        reply_markup: keyboard([
          [{ text: t.bcSend, callback_data: `bc:send:${b!.id}` }],
          [{ text: t.bcCancel, callback_data: `bc:drop:${b!.id}` }],
        ]),
      });
      return;
    }

    if (data.startsWith('bc:drop:')) {
      await this.reply(chatId, t.bcCancelled);
      return;
    }

    if (data.startsWith('bc:send:')) {
      const id = Number(data.slice(8));
      // Захист від повторного натискання: надсилаємо лише раз.
      const [b] = await this.db
        .update(broadcasts)
        .set({ sentAt: new Date() })
        .where(and(eq(broadcasts.id, id), isNull(broadcasts.sentAt)))
        .returning();
      if (!b) {
        await this.reply(chatId, t.bcExpired);
        return;
      }
      const recipients = await this.recipients(b.audience as Audience);
      await this.reply(chatId, t.bcSending(recipients.length));
      const job = this.deliver(b.id, chatId, b.sourceMessageId, recipients, t).finally(() => this.pending.delete(job));
      this.pending.add(job);
    }
  }

  private async deliver(
    broadcastId: number,
    fromChatId: number,
    messageId: number,
    recipients: { userId: number; telegramId: bigint }[],
    t: ReturnType<typeof tx>,
  ) {
    let ok = 0;
    let fail = 0;
    for (const r of recipients) {
      try {
        await this.tg.call('copyMessage', { chat_id: String(r.telegramId), from_chat_id: fromChatId, message_id: messageId });
        ok++;
      } catch (e) {
        fail++;
        await this.notifier.handleSendError(r.userId, e);
      }
      if (this.sendDelayMs) await new Promise((res) => setTimeout(res, this.sendDelayMs));
    }
    await this.db.update(broadcasts).set({ delivered: ok, failed: fail }).where(eq(broadcasts.id, broadcastId));
    await this.reply(fromChatId, t.bcDone(ok, fail)).catch((e) => this.log.error(e));
  }

  /** Отримувачі розсилки: клієнти з Telegram, крім архівних, тренера й тих, хто заблокував бота. */
  async recipients(audience: Audience) {
    const trainerIds = [...this.config.trainerIds].filter((s) => /^\d+$/.test(s)).map(BigInt);
    const conds = [
      isNotNull(clients.userId),
      ne(clients.status, 'INACTIVE'),
      isNull(users.botBlockedAt),
      ...(trainerIds.length ? [sql`${users.telegramId} not in (${sql.join(trainerIds.map((i) => sql`${i}`), sql`, `)})`] : []),
    ];
    if (audience === 'ACTIVE') conds.push(eq(clients.status, 'ACTIVE'));
    if (audience === 'GROUP') {
      const since = new Date(Date.now() - GROUP_LOOKBACK_DAYS * 86_400_000);
      const inGroups = this.db
        .select({ id: bookings.clientId })
        .from(bookings)
        .innerJoin(slots, eq(slots.id, bookings.slotId))
        .where(and(eq(slots.type, 'GROUP'), ne(bookings.status, 'CANCELLED'), gt(slots.startsAt, since)));
      conds.push(inArray(clients.id, inGroups));
    }
    return this.db
      .select({ userId: users.id, telegramId: users.telegramId })
      .from(clients)
      .innerJoin(users, eq(users.id, clients.userId))
      .where(and(...conds));
  }

  async setTrainerCommands(chatId: number) {
    await this.tg
      .call('setMyCommands', {
        scope: { type: 'chat', chat_id: chatId },
        commands: [
          { command: 'today', description: 'Заняття на сьогодні' },
          { command: 'broadcast', description: 'Розсилка клієнтам' },
          { command: 'cancel', description: 'Скасувати розсилку' },
        ],
      })
      .catch((e) => this.log.error(e, 'setMyCommands failed'));
  }
}
