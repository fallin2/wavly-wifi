// Arkesel SMS adapter. Designed to be swapped (e.g. mNotify, Hubtel) by reimplementing sendSms().
// Dev mode: set ARKESEL_API_KEY empty or SMS_DEV_LOG=true → logs instead of sending, logs to sms_log as skipped_dev.
import { getDb } from './db';

export type SmsPurpose = 'otp' | 'receipt' | 'expiry_reminder' | 'expired_notice' | 'voucher' | 'admin_test';

interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  skipped?: boolean;
  error?: string;
}

function devLogEnabled(): boolean {
  return !process.env.ARKESEL_API_KEY || process.env.SMS_DEV_LOG === 'true';
}

async function sendViaArkesel(phoneE164: string, message: string): Promise<SendResult> {
  const apiKey = process.env.ARKESEL_API_KEY!;
  const sender = process.env.ARKESEL_SENDER || 'WAVLY';
  try {
    const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, message, recipients: [phoneE164.replace(/^\+/, '')] }),
    });
    const bodyText = await res.text();
    let body: any = {};
    try { body = JSON.parse(bodyText); } catch { /* keep raw */ }
    if (!res.ok || (body?.status && body.status !== 'success')) {
      return { ok: false, error: `arkesel_http_${res.status}:${bodyText.slice(0, 200)}` };
    }
    return { ok: true, providerMessageId: body?.data?.[0]?.id ?? body?.message_id ?? undefined };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 200) };
  }
}

export async function sendSms(phoneE164: string, purpose: SmsPurpose, message: string, bodyPreview?: string): Promise<SendResult> {
  const sql = getDb();
  const preview = (bodyPreview ?? message).slice(0, 160);
  // Never log OTP digits: caller passes redacted preview for OTP purposes.
  if (devLogEnabled()) {
    console.log(`[sms:dev] to=${phoneE164} purpose=${purpose} message="${message}"`);
    await sql`insert into public.sms_log (phone_e164, purpose, body_preview, provider, status)
              values (${phoneE164}, ${purpose}, ${preview}, 'dev', 'skipped_dev')`.catch(() => {});
    return { ok: true, skipped: true };
  }
  const result = await sendViaArkesel(phoneE164, message);
  await sql`insert into public.sms_log (phone_e164, purpose, body_preview, provider, provider_message_id, status)
            values (${phoneE164}, ${purpose}, ${preview}, 'arkesel', ${result.providerMessageId ?? null}, ${result.ok ? 'sent' : 'failed'})`.catch(() => {});
  return result;
}
