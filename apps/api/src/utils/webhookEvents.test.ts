import { describe, it, expect } from 'vitest';
import { eventMatches } from './webhookEvents';

describe('eventMatches', () => {
  it('matches an exact event', () => {
    expect(eventMatches('server:create', 'server:create')).toBe(true);
  });

  it('does not match a different exact event', () => {
    expect(eventMatches('server:create', 'server:delete')).toBe(false);
  });

  it('"*" matches anything', () => {
    expect(eventMatches('*', 'server:power.start')).toBe(true);
    expect(eventMatches('*', 'user:create')).toBe(true);
  });

  it('a "prefix.*" wildcard matches events under that prefix', () => {
    expect(eventMatches('server:power.*', 'server:power.start')).toBe(true);
    expect(eventMatches('server:power.*', 'server:power.kill')).toBe(true);
  });

  it('a "prefix.*" wildcard does not match unrelated events', () => {
    expect(eventMatches('server:power.*', 'server:create')).toBe(false);
    expect(eventMatches('server:power.*', 'server:powerwash')).toBe(false);
  });
});
