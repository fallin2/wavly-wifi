import crypto from 'crypto';
import { getDb } from './db';

const CUSTOMER_TTL_DAYS = 30;
const ADMIN_TTL_HOURS = 12;

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export async function createCustomerSession(customerId: string, ip?: string, userAgent?: string) {
  const sql = getDb();
  const { token, tokenHash } = newSessionToken();
  await sql`
    insert into public.sessions (kind, customer_id, token_hash, ip, user_agent, expires_at)
    values ('customer', ${customerId}, ${tokenHash}, ${ip ?? null}, ${userAgent ?? null}, now() + interval '30 days')`;
  return token;
}

export async function createAdminSession(adminId: string, ip?: string, userAgent?: string) {
  const sql = getDb();
  const { token, tokenHash } = newSessionToken();
  await sql`
    insert into public.sessions (kind, admin_id, token_hash, ip, user_agent, expires_at)
    values ('admin', ${adminId}, ${tokenHash}, ${ip ?? null}, ${userAgent ?? null}, now() + (${ADMIN_TTL_HOURS} || ' hours')::interval)`;
  return token;
}

export interface CustomerSession { customerId: string; displayName: string | null; phoneE164: string }
export interface AdminSession { adminId: string; username: string; role: string }

function extractToken(req: Request, cookieName: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === cookieName) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const CUSTOMER_COOKIE = 'wavly_session';
export const ADMIN_COOKIE = 'wavly_admin';

export async function getCustomerSession(req: Request): Promise<CustomerSession | null> {
  const token = extractToken(req, CUSTOMER_COOKIE);
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const sql = getDb();
  // Ban a session if the customer was banned/deleted or the session expired — checked in one go.
  const rows = await sql<CustomerSession[]>`
    select c.id as "customerId", c.display_name as "displayName", c.phone_e164 as "phoneE164"
      from public.sessions s
      join public.customers c on c.id = s.customer_id
     where s.kind = 'customer' and s.token_hash = ${hash}
       and s.expires_at > now()
       and c.account_status = 'active'
       and c.deleted_at is null`;
  if (rows.length) {
    // sliding refresh, fire and forget
    void sql`update public.sessions set last_seen_at = now() where token_hash = ${hash}`.catch(() => {});
  }
  return rows[0] ?? null;
}

export async function getAdminSession(req: Request): Promise<AdminSession | null> {
  const token = extractToken(req, ADMIN_COOKIE);
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const sql = getDb();
  const rows = await sql<AdminSession[]>`
    select a.id as "adminId", a.username as "username", a.role as role
      from public.sessions s
      join public.admin_users a on a.id = s.admin_id
     where s.kind = 'admin' and s.token_hash = ${hash}
       and s.expires_at > now()
       and a.active = true`;
  if (rows.length) {
    void sql`update public.sessions set last_seen_at = now() where token_hash = ${hash}`.catch(() => {});
  }
  return rows[0] ?? null;
}

export async function destroySession(req: Request, cookieName: string) {
  const token = extractToken(req, cookieName);
  if (!token) return;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await getDb()`delete from public.sessions where token_hash = ${hash}`;
}

export function sessionCookie(name: string, token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const CUSTOMER_COOKIE_MAX_AGE = CUSTOMER_TTL_DAYS * 24 * 3600;
export const ADMIN_COOKIE_MAX_AGE = ADMIN_TTL_HOURS * 3600;
