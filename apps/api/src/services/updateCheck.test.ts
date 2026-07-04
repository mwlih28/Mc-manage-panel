import { describe, it, expect } from 'vitest';
import { parseVersion, isNewer } from './updateCheck';

describe('parseVersion', () => {
  it('parses a plain semver string', () => {
    expect(parseVersion('1.2.0')).toEqual([1, 2, 0]);
  });

  it('parses a "v"-prefixed tag', () => {
    expect(parseVersion('v1.2.0')).toEqual([1, 2, 0]);
  });

  it('returns null for a non-semver string like "main"', () => {
    expect(parseVersion('main')).toBeNull();
  });
});

describe('isNewer', () => {
  it('flags a higher patch version as newer', () => {
    expect(isNewer('1.2.0', '1.2.1')).toBe(true);
  });

  it('flags a higher minor/major version as newer', () => {
    expect(isNewer('1.2.0', '1.3.0')).toBe(true);
    expect(isNewer('1.2.0', '2.0.0')).toBe(true);
  });

  it('does not flag the same version as newer', () => {
    expect(isNewer('1.2.0', '1.2.0')).toBe(false);
  });

  it('does not flag an older release as newer', () => {
    expect(isNewer('1.2.0', '1.1.0')).toBe(false);
  });

  // A dev checkout running ahead of the last tagged release (e.g. on a
  // feature branch) must never be reported as "outdated" against that tag.
  it('does not flag a dev build ahead of the last tag as outdated', () => {
    expect(isNewer('1.3.0', '1.2.0')).toBe(false);
  });

  it('falls back to string inequality when either version is unparseable', () => {
    expect(isNewer('main', 'v1.2.0')).toBe(true);
    expect(isNewer('main', 'main')).toBe(false);
  });
});
