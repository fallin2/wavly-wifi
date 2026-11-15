import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { verifyWebhookSignature, parseWebhookEvent } from '../../lib/paystack';

const TEST_KEY = 'sk_test_wavly_unit_test_key_1234567890';

describe('Paystack webhook signature', () => {
  beforeEach(() => { process.env.PAYSTACK_SECRET_KEY = TEST_KEY; });
  afterEach(() => { delete process.env.PAYSTACK_SECRET_KEY; });

  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'wavly-abc', amount: 7000, status: 'success', channel: 'mobile_money' } });

  it('accepts a valid signature', () => {
    const sig = crypto.createHmac('sha512', TEST_KEY).update(body, 'utf8').digest('hex');
    expect(verifyWebhookSignature(body, sig)).toBe(true);
  });
  it('rejects a forged signature', () => {
    const sig = crypto.createHmac('sha512', 'sk_live_wrong').update(body, 'utf8').digest('hex');
    expect(verifyWebhookSignature(body, sig)).toBe(false);
  });
  it('rejects a missing/empty signature', () => {
    expect(verifyWebhookSignature(body, null)).toBe(false);
    expect(verifyWebhookSignature(body, '')).toBe(false);
  });
  it('rejects a tampered body', () => {
    const sig = crypto.createHmac('sha512', TEST_KEY).update(body, 'utf8').digest('hex');
    const tampered = body.replace('7000', '100');
    expect(verifyWebhookSignature(tampered, sig)).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  it('extracts the charge.success fields', () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'wavly-xyz', amount: 8000, status: 'success', channel: 'mobile_money', paid_at: '2026-11-15T10:00:00.000Z' },
    });
    const ev = parseWebhookEvent(body)!;
    expect(ev.event).toBe('charge.success');
    expect(ev.reference).toBe('wavly-xyz');
    expect(ev.amountPesewas).toBe(8000);
    expect(ev.status).toBe('success');
  });
  it('returns null on malformed JSON', () => {
    expect(parseWebhookEvent('{not json')).toBeNull();
  });
  it('tolerates missing data block', () => {
    const ev = parseWebhookEvent('{"event":"ping"}')!;
    expect(ev.event).toBe('ping');
    expect(ev.reference).toBeNull();
  });
});
