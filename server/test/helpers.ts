import { createHmac } from 'node:crypto';

/** Генерує валідний initData, підписаний ботом (так само, як це робить Telegram). */
export function signInitData(
  botToken: string,
  user: Record<string, unknown>,
  authDate: number,
  tamper?: (params: URLSearchParams) => void,
): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAH_test');
  params.set('user', JSON.stringify(user));

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  tamper?.(params);
  return params.toString();
}
