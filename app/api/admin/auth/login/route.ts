import { z } from 'zod';
import { authenticator } from 'otplib';
import { findAdminByUsername, verifyPassword, recordAdminLoginFailure, recordAdminLoginSuccess, adminLocked, signPendingToken } from '@/lib/admin-auth';
import { checkRateLimit } from '@/lib/ratelimit';
import { json, errorJson, readClientIp, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

authenticator.options = { window: 1 };

const Body = z.object({ username: z.string().min(3).max(32), password: z.string().min(8).max(128) });

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const ip = readClientIp(req);
  const rl = await checkRateLimit({ key: `admin:login:${ip}`, windowSeconds: 900, max: 20 });
  if (!rl.allowed) return errorJson('rate_limited', 'Too many attempts. Wait 15 minutes.', 429);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'Enter username and password.', 400);

  const admin = await findAdminByUsername(parsed.data.username);
  const fail = () => errorJson('bad_credentials', 'Wrong username or password.', 401);
  if (!admin || !admin.active) return fail();
  if (adminLocked(admin)) return errorJson('locked', 'Account temporarily locked. Try again in 15 minutes.', 423);

  const passwordOk = await verifyPassword(parsed.data.password, admin.password_hash);
  if (!passwordOk) {
    await recordAdminLoginFailure(admin.id);
    return fail();
  }
  await recordAdminLoginSuccess(admin.id);

  if (admin.totp_secret) {
    return json({ status: 'totp_required', pending_token: signPendingToken(admin.id, 'totp') });
  }
  // First login: force TOTP enrollment. Return the provisioning URI ONCE.
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(admin.username, 'Wavly WiFi Admin', secret);
  // Secret is HMAC-wrapped client-side? No — the confirm step needs it; pass it inside the pending token is NOT possible (admin row write happens at confirm).
  // Instead we stash the secret transiently in the pending token payload.
  return json({ status: 'enroll_required', secret, otpauth_url: otpauthUrl, pending_token: signPendingToken(admin.id, 'enroll', secret) });
}
