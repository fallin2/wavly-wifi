import type postgres from 'postgres';
import { getDb } from './db';

export interface RateLimitRule {
  /** bucket key without the window slot, e.g. 'otp:phone:+233241234567' */
  key: string;
  /** window length in seconds */
  windowSeconds: number;
  /** max allowed hits inside the window */
  max: number;
}

/**
 * Fixed-window rate limiting backed by Postgres (works across serverless instances).
 * Returns { allowed, remaining, retryAfterSeconds }.
 * Fail-open on DB errors would let SMS-bombing through — fail CLOSED for OTP-class routes,
 * caller decides what to do with `allowed=false` on error (we treat DB errors as blocked).
 */
export async function checkRateLimit(rule: RateLimitRule): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const sql = getDb();
  const slot = Math.floor(Date.now() / 1000 / rule.windowSeconds);
  const bucket = `${rule.key}:${slot}`;
  try {
    const rows = await sql<{ count: number }[]>`
      insert into public.rate_limits (bucket_key, count)
      values (${bucket}, 1)
      on conflict (bucket_key) do update set count = rate_limits.count + 1
      returning count`;
    const count = rows[0]?.count ?? 1;
    const allowed = count <= rule.max;
    return { allowed, remaining: Math.max(0, rule.max - count), retryAfter: rule.windowSeconds };
  } catch {
    // Even bucketed inserts can conflict on the same millisecond — one retry, then closed.
    try {
      const rows = await sql<{ count: number }[]>`
        update public.rate_limits set count = count + 1
        where bucket_key = ${bucket}
        returning count`;
      const count = rows[0]?.count ?? rule.max + 1;
      return { allowed: false, remaining: 0, retryAfter: rule.windowSeconds };
    } catch {
      return { allowed: false, remaining: 0, retryAfter: rule.windowSeconds };
    }
  }
}

/** Fire-and-forget cleanup for old buckets (called from cron routes). */
export async function pruneRateLimits(sql: postgres.Sql) {
  await sql`delete from public.rate_limits where created_at < now() - interval '2 days'`;
}
