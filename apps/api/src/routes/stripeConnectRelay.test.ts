import jwt from 'jsonwebtoken';
import { describe, it, expect } from 'vitest';
import { isSafeReturnUrl, extractReturnUrl } from './stripeConnectRelay';
import { signConnectState } from './stripeConnect';

describe('isSafeReturnUrl', () => {
  it('accepts an https URL ending in the expected finish path', () => {
    expect(isSafeReturnUrl('https://panel.example.com/api/v1/stripe-connect/finish')).toBe(true);
  });

  it('rejects http (non-https) URLs', () => {
    expect(isSafeReturnUrl('http://panel.example.com/api/v1/stripe-connect/finish')).toBe(false);
  });

  it('rejects a URL with a different path', () => {
    expect(isSafeReturnUrl('https://panel.example.com/some/other/path')).toBe(false);
  });

  it('rejects a malformed URL instead of throwing', () => {
    expect(isSafeReturnUrl('not a url')).toBe(false);
  });
});

describe('extractReturnUrl', () => {
  it('extracts the return URL from a validly-shaped state token, without needing the signing secret', () => {
    const state = signConnectState('https://panel.example.com/api/v1/stripe-connect/finish');
    expect(extractReturnUrl(state)).toBe('https://panel.example.com/api/v1/stripe-connect/finish');
  });

  it('still extracts a URL from a state signed with the wrong secret — the relay only decodes, never verifies', () => {
    const forged = jwt.sign({ nonce: 'x', returnUrl: 'https://panel.example.com/api/v1/stripe-connect/finish' }, 'someone-elses-secret');
    expect(extractReturnUrl(forged)).toBe('https://panel.example.com/api/v1/stripe-connect/finish');
  });

  it('returns null when the embedded return URL fails the open-redirect guard', () => {
    const state = jwt.sign({ nonce: 'x', returnUrl: 'https://evil.example.com/steal-tokens' }, 'any-secret');
    expect(extractReturnUrl(state)).toBeNull();
  });

  it('returns null for garbage input instead of throwing', () => {
    expect(extractReturnUrl('not-a-jwt-at-all')).toBeNull();
  });
});
