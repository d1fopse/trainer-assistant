import { describe, expect, it } from 'vitest';
import { InitDataError, verifyInitData } from '../src/telegram/initData.js';
import { signInitData } from './helpers.js';

const TOKEN = '123456:TEST_TOKEN';
const NOW = 1_800_000_000;
const user = { id: 42, first_name: 'Anna', username: 'anna' };

describe('verifyInitData', () => {
  it('accepts correctly signed data', () => {
    const data = signInitData(TOKEN, user, NOW - 10);
    const res = verifyInitData(data, TOKEN, { maxAgeSec: 3600, now: NOW });
    expect(res.user.id).toBe(42);
  });

  it('rejects a wrong bot token', () => {
    const data = signInitData(TOKEN, user, NOW - 10);
    expect(() => verifyInitData(data, 'other:token', { maxAgeSec: 3600, now: NOW })).toThrow(
      InitDataError,
    );
  });

  it('rejects tampered user id', () => {
    const data = signInitData(TOKEN, user, NOW - 10, (p) =>
      p.set('user', JSON.stringify({ ...user, id: 1 })),
    );
    expect(() => verifyInitData(data, TOKEN, { maxAgeSec: 3600, now: NOW })).toThrow(
      /signature mismatch/,
    );
  });

  it('rejects missing hash', () => {
    const data = signInitData(TOKEN, user, NOW - 10, (p) => p.delete('hash'));
    expect(() => verifyInitData(data, TOKEN, { maxAgeSec: 3600, now: NOW })).toThrow(
      /hash is missing/,
    );
  });

  it('rejects expired data', () => {
    const data = signInitData(TOKEN, user, NOW - 7200);
    expect(() => verifyInitData(data, TOKEN, { maxAgeSec: 3600, now: NOW })).toThrow(/expired/);
  });

  it('rejects non-hex hash', () => {
    const data = signInitData(TOKEN, user, NOW - 10, (p) => p.set('hash', 'zz'));
    expect(() => verifyInitData(data, TOKEN, { maxAgeSec: 3600, now: NOW })).toThrow(
      InitDataError,
    );
  });
});
