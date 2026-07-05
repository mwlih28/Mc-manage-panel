import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBindCode, consumeBindCode } from './discordBindCodes';

describe('discordBindCodes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('consumes a valid code and returns the server id', () => {
    const code = createBindCode('server-1');
    expect(consumeBindCode(code)).toBe('server-1');
  });

  it('is single-use — a second consume of the same code fails', () => {
    const code = createBindCode('server-1');
    consumeBindCode(code);
    expect(consumeBindCode(code)).toBeNull();
  });

  it('is case-insensitive', () => {
    const code = createBindCode('server-1');
    expect(consumeBindCode(code.toLowerCase())).toBe('server-1');
  });

  it('rejects an unknown code', () => {
    expect(consumeBindCode('NOTREAL')).toBeNull();
  });

  it('rejects an expired code', () => {
    vi.useFakeTimers();
    const code = createBindCode('server-1');
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(consumeBindCode(code)).toBeNull();
  });
});
