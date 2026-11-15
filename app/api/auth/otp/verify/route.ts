import { z } from 'zod';
import { normalizeGhanaPhone } from '@/lib/phone';
import { verifyOtp } from '@/lib/otp';
import { getDb } from '@/lib/db';
import { createCustomerSession, sessionCookie, CUSTOMER_COOKIE, CUSTOMER_COOKIE_MAX_AGE } from '@/lib/sessions';
import { json, errorJson, readClientIp, assertSameOrigin } from '@/lib/http';
import { checkRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const Body = z.object({ phone: z.string().min(9).max(24), code: z.string().regex(/^[0-9]{6}$/, 'Code is 6 digits') });

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'Enter the 6-digit code.', 400);

  const phone = normalizeGhanaPhone(parsed.data.phone);
  if (!phone) return errorJson('bad_phone', 'Invalid phone number.', 400);

  const ip = readClientIp(req);
  const rl = await checkRateLimit({ key: `otp:verify:${phone}`, windowSeconds: 600, max: 10 });
  if (!rl.allowed) return errorJson('rate_limited', 'Too many attempts. Wait 10 minutes.', 429);

  const result = await verifyOtp(phone, parsed.data.code, 'login');
  if (result === 'expired') return errorJson('code_expired', 'That code expired. Request a new one.', 400);
  if (result === 'too_many_attempts') return errorJson('too_many_attempts', 'Too many wrong tries. Request a new code.', 429);
  if (result !== 'ok') return errorJson('bad_code', 'Wrong code. Check and try again.', 400);

  const sql = getDb();
  // Find or create the account; record DPA consent at first login (notice text is versioned in settings).
  const rows = await sql<{ id: string }[]>`
    insert into public.customers (phone_e164, consent_at)
    values (${phone}, now())
    on conflict (phone_e164) do update set last_seen_at = now()
    returning id`;
  const customerId = rows[0].id;

  const ua = req.headers.get('user-agent') ?? undefined;
  const token = await createCustomerSession(customerId, ip, ua);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(CUSTOMER_COOKIE, token, CUSTOMER_COOKIE_MAX_AGE) });
}
