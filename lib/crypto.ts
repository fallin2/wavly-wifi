import crypto from 'crypto';

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Constant-time comparison of two strings via their digests (safe for unequal lengths). */
export function safeEqual(a: string, b: string): boolean {
  const da = crypto.createHash('sha256').update(a).digest();
  const db = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(da, db);
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'; // lowercase, no commas, PAP-safe

export function randomBase32(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += BASE32_ALPHABET[bytes[i] % 32];
  return out;
}

export function randomNumericCode(length: number): string {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(length, '0');
}

export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}
