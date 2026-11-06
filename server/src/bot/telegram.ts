/** Мінімальний клієнт Telegram Bot API (лише потрібні методи). У тестах підміняється фейком. */
export interface TelegramApi {
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
}

export class TelegramError extends Error {
  constructor(
    public method: string,
    public errorCode: number,
    public description: string,
    public retryAfter?: number,
  ) {
    super(`${method}: ${errorCode} ${description}`);
  }

  /** Користувач заблокував бота або ніколи його не запускав. */
  get isBlocked() {
    return this.errorCode === 403 || /chat not found|bot was blocked|user is deactivated/i.test(this.description);
  }
}

export function createTelegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  const base = `https://api.telegram.org/bot${token}`;
  return {
    async call<T>(method: string, params: Record<string, unknown>, attempt = 0): Promise<T> {
      const res = await fetchImpl(`${base}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const body = (await res.json()) as {
        ok: boolean;
        result?: T;
        error_code?: number;
        description?: string;
        parameters?: { retry_after?: number };
      };
      if (body.ok) return body.result as T;
      const err = new TelegramError(method, body.error_code ?? res.status, body.description ?? '', body.parameters?.retry_after);
      // Перевищено ліміт — чекаємо й повторюємо один раз.
      if (err.errorCode === 429 && attempt === 0 && (err.retryAfter ?? 0) <= 30) {
        await new Promise((r) => setTimeout(r, (err.retryAfter ?? 1) * 1000));
        return (this.call as (m: string, p: Record<string, unknown>, a: number) => Promise<T>)(method, params, 1);
      }
      throw err;
    },
  } as TelegramApi;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type InlineButton =
  | { text: string; url: string }
  | { text: string; web_app: { url: string } }
  | { text: string; callback_data: string };

export const keyboard = (rows: InlineButton[][]) => ({ inline_keyboard: rows });
