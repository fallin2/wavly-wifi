import { z } from 'zod';
import { normalizeGhanaPhone } from '@/lib/phone';
import { checkRateLimit } from '@/lib/ratelimit';
import { createOtp } from '@/lib/otp';
import { sendSms } from '@/lib/sms';
import { json, errorJson, readClientIp } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({ phone: z.string().min(9).max(24) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'Enter a valid phone number.', 400);

  const phone = normalizeGhanaPhone(parsed.data.phone);
  if (!phone) return errorJson('bad_phone', 'Enter a valid Ghana phone number (e.g. 0244123456).', 400);

  const ip = readClientIp(req);
  // Per-phone: 3 codes / 10 min · per-IP: 20 codes / hour (OTP-bomb guard)
  const [byPhone, byIp] = await Promise.all([
    checkRateLimit({ key: `otp:phone:${phone}`, windowSeconds: 600, max: 3 }),
    checkRateLimit({ key: `otp:ip:${ip}`, windowSeconds: 3600, max: 20 }),
  ]);
  if (!byPhone.allowed) return errorJson('rate_limited', 'Too many codes requested. Wait 10 minutes and try again.', 429);
  if (!byIp.allowed) return errorJson('rate_limited', 'Too many requests from this network. Try again later.', 429);

  const code = await createOtp(phone, 'login', ip);
  await sendSms(phone, 'otp', `Wavly WiFi: your code is ${code}. It expires in 10 minutes. Do not share it.`, 'Wavly WiFi: your code is ******');

  // Generic response — no account enumeration. In dev, surface the code for testing.
  const devEcho = process.env.SMS_DEV_LOG === 'true' || process.env.NODE_ENV !== 'production' ? { dev_code: code } : {};
  return json({ ok: true, message: 'If the number is reachable, a code is on its way.', ...devEcho });
}
