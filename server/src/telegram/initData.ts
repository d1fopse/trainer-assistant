import { createHmac, timingSafeEqual } from 'node:crypto';

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type VerifiedInitData = {
  user: TelegramUser;
  authDate: number;
};

export class InitDataError extends Error {}

/**
 * Перевіряє підпис Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSec: number; now?: number } = { maxAgeSec: 86400 },
): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new InitDataError('hash is missing');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();

  let given: Buffer;
  try {
    given = Buffer.from(hash, 'hex');
  } catch {
    throw new InitDataError('hash is malformed');
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new InitDataError('signature mismatch');
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new InitDataError('auth_date is missing');
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (now - authDate > opts.maxAgeSec) throw new InitDataError('initData expired');

  const rawUser = params.get('user');
  if (!rawUser) throw new InitDataError('user is missing');
  let user: TelegramUser;
  try {
    user = JSON.parse(rawUser) as TelegramUser;
  } catch {
    throw new InitDataError('user is malformed');
  }
  if (typeof user.id !== 'number') throw new InitDataError('user.id is missing');

  return { user, authDate };
}
