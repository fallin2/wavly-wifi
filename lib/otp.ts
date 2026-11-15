import { getDb } from './db';
import { sha256Hex, randomNumericCode } from './crypto';

const OTP_TTL_MINUTES = 10;
const OTP_LENGTH = 6;
const MAX_ATTEMPTS = 5;

export async function createOtp(phoneE164: string, purpose: 'login' | 'stepup' = 'login', ip?: string) {
  const sql = getDb();
  const code = randomNumericCode(OTP_LENGTH);
  const codeHash = sha256Hex(code + ':' + phoneE164);
  await sql`
    insert into public.otps (phone_e164, code_hash, purpose, expires_at, created_ip)
    values (${phoneE164}, ${codeHash}, ${purpose}, now() + (${OTP_TTL_MINUTES} || ' minutes')::interval, ${ip ?? null})`;
  return code; // only ever handed to the SMS sender / dev log — never stored or returned to clients
}

export type VerifyOtpResult = 'ok' | 'invalid' | 'expired' | 'too_many_attempts';

export async function verifyOtp(phoneE164: string, code: string, purpose: 'login' | 'stepup' = 'login'): Promise<VerifyOtpResult> {
  const sql = getDb();
  const codeHash = sha256Hex(code + ':' + phoneE164);
  const rows = await sql<{ id: number; attempts: number; expires_at: Date }[]>`
    select id, attempts, expires_at
      from public.otps
     where phone_e164 = ${phoneE164}
       and purpose = ${purpose}
       and consumed_at is null
     order by created_at desc
     limit 1`;
  const row = rows[0];
  if (!row) return 'invalid';
  if (new Date(row.expires_at) < new Date()) return 'expired';
  if (row.attempts >= MAX_ATTEMPTS) return 'too_many_attempts';

  const match = await sql<{ id: number }[]>`
    update public.otps
       set attempts = attempts + 1
     where id = ${row.id}
     returning id`;
  void match;

  const ok = await sql<{ id: number }[]>`
    select id from public.otps
     where id = ${row.id} and code_hash = ${codeHash}`;
  if (ok.length === 0) return 'invalid';

  await sql`update public.otps set consumed_at = now() where id = ${row.id}`;
  return 'ok';
}
