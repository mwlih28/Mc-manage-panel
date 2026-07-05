import { describe, it, expect } from 'vitest';
import { API_MANIFEST } from './apiManifest';
import { API_KEY_SCOPES } from './apiKeys';

describe('API_MANIFEST', () => {
  it('only references scopes that exist in API_KEY_SCOPES', () => {
    for (const entry of API_MANIFEST) {
      const scopes = Array.isArray(entry.scope) ? entry.scope : [entry.scope];
      for (const s of scopes) {
        expect(API_KEY_SCOPES).toContain(s);
      }
    }
  });

  it('is non-empty and every entry has a description', () => {
    expect(API_MANIFEST.length).toBeGreaterThan(0);
    for (const entry of API_MANIFEST) {
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});
