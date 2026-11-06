import type { TFunction } from 'i18next';
import { ApiError, type Overlap } from './api';
import { confirmAction } from './telegram';
import { timeRange } from './time';

/** Людський текст помилки сервера (за кодом), або загальний. */
export function errorText(e: unknown, t: TFunction): string {
  if (e instanceof ApiError && e.code) {
    const key = `apiErrors.${e.code}`;
    const text = t(key);
    if (text !== key) return text;
  }
  return t('errors.save');
}

/**
 * Виконує дію; якщо сервер повідомив про перетин слотів — питає підтвердження
 * і повторює з force: true.
 */
export async function withOverlapConfirm<T>(t: TFunction, run: (force: boolean) => Promise<T>): Promise<T | null> {
  try {
    return await run(false);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'overlap') {
      const overlaps = (e.body?.overlaps ?? []) as Overlap[];
      const list = overlaps.map((o) => timeRange(o.startsAt, o.durationMin)).join(', ');
      if (!(await confirmAction(t('calendar.overlapConfirm', { list })))) return null;
      return run(true);
    }
    throw e;
  }
}
