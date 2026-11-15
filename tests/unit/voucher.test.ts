import { describe, it, expect } from 'vitest';
import { normalizeVoucherCode, voucherHash } from '../../lib/billing';
import { sha256Hex } from '../../lib/crypto';

describe('voucher codes', () => {
  it('normalizes dashes, spaces and case', () => {
    expect(normalizeVoucherCode('wav-k3gh-9qxd-mt2p')).toBe('WAVK3GH9QXDMT2P');
    expect(normalizeVoucherCode('WAV K3GH 9QXD MT2P')).toBe('WAVK3GH9QXDMT2P');
    expect(normalizeVoucherCode('WAVK3GH9QXDMT2P')).toBe('WAVK3GH9QXDMT2P');
  });
  it('hashes the normalized code — formatting does not matter', () => {
    expect(voucherHash('WAV-K3GH-9QXD-MT2P')).toBe(voucherHash('wavk3gh9qxdmt2p'));
    expect(voucherHash('WAV-K3GH-9QXD-MT2P')).toBe(sha256Hex('WAVK3GH9QXDMT2P'));
  });
});
