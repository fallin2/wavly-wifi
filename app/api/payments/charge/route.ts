import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getCustomerSession } from '@/lib/sessions';
import { chargeMobileMoney, initializeCardTransaction, type MomoProvider } from '@/lib/paystack';
import { json, errorJson, readClientIp, assertSameOrigin } from '@/lib/http';
import { randomHex } from '@/lib/crypto';
import { checkRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const Body = z.object({
  plan_id: z.string().uuid(),
  channel: z.enum(['mobile_money', 'card']).default('mobile_money'),
  momo_provider: z.enum(['mtn', 'vod', 'atl']).optional(),
  momo_phone: z.string().max(24).optional(),
});

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const session = await getCustomerSession(req);
  if (!session) return errorJson('unauthorized', 'Not signed in.', 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'Invalid plan selection.', 400);
  const { plan_id, channel, momo_provider, momo_phone } = parsed.data;
  if (channel === 'mobile_money') {
    if (!momo_provider) return errorJson('bad_request', 'Choose a MoMo network (MTN, Telecel, AirtelTigo).', 400);
    if (!momo_phone) return errorJson('bad_request', 'Enter the MoMo phone number.', 400);
  }

  const ip = readClientIp(req);
  const rl = await checkRateLimit({ key: `pay:init:${session.customerId}`, windowSeconds: 3600, max: 15 });
  if (!rl.allowed) return errorJson('rate_limited', 'Too many attempts this hour. Try later.', 429);

  const sql = getDb();
  // Amount ALWAYS comes from the DB plan row — never from the client.
  const plans = await sql<{ id: string; name: string; price_pesewas: number; currency: string }[]>`
    select id, name, price_pesewas, currency from public.plans where id = ${plan_id} and active = true`;
  const plan = plans[0];
  if (!plan) return errorJson('plan_unavailable', 'That plan is no longer available.', 400);

  const reference = `wavly-${randomHex(16)}`;
  const momoNumber = momo_phone?.trim();
  const digits = momoNumber?.replace(/\D/g, '') ?? '';
  const localMomo = digits.startsWith('233') ? digits.slice(3) : digits.replace(/^0/, '');
  const email = `${(session.phoneE164.replace('+', ''))}@pay.wavly.local`; // Paystack requires an email

  await sql`insert into public.payments
      (customer_id, plan_id, amount_pesewas, currency, provider, provider_reference, channel, momo_provider, momo_phone, status)
    values
      (${session.customerId}, ${plan.id}, ${plan.price_pesewas}, ${plan.currency}, 'paystack', ${reference}, ${channel},
       ${channel === 'mobile_money' ? momo_provider! : null}, ${channel === 'mobile_money' ? `+233${localMomo}` : null}, 'pending')`;

  if (channel === 'mobile_money') {
    const result = await chargeMobileMoney({
      reference,
      email,
      amountPesewas: plan.price_pesewas,
      momoPhone: `0${localMomo}`,
      provider: momo_provider as MomoProvider,
    });
    if (!result.ok) {
      await sql`update public.payments
                  set status = 'failed', failure_reason = ${result.message ?? 'provider_error'}, provider_payload = ${sql.json(result.raw ?? {})}, updated_at = now()
                where provider_reference = ${reference}`;
      await sql`insert into public.payment_events (payment_id, event_type, signature_ok, payload)
                select id, 'charge_init_failed', null, ${sql.json(result.raw ?? {})} from public.payments where provider_reference = ${reference}`;
      return errorJson('charge_failed', result.message ?? 'The MoMo request was declined by the provider.', 402);
    }
    await sql`insert into public.payment_events (payment_id, event_type, signature_ok, payload)
              select id, 'charge_init', null, ${sql.json(result.raw ?? {})} from public.payments where provider_reference = ${reference}`;
    return json({ ok: true, reference, status: result.providerStatus ?? 'pay_offline', message: result.message ?? 'Approve the prompt on your phone to complete payment.' });
  }

  // Card fallback: hosted checkout redirect.
  const origin = new URL(req.url).origin;
  const init = await initializeCardTransaction({
    reference,
    email,
    amountPesewas: plan.price_pesewas,
    callbackUrl: `${origin}/pay/callback?reference=${reference}`,
  });
  if (!init.ok || !init.authorizationUrl) {
    await sql`update public.payments set status = 'failed', failure_reason = ${init.message ?? 'init_error'}, updated_at = now() where provider_reference = ${reference}`;
    return errorJson('charge_failed', 'Could not start card checkout.', 402);
  }
  return json({ ok: true, reference, status: 'redirect', authorization_url: init.authorizationUrl });
}
