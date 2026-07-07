import { describe, it, expect } from 'vitest';
import { computePaytrToken, verifyPaytrCallback } from './storeIntegrationService';

// Fixture values and expected hashes computed independently in Node against
// the exact algorithm verified from two real PayTR reference implementations
// (see storeIntegrationService.ts's computePaytrToken/verifyPaytrCallback
// comments) — not just round-tripping our own function against itself.
const MERCHANT_ID = '123456';
const MERCHANT_KEY = 'test-merchant-key';
const MERCHANT_SALT = 'test-merchant-salt';
const USER_BASKET_BASE64 = Buffer.from(JSON.stringify([['Test', '9.99', 1]])).toString('base64');

describe('computePaytrToken', () => {
  const fields = {
    merchantId: MERCHANT_ID,
    userIp: '1.2.3.4',
    merchantOid: 'abc123',
    email: 'buyer@example.com',
    paymentAmount: 999,
    userBasketBase64: USER_BASKET_BASE64,
    noInstallment: 0,
    maxInstallment: 0,
    currency: 'TL',
    testMode: 1,
  };

  it('matches the independently-computed expected hash for a known worked example', () => {
    expect(computePaytrToken(fields, MERCHANT_KEY, MERCHANT_SALT)).toBe('DY8vq6bTea4bJiJ3e1J6pspdyn9BPGHuqfLRCDJ4Qo4=');
  });

  it('produces a different token if any field changes', () => {
    const base = computePaytrToken(fields, MERCHANT_KEY, MERCHANT_SALT);
    expect(computePaytrToken({ ...fields, paymentAmount: 1000 }, MERCHANT_KEY, MERCHANT_SALT)).not.toBe(base);
    expect(computePaytrToken({ ...fields, merchantOid: 'different' }, MERCHANT_KEY, MERCHANT_SALT)).not.toBe(base);
  });

  it('produces a different token for a different merchant key or salt', () => {
    const base = computePaytrToken(fields, MERCHANT_KEY, MERCHANT_SALT);
    expect(computePaytrToken(fields, 'other-key', MERCHANT_SALT)).not.toBe(base);
    expect(computePaytrToken(fields, MERCHANT_KEY, 'other-salt')).not.toBe(base);
  });
});

describe('verifyPaytrCallback', () => {
  const validBody = {
    merchant_oid: 'abc123',
    status: 'success',
    total_amount: 999,
    hash: 'FwAnZrhdT8FwrUYRDfsALVPr+eumj8zqeyLa31NNSnM=',
  };

  it('accepts a correctly computed callback hash', () => {
    expect(verifyPaytrCallback(validBody, MERCHANT_KEY, MERCHANT_SALT)).toBe(true);
  });

  it('rejects a tampered total_amount', () => {
    expect(verifyPaytrCallback({ ...validBody, total_amount: 1000 }, MERCHANT_KEY, MERCHANT_SALT)).toBe(false);
  });

  it('rejects a tampered status', () => {
    expect(verifyPaytrCallback({ ...validBody, status: 'failed' }, MERCHANT_KEY, MERCHANT_SALT)).toBe(false);
  });

  it('rejects a wrong merchant key', () => {
    expect(verifyPaytrCallback(validBody, 'wrong-key', MERCHANT_SALT)).toBe(false);
  });

  it('rejects a missing hash', () => {
    expect(verifyPaytrCallback({ ...validBody, hash: undefined }, MERCHANT_KEY, MERCHANT_SALT)).toBe(false);
  });

  it('does not throw on a malformed (non-base64-length) hash', () => {
    expect(verifyPaytrCallback({ ...validBody, hash: 'not-a-real-hash' }, MERCHANT_KEY, MERCHANT_SALT)).toBe(false);
  });

  it('rejects a body missing required fields', () => {
    expect(verifyPaytrCallback({}, MERCHANT_KEY, MERCHANT_SALT)).toBe(false);
  });
});
