import { z } from 'zod';
import { authenticator } from 'otplib';
import { verifyPendingToken, recordAdminLoginSuccess } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { createAdminSession, sessionCookie, ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE } from '@/lib/sessions';
import { json, errorJson, readClientIp, assertSameOrigin } from '@/lib/http';
import { checkRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

authenticator.options = { window: 1 };

const Body = z.object({
  pending_token: z.string().min(20).max(2000),
  code: z.string().regex(/^[0-9]{6}$/, 'Enter the 6-digit code'),
});

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const ip = readClientIp(req);
  const rl = await checkRateLimit({ key: `admin:2fa:${ip}`, windowSeconds: 300, max: 15 });
  if (!rl.allowed) return errorJson('rate_limited', 'Too many attempts. Wait 5 minutes.', 429);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'Enter the 6-digit code from your authenticator.', 400);

  const pending = verifyPendingToken(parsed.data.pending_token);
  if (!pending) return errorJson('bad_pending', 'Login session expired — sign in again.', 400);

  const sql = getDb();
  if (pending.mode === 'enroll') {
    if (!pending.secret) return errorJson('bad_pending', 'Enrollment state lost — sign in again.', 400);
    if (!authenticator.verify({ token: parsed.data.code, secret: pending.secret })) {
      return errorJson('bad_code', 'Code mismatch. Scan the QR again or re-enter the setup key.', 400);
    }
    await sql`update public.admin_users
                 set totp_secret = ${pending.secret}, totp_enrolled_at = now(), updated_at = now()
               where id = ${pending.adminId}`;
    await recordAdminLoginSuccess(pending.adminId);
    const ua = req.headers.get('user-agent') ?? undefined;
    const token = await createAdminSession(pending.adminId, ip, ua);
    return json({ ok: true, enrolled: true }, 200, { 'Set-Cookie': sessionCookie(ADMIN_COOKIE, token, ADMIN_COOKIE_MAX_AGE) });
  }

  // mode === 'totp'
  const rows = await sql<{ totp_secret: string | null }[]>`select totp_secret from public.admin_users where id = ${pending.adminId}`;
  const secret = rows[0]?.totp_secret;
  if (!secret) return errorJson('bad_pending', '2FA not enrolled — sign in again.', 400);
  if (!authenticator.verify({ token: parsed.data.code, secret })) {
    return errorJson('bad_code', 'Wrong authenticator code.', 400);
  }
  await recordAdminLoginSuccess(pending.adminId);
  const ua = req.headers.get('user-agent') ?? undefined;
  const token = await createAdminSession(pending.adminId, ip, ua);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(ADMIN_COOKIE, token, ADMIN_COOKIE_MAX_AGE) });
}
