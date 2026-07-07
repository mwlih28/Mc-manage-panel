import jwt from 'jsonwebtoken';
import { describe, it, expect } from 'vitest';
import { signConnectState, verifyConnectState } from './stripeConnect';

describe('signConnectState / verifyConnectState', () => {
  it('round-trips the return URL through a signed token', () => {
    const state = signConnectState('https://panel.example.com/api/v1/stripe-connect/finish');
    const decoded = verifyConnectState(state);
    expect(decoded.returnUrl).toBe('https://panel.example.com/api/v1/stripe-connect/finish');
    expect(typeof decoded.nonce).toBe('string');
    expect(decoded.nonce.length).toBeGreaterThan(0);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ nonce: 'x', returnUrl: 'https://evil.example.com/api/v1/stripe-connect/finish' }, 'wrong-secret');
    expect(() => verifyConnectState(forged)).toThrow();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ nonce: 'x', returnUrl: 'https://panel.example.com/api/v1/stripe-connect/finish' }, process.env.JWT_SECRET!, { expiresIn: -10 });
    expect(() => verifyConnectState(expired)).toThrow();
  });

  it('is readable without verification (jwt.decode), which is what the relay relies on', () => {
    const state = signConnectState('https://panel.example.com/api/v1/stripe-connect/finish');
    const decoded = jwt.decode(state) as { returnUrl?: string } | null;
    expect(decoded?.returnUrl).toBe('https://panel.example.com/api/v1/stripe-connect/finish');
  });
});
