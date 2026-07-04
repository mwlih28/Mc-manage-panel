import { describe, it, expect } from 'vitest';
import { generateApiKey, hasScope, API_KEY_PREFIX } from './apiKeys';

describe('hasScope', () => {
  it('grants access when the exact scope is present', () => {
    expect(hasScope(['servers:read'], 'servers:read')).toBe(true);
  });

  it('denies access when the scope is missing', () => {
    expect(hasScope(['servers:read'], 'servers:write')).toBe(false);
  });

  it('grants every scope when "*" is present', () => {
    expect(hasScope(['*'], 'users:write')).toBe(true);
  });

  it('denies access for an empty scope list', () => {
    expect(hasScope([], 'servers:read')).toBe(false);
  });
});

describe('generateApiKey', () => {
  it('produces a key in "kre_<identifier>.<secret>" format', async () => {
    const { fullKey, identifier, secret } = await generateApiKey();
    expect(fullKey).toBe(`${API_KEY_PREFIX}${identifier}.${secret}`);
    expect(fullKey.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it('never returns the plaintext secret as the stored hash', async () => {
    const { secret, tokenHash } = await generateApiKey();
    expect(tokenHash).not.toBe(secret);
  });

  it('generates a unique identifier and secret on every call', async () => {
    const a = await generateApiKey();
    const b = await generateApiKey();
    expect(a.identifier).not.toBe(b.identifier);
    expect(a.secret).not.toBe(b.secret);
  });
});
