import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { refundTransaction } from '@/lib/paystack';
import { enqueueKickAndDisable } from '@/lib/hotspot';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({
  payment_id: z.string().uuid(),
  amount_pesewas: z.number().int().min(1).optional(),
  reason: z.string().min(3).max(300),
});

/**
 * Refund flow (airtight against concurrent requests):
 *  1. Tx A: lock the payment row, validate, insert a PENDING refund row and reserve the amount
 *     (bump payments.refunded_amount_pesewas, flip status). Concurrent refunds serialize on the lock.
 *  2. Call Paystack (no DB transaction held across the network call).
 *  3. Tx B: mark the refund row success + provider id, suspend the entitlement on full refund;
 *     on Paystack failure, roll the reservation back exactly and mark the refund row failed.
 */
export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);
  if (!['owner', 'admin'].includes(admin.role)) return errorJson('forbidden', 'Insufficient role.', 403);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'payment_id and reason (min 3 chars) required.', 400);
  const { payment_id, reason } = parsed.data;

  const sql = getDb();

  // ── Phase 1: validate + reserve ────────────────────────────────────────────
  const reservation = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; provider_reference: string; status: string; amount_pesewas: number; refunded_amount_pesewas: number; customer_id: string }[]>`
      select id, provider_reference, status, amount_pesewas, refunded_amount_pesewas, customer_id
        from public.payments where id = ${payment_id} for update`;
    const payment = rows[0];
    if (!payment) return { error: errorJson('not_found', 'Payment not found.', 404) } as const;
    if (payment.status !== 'success' && payment.status !== 'partial_refund') {
      return { error: errorJson('not_refundable', `Only successful payments can be refunded (this one is ${payment.status}).`, 400) } as const;
    }
    const remaining = payment.amount_pesewas - payment.refunded_amount_pesewas;
    const amount = parsed.data.amount_pesewas ?? remaining;
    if (amount > remaining) {
      return { error: errorJson('bad_amount', `Refund exceeds the refundable balance (${remaining} pesewas).`, 400) } as const;
    }

    const newTotal = payment.refunded_amount_pesewas + amount;
    const fully = newTotal >= payment.amount_pesewas;
    const refundRows = await tx<{ id: string }[]>`
      insert into public.refunds (payment_id, amount_pesewas, reason, status, created_by)
      values (${payment.id}, ${amount}, ${reason}, 'pending', ${admin.adminId})
      returning id`;
    await tx`update public.payments
                set refunded_amount_pesewas = ${newTotal},
                    status = ${fully ? 'refunded' : 'partial_refund'},
                    updated_at = now()
              where id = ${payment.id}`;
    return {
      error: null,
      refundId: refundRows[0].id,
      payment,
      amount,
      fully,
      prevStatus: payment.status,
      prevRefunded: payment.refunded_amount_pesewas,
    } as const;
  });

  if (reservation.error) return reservation.error;
  const { refundId, payment, amount, fully } = reservation;

  // ── Phase 2: Paystack ─────────────────────────────────────────────────────
  const result = await refundTransaction(payment.provider_reference, amount);

  // ── Phase 3: finalize or roll back ────────────────────────────────────────
  if (result.ok) {
    await sql.begin(async (tx) => {
      await tx`update public.refunds
                  set status = 'success', provider_refund_id = ${result.refundId}, updated_at = now()
                where id = ${refundId}`;
      if (fully) {
        await tx`update public.subscriptions set status = 'suspended', updated_at = now()
                  where payment_id = ${payment.id} and status = 'active'`;
      }
      await tx`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id, after_data)
               values ('admin', ${admin.adminId}, 'payment.refund', 'payments', ${payment.id},
                       ${tx.json({ amount_pesewas: amount, fully_refunded: fully, provider_refund_id: result.refundId, reason } as any)})`;
    });
    // Full refund ⇒ cut hotspot access now (outside the tx; outbox is retried by the router sync)
    if (fully) {
      const creds = await sql<{ username: string }[]>`select username from public.hotspot_credentials where customer_id = ${payment.customer_id}`;
      if (creds.length) await enqueueKickAndDisable(sql, creds[0].username);
    }
    return json({ ok: true, refunded_pesewas: amount, status: fully ? 'refunded' : 'partial_refund' });
  }

  // Paystack failed → exact rollback of the reservation
  await sql.begin(async (tx) => {
    await tx`update public.refunds
                set status = 'failed', provider_refund_id = ${result.refundId}, updated_at = now()
              where id = ${refundId}`;
    await tx`update public.payments
                set refunded_amount_pesewas = ${reservation.prevRefunded},
                    status = ${reservation.prevStatus},
                    updated_at = now()
              where id = ${payment.id}`;
    await tx`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id, after_data)
             values ('admin', ${admin.adminId}, 'payment.refund_failed', 'payments', ${payment.id},
                     ${tx.json({ amount_pesewas: amount, reason, paystack_message: result.message } as any)})`;
  });
  return errorJson('refund_failed', result.message ?? 'Paystack refund failed — your ledger was rolled back.', 502);
}
