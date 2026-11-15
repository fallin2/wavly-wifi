import { describe, it, expect } from 'vitest';
import { encodeWireStream, upsertOp, simpleOp } from '../../lib/wire';

describe('Wire Format v1 (mikrotik/sync-format.md)', () => {
  it('encodes an upsert record as exactly 6 tokens', () => {
    const line = encodeWireStream([upsertOp('wlx7kq2ab9', 'mnkdslqxbcaf7gyehz2w', 'wavly-std-5m', 10080, null)]);
    expect(line).toBe('1,wlx7kq2ab9,mnkdslqxbcaf7gyehz2w,wavly-std-5m,10080,-');
    expect(line.split(',')).toHaveLength(6);
  });
  it('encodes enable/disable/kick with - placeholders', () => {
    expect(encodeWireStream([simpleOp(2, 'wlx1p0qa42')])).toBe('2,wlx1p0qa42,-,-,-,-');
    expect(encodeWireStream([simpleOp(4, 'wlx8h2m4n7')])).toBe('4,wlx8h2m4n7,-,-,-,-');
  });
  it('encodes a multi-record stream without whitespace and stays 6-token aligned', () => {
    const stream = encodeWireStream([
      upsertOp('wlx7kq2ab9', 'mnkdslqxbcaf7gyehz2w', 'wavly-std-5m', 10080, 'aa:bb:cc:dd:ee:ff'),
      simpleOp(3, 'wlx1p0qa42'),
      simpleOp(4, 'wlx8h2m4n7'),
    ]);
    expect(stream).not.toMatch(/\s/);
    const tokens = stream.split(',');
    expect(tokens.length % 6).toBe(0);
    expect(tokens.length).toBe(18);
    expect(tokens[4]).toBe('10080');
    expect(tokens[5]).toBe('aa:bb:cc:dd:ee:ff');
  });
  it('clamps negative uptime to 0 (= no limit)', () => {
    expect(encodeWireStream([upsertOp('wlx7kq2ab9', 'mnkdslqxbcaf7gyehz2w', 'wavly-std-5m', -5, null)]))
      .toBe('1,wlx7kq2ab9,mnkdslqxbcaf7gyehz2w,wavly-std-5m,0,-');
  });
  it('rejects tokens with commas or unsafe chars', () => {
    expect(() => encodeWireStream([upsertOp('bad,name', 'secret', 'wavly-std-5m', 0, null)])).toThrow();
    expect(() => encodeWireStream([upsertOp('bad name!', 'secret', 'wavly-std-5m', 0, null)])).toThrow();
  });
});
