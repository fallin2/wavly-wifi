import { getDb } from '@/lib/db';
import { enqueueKickAndDisable } from '@/lib/hotspot';
import { sendSms } from '@/lib/sms';
import { json, errorJson } from '@/lib/http';
import { pruneRateLimits } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const alt = req.headers.get('x-cron-secret') ?? '';
  return bearer === secret || alt === secret;
}

/** Expires due subscriptions, kicks the sessions, sends the "your plan ended" SMS exactly once, tidies ephemeral tables. */
export async function GET(req: Request) {
  if (!authorized(req)) return errorJson('unauthorized', 'Bad cron secret.', 401);

  const sql = getDb();
  const expired = await sql<{ id: string; customer_id: string; username: string | null; phone_e164: string; plan_name: string }[]>`
    with due as (
      select s.id, s.customer_id
        from public.subscriptions s
       where s.status = 'active' and s.expires_at is not null and s.expires_at < now()
       limit 500
    )
    update public.subscriptions s
       set status = 'expired', updated_at = now()
      from due
      join public.customers c on c.id = due.customer_id
      join public.plans p on p.id = s.plan_id
     where s.id = due.id
    returning s.id, s.customer_id, c.phone_e164, p.name as plan_name,
              (select username from public.hotspot_credentials where customer_id = s.customer_id) as username`;

  let kicked = 0, smsSent = 0;
  for (const row of expired) {
    if (row.username) {
      await enqueueKickAndDisable(sql, row.username);
      kicked++;
    }
    // exactly-once "expired" SMS via reminder_log uniqueness
    const logged = await sql`
      insert into public.reminder_log (subscription_id, kind)
      values (${row.id}, 'expired_final')
      on conflict (subscription_id, kind) do nothing
      returning id`.catch(() => []);
    if (logged.length) {
      await sendSms(row.phone_e164, 'expired_notice',
        `Wavly WiFi: your ${row.plan_name} plan has ended. Renew in minutes from your account page or ask any WiFi attendant.`);
      smsSent++;
    }
  }

  // Stale pending payments (>24h): ask Paystack what actually happened. Verified success goes
  // through the SAME idempotent money path (activateFromPayment). Best-effort — never throws.
  const stale = await sql<{ provider_reference: string }[]>`
    select provider_reference from public.payments
     where status = 'pending' and created_at < now() - interval '24 hours'
     order by created_at asc limit 10`.catch(() => []);
  let staleVerified = 0, staleMarked = 0;
  if (stale.length) {
    const { verifyTransaction } = await import('@/lib/paystack');
    const { activateFromPayment } = await import('@/lib/billing');
    for (const p of stale) {
      try {
        const remote = await verifyTransaction(p.provider_reference);
        if (remote.ok && remote.providerStatus === 'success') {
          await activateFromPayment(p.provider_reference, remote.amountPesewas, remote.raw);
          staleVerified++;
        } else if (remote.ok && (remote.providerStatus === 'failed' || remote.providerStatus === 'abandoned')) {
          const updated = await sql`update public.payments set status = ${remote.providerStatus},
                     failure_reason = ${'provider: ' + remote.providerStatus + ' (cron reaper)'}, updated_at = now()
                   where provider_reference = ${p.provider_reference} and status = 'pending'`;
          staleMarked += updated.count ?? 0;
        }
      } catch { /* Paystack unreachable / no key — leave for the next run */ }
    }
  }

  // Hygiene: old OTPs, sessions, rate buckets, drained outbox rows.
  await sql`delete from public.otps where created_at < now() - interval '2 days'`.catch(() => {});
  await sql`delete from public.sessions where expires_at < now() - interval '2 days'`.catch(() => {});
  await sql`delete from public.hotspot_outbox where status = 'sent' and sent_at < now() - interval '7 days'`.catch(() => {});
  await pruneRateLimits(sql).catch(() => {});

  return json({ ok: true, expired: expired.length, kicked, sms_sent: smsSent, stale_payments_verified: staleVerified, stale_payments_marked: staleMarked });
}
