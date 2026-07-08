import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { verifyTebexSignature, parseStorePayload } from './storeIntegrationService';

describe('verifyTebexSignature', () => {
  const secret = 'test-secret';
  const body = JSON.stringify({ package: { id: 42 }, player: { username: 'Steve' } });

  it('accepts a correctly computed signature', () => {
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyTebexSignature(body, secret, sig)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyTebexSignature(body + 'x', secret, sig)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const sig = crypto.createHmac('sha256', 'other-secret').update(body).digest('hex');
    expect(verifyTebexSignature(body, secret, sig)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyTebexSignature(body, secret, undefined)).toBe(false);
  });

  it('does not throw on a malformed (wrong-length) signature header', () => {
    expect(verifyTebexSignature(body, secret, 'not-a-real-signature')).toBe(false);
  });
});

describe('parseStorePayload', () => {
  it('extracts package id, username and event id from a Tebex-shaped payload', () => {
    const result = parseStorePayload('tebex', { id: 'evt_1', package: { id: 42 }, player: { username: 'Steve' } });
    expect(result).toEqual({ packageId: '42', username: 'Steve', eventId: 'evt_1' });
  });

  it('extracts package id, username and event id from a CraftingStore-shaped payload', () => {
    const result = parseStorePayload('craftingstore', { package_id: 7, username: 'Alex', transaction_id: 'tx_9' });
    expect(result).toEqual({ packageId: '7', username: 'Alex', eventId: 'tx_9' });
  });

  it('returns nulls when fields are missing', () => {
    expect(parseStorePayload('tebex', {})).toEqual({ packageId: null, username: null, eventId: null });
  });
});
