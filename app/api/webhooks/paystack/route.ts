import { getDb } from '@/lib/db';
import { verifyWebhookSignature, parseWebhookEvent } from '@/lib/paystack';
import { activateFromPayment } from '@/lib/billing';
import { json, errorJson } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * Paystack webhook. Security model:
 *  1) HMAC-SHA512 of the RAW body with the secret key — constant-time compare.
 *  2) Idempotent activation — replays are harmless by construction.
 *  3) Amount is re-checked against our own payment row inside the activation transaction.
 *  4) Always 200 after signature verification (Paystack retries non-200); 401 before it.
 */
export async function POST(req: Request) {
  const rawBody = await req.text(); // raw bytes for HMAC — never req.json() here
  const signature = req.headers.get('x-paystack-signature');

  if (!verifyWebhookSignature(rawBody, signature)) {
    const sql = getDb();
    await sql`insert into public.payment_events (payment_id, event_type, signature_ok, payload)
              values (null, 'signature_mismatch', false, ${sql.json({ snippet: rawBody.slice(0, 500) } as any)})`.catch(() => {});
    return errorJson('invalid_signature', 'Signature mismatch.', 401);
  }

  const event = parseWebhookEvent(rawBody);
  if (!event) {
    return json({ ok: true, ignored: 'unparseable' });
  }

  const sql = getDb();
  const paymentRow = event.reference
    ? await sql<{ id: string }[]>`select id from public.payments where provider_reference = ${event.reference}`
    : [];
  const paymentId = paymentRow[0]?.id ?? null;

  // Log every signed event for dispute resolution.
  await sql`insert into public.payment_events (payment_id, event_type, signature_ok, payload)
            values (${paymentId}, ${'webhook.' + event.event}, true, ${sql.json(event.raw as any)})`.catch(() => {});

  switch (event.event) {
    case 'charge.success': {
      if (!event.reference) return json({ ok: true, ignored: 'no_reference' });
      const result = await activateFromPayment(event.reference, event.amountPesewas, event.raw);
      if (result.kind === 'amount_mismatch') {
        console.error(`[webhook] AMOUNT MISMATCH on ${event.reference}`);
        return json({ ok: true, flagged: 'amount_mismatch' });
      }
      return json({ ok: true, result: result.kind });
    }
    case 'charge.failed': {
      if (event.reference) {
        await sql`update public.payments
                     set status = 'failed', failure_reason = ${'provider reported failure'}, updated_at = now()
                   where provider_reference = ${event.reference} and status = 'pending'`;
      }
      return json({ ok: true });
    }
    default:
      // Other events (transfer.*, invoice.*) — acknowledged, ignored.
      return json({ ok: true, ignored: event.event });
  }
}
