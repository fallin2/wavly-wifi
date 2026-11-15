import { getDb } from '@/lib/db';
import { sendSms } from '@/lib/sms';
import { json, errorJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const alt = req.headers.get('x-cron-secret') ?? '';
  return bearer === secret || alt === secret;
}

/** T-48h and day-of expiry reminders, each exactly-once per subscription via reminder_log. */
export async function GET(req: Request) {
  if (!authorized(req)) return errorJson('unauthorized', 'Bad cron secret.', 401);

  const sql = getDb();
  const settings = await sql<{ business_name: string; support_phone: string | null }[]>`
    select business_name, support_phone from public.settings where id = 1`;
  const biz = settings[0]?.business_name ?? 'Wavly WiFi';

  const t2d = await sql<{ id: string; phone_e164: string; plan_name: string; expires_at: Date }[]>`
    select s.id, c.phone_e164, p.name as plan_name, s.expires_at
      from public.subscriptions s
      join public.customers c on c.id = s.customer_id
      join public.plans p on p.id = s.plan_id
     where s.status = 'active' and s.expires_at is not null
       and s.expires_at > now() and s.expires_at <= now() + interval '48 hours'`;

  let t2dSent = 0;
  for (const row of t2d) {
    const logged = await sql`
      insert into public.reminder_log (subscription_id, kind)
      values (${row.id}, 't_minus_2d')
      on conflict (subscription_id, kind) do nothing
      returning id`;
    if (logged.length) {
      const date = new Date(row.expires_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Accra' });
      await sendSms(row.phone_e164, 'expiry_reminder',
        `${biz}: your ${row.plan_name} plan expires on ${date}. Renew now from your account page so you stay online. Reply HELP for support.`);
      t2dSent++;
    }
  }

  const today = await sql<{ id: string; phone_e164: string; plan_name: string; expires_at: Date }[]>`
    select s.id, c.phone_e164, p.name as plan_name, s.expires_at
      from public.subscriptions s
      join public.customers c on c.id = s.customer_id
      join public.plans p on p.id = s.plan_id
     where s.status = 'active' and s.expires_at is not null
       and s.expires_at > now() and (s.expires_at at time zone 'Africa/Accra')::date = (now() at time zone 'Africa/Accra')::date`;

  let todaySent = 0;
  for (const row of today) {
    const logged = await sql`
      insert into public.reminder_log (subscription_id, kind)
      values (${row.id}, 'expiry_day')
      on conflict (subscription_id, kind) do nothing
      returning id`;
    if (logged.length) {
      await sendSms(row.phone_e164, 'expiry_reminder',
        `${biz}: your ${row.plan_name} plan expires TODAY. Renew from your account page to keep browsing without interruption.`);
      todaySent++;
    }
  }

  return json({ ok: true, t_minus_2d_sent: t2dSent, expiry_day_sent: todaySent });
}
