import { getDb } from '@/lib/db';
import { getCustomerSession } from '@/lib/sessions';
import { verifyTransaction } from '@/lib/paystack';
import { activateFromPayment } from '@/lib/billing';
import { json, errorJson } from '@/lib/http';

export const runtime = 'nodejs';

/** Client-side fallback: polls our server, which polls Paystack — pays out exactly the same idempotent activation. */
export async function GET(req: Request) {
  const session = await getCustomerSession(req);
  if (!session) return errorJson('unauthorized', 'Not signed in.', 401);

  const reference = new URL(req.url).searchParams.get('reference');
  if (!reference || !/^wavly-[a-f0-9]{32}$/.test(reference)) {
    return errorJson('bad_request', 'Missing or malformed reference.', 400);
  }

  const sql = getDb();
  const rows = await sql<{ status: string; plan_id: string }[]>`
    select status, plan_id from public.payments
     where provider_reference = ${reference} and customer_id = ${session.customerId}`;
  const payment = rows[0];
  if (!payment) return errorJson('not_found', 'Payment not found.', 404);
  if (payment.status === 'success') return json({ reference, status: 'success' });

  const remote = await verifyTransaction(reference);
  await sql`insert into public.payment_events (payment_id, event_type, signature_ok, payload)
            select id, 'verify.poll', null, ${sql.json(remote.raw ?? {})} from public.payments where provider_reference = ${reference}`.catch(() => {});

  if (remote.ok && remote.providerStatus === 'success') {
    const result = await activateFromPayment(reference, remote.amountPesewas, remote.raw);
    return json({ reference, status: 'success', activation: result.kind });
  }
  if (remote.ok && (remote.providerStatus === 'failed' || remote.providerStatus === 'abandoned')) {
    await sql`update public.payments set status = ${remote.providerStatus}, failure_reason = ${'provider: ' + remote.providerStatus}, updated_at = now()
               where provider_reference = ${reference} and status = 'pending'`;
    return json({ reference, status: remote.providerStatus });
  }
  return json({ reference, status: 'pending', provider_status: remote.providerStatus ?? 'unknown' });
}
