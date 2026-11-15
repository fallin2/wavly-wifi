import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from './db';

const PENDING_TTL_SECONDS = 300; // 5 minutes to complete 2FA

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

export interface PendingToken { adminId: string; exp: number; mode: 'totp' | 'enroll'; secret?: string }

export function signPendingToken(adminId: string, mode: PendingToken['mode'], secret?: string): string {
  const exp = Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS;
  const body: PendingToken = { adminId, exp, mode, ...(secret ? { secret } : {}) };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', authSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyPendingToken(token: string): PendingToken | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', authSecret()).update(payload).digest('base64url');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PendingToken;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now() / 1000) return null;
    if (parsed.mode !== 'totp' && parsed.mode !== 'enroll') return null;
    return parsed;
  } catch { return null; }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface AdminRow {
  id: string; username: string; role: string; active: boolean;
  password_hash: string;
  failed_attempts: number; locked_until: Date | null; totp_secret: string | null;
}

export async function findAdminByUsername(username: string): Promise<AdminRow | null> {
  const sql = getDb();
  const rows = await sql<AdminRow[]>`
    select id, username, role, active, password_hash, failed_attempts, locked_until, totp_secret
      from public.admin_users where username = ${username.toLowerCase()}`;
  return rows[0] ?? null;
}

export async function recordAdminLoginFailure(adminId: string) {
  const sql = getDb();
  await sql`
    update public.admin_users
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
     where id = ${adminId}`;
}

export async function recordAdminLoginSuccess(adminId: string) {
  const sql = getDb();
  await sql`update public.admin_users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = ${adminId}`;
}

export function adminLocked(a: AdminRow): boolean {
  return !!a.locked_until && new Date(a.locked_until) > new Date();
}

/** Gate for admin API routes. Returns the admin session or null. */
export async function requireAdmin(req: Request) {
  const { getAdminSession } = await import('./sessions');
  return getAdminSession(req);
}
