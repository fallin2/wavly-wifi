// Wire Format v1 — see mikrotik/sync-format.md. Tokens joined by commas, 6 per record,
// '-' encodes empty. The router consumes this exactly.
export type WireOpCode = 1 | 2 | 3 | 4; // upsert | enable | disable | kick
export interface WireOp { op: WireOpCode; f: [string, string, string, string, string] }

const SAFE = /^[A-Za-z0-9:_-]{1,64}$/;

function tok(v: string | number | undefined | null): string {
  const s = (v ?? '').toString();
  if (s === '' ) return '-';
  if (!SAFE.test(s)) throw new Error(`wire: unsafe token ${JSON.stringify(s)}`);
  return s;
}

export function upsertOp(username: string, secret: string, profile: string, limitUptimeMin: number, mac?: string | null): WireOp {
  return { op: 1, f: [tok(username), tok(secret), tok(profile), String(Math.max(0, Math.floor(limitUptimeMin))), tok(mac ?? '-')] };
}
export function simpleOp(op: 2 | 3 | 4, username: string): WireOp {
  return { op, f: [tok(username), '-', '-', '-', '-'] };
}
export function encodeWireStream(ops: WireOp[]): string {
  return ops.map((o) => [o.op, ...o.f].map(String).join(',')).join(',');
}
