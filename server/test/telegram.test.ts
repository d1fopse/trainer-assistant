import { describe, expect, it } from 'vitest';
import { TelegramError, createTelegramApi } from '../src/bot/telegram.js';

function fakeFetch(responses: unknown[]) {
  const calls: { url: string; body: unknown }[] = [];
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { status: 200, json: async () => responses.shift() } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('Telegram API client', () => {
  it('posts JSON to the bot method URL and returns the result', async () => {
    const f = fakeFetch([{ ok: true, result: { message_id: 5 } }]);
    const api = createTelegramApi('123:ABC', f.impl);
    expect(await api.call('sendMessage', { chat_id: 1, text: 'hi' })).toEqual({ message_id: 5 });
    expect(f.calls[0]).toEqual({ url: 'https://api.telegram.org/bot123:ABC/sendMessage', body: { chat_id: 1, text: 'hi' } });
  });

  it('throws TelegramError and recognises blocked users', async () => {
    const f = fakeFetch([{ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }]);
    const err = await createTelegramApi('t', f.impl).call('sendMessage', {}).catch((e) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect(err.isBlocked).toBe(true);
  });

  it('retries once after a rate limit', async () => {
    const f = fakeFetch([
      { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } },
      { ok: true, result: true },
    ]);
    expect(await createTelegramApi('t', f.impl).call('copyMessage', {})).toBe(true);
    expect(f.calls).toHaveLength(2);
  });
});
