import { describe, it, expect } from 'vitest';
import { formatBytes, formatUptime } from './utils';

describe('formatBytes', () => {
  // Regression test: formatBytes(undefined) used to return "NaN undefined"
  // whenever the stats relay delivered no data yet.
  it('returns "0 B" for undefined', () => {
    expect(formatBytes(undefined)).toBe('0 B');
  });

  it('returns "0 B" for null', () => {
    expect(formatBytes(null)).toBe('0 B');
  });

  it('returns "0 B" for zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('returns "0 B" for a negative number', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });

  it('formats bytes into the right unit', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });

  it('respects the decimals argument', () => {
    expect(formatBytes(1536, 1)).toBe('1.5 KB');
  });
});

describe('formatUptime', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatUptime(45)).toBe('45s');
  });

  it('formats sub-hour durations as minutes and seconds', () => {
    expect(formatUptime(125)).toBe('2m 5s');
  });

  it('formats sub-day durations as hours, minutes, seconds', () => {
    expect(formatUptime(3725)).toBe('1h 2m 5s');
  });

  it('formats multi-day durations as days, hours, minutes', () => {
    expect(formatUptime(90000)).toBe('1d 1h 0m');
  });
});
