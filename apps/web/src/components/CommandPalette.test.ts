import { describe, it, expect } from 'vitest';
import { fuzzyScore } from './CommandPalette';

describe('fuzzyScore', () => {
  it('gives an empty query a neutral positive score (everything matches)', () => {
    expect(fuzzyScore('', 'Anything')).toBeGreaterThan(0);
  });

  it('returns a positive score for a contiguous substring match', () => {
    expect(fuzzyScore('serv', 'Servers')).toBeGreaterThan(0);
  });

  it('returns -1 when the query is not a subsequence of the target', () => {
    expect(fuzzyScore('xyz', 'Servers')).toBe(-1);
  });

  it('ranks a word-boundary match above a mid-word one', () => {
    // "log" at the start of "Logo Generator" should beat "log" inside "Backlog".
    const atStart = fuzzyScore('log', 'Logo Generator');
    const midWord = fuzzyScore('log', 'Backlog item');
    expect(atStart).toBeGreaterThan(midWord);
  });

  it('ranks a contiguous match above a scattered subsequence match', () => {
    const contiguous = fuzzyScore('sett', 'Settings');
    const scattered = fuzzyScore('sett', 'Server event tracker'); // s..e..t..t via subsequence
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it('matches case-insensitively', () => {
    expect(fuzzyScore('DASH', 'Dashboard')).toBeGreaterThan(0);
  });
});
