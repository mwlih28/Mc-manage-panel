import { describe, it, expect } from 'vitest';
import { generateTokenPair, verifyAccessToken, verifyRefreshToken } from './jwt';

describe('JWT token pair', () => {
  const payload = { userId: 'user-1', email: 'admin@example.com', role: 'ADMIN' };

  it('issues an access token that verifies back to the same payload', () => {
    const { accessToken } = generateTokenPair(payload);
    const decoded = verifyAccessToken(accessToken);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.role).toBe(payload.role);
  });

  it('issues a refresh token that verifies back to the same payload', () => {
    const { refreshToken } = generateTokenPair(payload);
    const decoded = verifyRefreshToken(refreshToken);
    expect(decoded.userId).toBe(payload.userId);
  });

  it('rejects an access token verified against the refresh-token path', () => {
    const { accessToken } = generateTokenPair(payload);
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });

  it('rejects a tampered token', () => {
    const { accessToken } = generateTokenPair(payload);
    expect(() => verifyAccessToken(accessToken + 'tampered')).toThrow();
  });
});
