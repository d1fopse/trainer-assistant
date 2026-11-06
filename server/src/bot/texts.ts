import { DateTime } from 'luxon';
import { ZONE } from '../time.js';

export type Lang = 'uk' | 'ru';

const uk = {
  startClient: (name: string) =>
    `Привіт, ${name}! 👋\n\nТут ви бачите вільний час у календарі тренера, ціни та свій абонемент. Нагадування про тренування приходитимуть сюди за 3 години.\n\nЗаписатися чи перенести заняття — напишіть тренеру особисто.`,
  startTrainer: (name: string) =>
    `Привіт, ${name}! Ви — тренер.\n\nКоманди:\n/today — заняття на сьогодні\n/broadcast — розсилка клієнтам\n/cancel — скасувати розсилку\n\nЩодня о {time} я надсилатиму вам план дня.`,
  openApp: 'Відкрити додаток',
  writeTrainer: 'Написати тренеру',
  otherMessage: 'Щоб записатися або поставити питання, напишіть тренеру особисто 👇',
  reminder: (when: string, kind: string) => `⏰ Нагадування: ${when} — тренування (${kind}).\n\nЯкщо плани змінилися, напишіть тренеру.`,
  waitlist: (when: string) => `🔔 Звільнилось місце: ${when}.\n\nНапишіть тренеру, щоб записатися — місце не бронюється автоматично.`,
  summaryEmpty: (day: string) => `☀️ ${day}: занять немає.`,
  summaryHead: (day: string, n: number) => `☀️ ${day} — ${n} ${plural(n, 'заняття', 'заняття', 'занять')}:`,
  free: 'вільно',
  trial: 'пробне',
  group: 'група',
  individual: 'індивідуальне',
  today: 'сьогодні',
  tomorrow: 'завтра',
  bcAskContent: '📣 Надішліть повідомлення для розсилки: текст, фото чи відео з підписом.\n\n/cancel — скасувати.',
  bcAskAudience: 'Кому надіслати?',
  bcAudience: { ALL: 'Усім клієнтам', ACTIVE: 'Лише активним', GROUP: 'Учасникам груп' } as Record<string, string>,
  bcPreview: (aud: string, n: number) => `👆 Так виглядатиме повідомлення.\nОтримувачі: ${aud} — ${n}.`,
  bcSend: '✅ Надіслати',
  bcCancel: 'Скасувати',
  bcCancelled: 'Розсилку скасовано.',
  bcNobody: 'У цій аудиторії немає клієнтів з Telegram.',
  bcSending: (n: number) => `Надсилаю ${n}…`,
  bcDone: (ok: number, fail: number) =>
    `Готово: доставлено ${ok}${fail ? `, не доставлено ${fail} (клієнт не запускав бота або заблокував його)` : ''}.`,
  bcExpired: 'Ця розсилка вже неактуальна. Почніть знову: /broadcast',
  notTrainer: 'Ця команда доступна лише тренеру.',
  slotCancelled: 'Слот скасовано',
};

const ru: typeof uk = {
  startClient: (name) =>
    `Привет, ${name}! 👋\n\nЗдесь вы видите свободное время в календаре тренера, цены и свой абонемент. Напоминания о тренировках будут приходить сюда за 3 часа.\n\nЗаписаться или перенести занятие — напишите тренеру лично.`,
  startTrainer: (name) =>
    `Привет, ${name}! Вы — тренер.\n\nКоманды:\n/today — занятия на сегодня\n/broadcast — рассылка клиентам\n/cancel — отменить рассылку\n\nКаждый день в {time} я буду присылать вам план дня.`,
  openApp: 'Открыть приложение',
  writeTrainer: 'Написать тренеру',
  otherMessage: 'Чтобы записаться или задать вопрос, напишите тренеру лично 👇',
  reminder: (when, kind) => `⏰ Напоминание: ${when} — тренировка (${kind}).\n\nЕсли планы изменились, напишите тренеру.`,
  waitlist: (when) => `🔔 Освободилось место: ${when}.\n\nНапишите тренеру, чтобы записаться — место не бронируется автоматически.`,
  summaryEmpty: (day) => `☀️ ${day}: занятий нет.`,
  summaryHead: (day, n) => `☀️ ${day} — ${n} ${plural(n, 'занятие', 'занятия', 'занятий')}:`,
  free: 'свободно',
  trial: 'пробное',
  group: 'группа',
  individual: 'индивидуальное',
  today: 'сегодня',
  tomorrow: 'завтра',
  bcAskContent: '📣 Отправьте сообщение для рассылки: текст, фото или видео с подписью.\n\n/cancel — отменить.',
  bcAskAudience: 'Кому отправить?',
  bcAudience: { ALL: 'Всем клиентам', ACTIVE: 'Только активным', GROUP: 'Участникам групп' },
  bcPreview: (aud, n) => `👆 Так будет выглядеть сообщение.\nПолучатели: ${aud} — ${n}.`,
  bcSend: '✅ Отправить',
  bcCancel: 'Отменить',
  bcCancelled: 'Рассылка отменена.',
  bcNobody: 'В этой аудитории нет клиентов с Telegram.',
  bcSending: (n) => `Отправляю ${n}…`,
  bcDone: (ok, fail) =>
    `Готово: доставлено ${ok}${fail ? `, не доставлено ${fail} (клиент не запускал бота или заблокировал его)` : ''}.`,
  bcExpired: 'Эта рассылка уже неактуальна. Начните заново: /broadcast',
  notTrainer: 'Эта команда доступна только тренеру.',
  slotCancelled: 'Слот отменён',
};

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const texts = { uk, ru };

export function tx(lang: string | null | undefined) {
  return lang === 'ru' ? ru : uk;
}

/** «сьогодні о 18:00», «завтра о 09:00» або «вт, 10 листопада о 18:00». */
export function formatWhen(d: Date, lang: string, now = new Date()) {
  const t = tx(lang);
  const dt = DateTime.fromJSDate(d, { zone: ZONE }).setLocale(lang === 'ru' ? 'ru' : 'uk');
  const today = DateTime.fromJSDate(now, { zone: ZONE }).startOf('day');
  const time = dt.toFormat('HH:mm');
  const at = lang === 'ru' ? 'в' : 'о';
  if (dt.hasSame(today, 'day')) return `${t.today} ${at} ${time}`;
  if (dt.hasSame(today.plus({ days: 1 }), 'day')) return `${t.tomorrow} ${at} ${time}`;
  return `${dt.toFormat('ccc, d MMMM')} ${at} ${time}`;
}

export function formatDay(d: Date, lang: string) {
  return DateTime.fromJSDate(d, { zone: ZONE })
    .setLocale(lang === 'ru' ? 'ru' : 'uk')
    .toFormat('cccc, d MMMM')
    .replace(/^./, (c) => c.toUpperCase());
}
