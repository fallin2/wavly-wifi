// Activation + redemption engine. Both paths funnel through one transaction that:
//   1) locks the payment/voucher row FOR UPDATE,
//   2) writes status transitions,
//   3) creates the entitlement exactly once (unique partial indexes enforce this even under races),
//   4) upserts hotspot credentials,
//   5) enqueues the router outbox op.
import { getDb } from './db';
import { ensureHotspotCredentials, enqueueHotspotUpsert, nextExpiryFor } from './hotspot';
import { sha256Hex } from './crypto';

export type ActivationResult =
  | { kind: 'activated'; subscriptionId: string }
  | { kind: 'already_activated'; subscriptionId: string | null }
  | { kind: 'payment_not_found' | 'payment_refunded' | 'amount_mismatch' | 'plan_missing' };

/** Idempotent: safe to call from webhook AND from the manual /payments/verify poller, any number of times. */
export async function activateFromPayment(
  providerReference: string,
  expectedAmountPesewas: number | null,  // pass Paystack's verified amount when available; null = skip check
  providerPayload: unknown,
): Promise<ActivationResult> {
  const sql = getDb();
  return await sql.begin(async (tx) => {
    const payments = await tx<{ id: string; customer_id: string; plan_id: string; status: string; amount_pesewas: number }[]>`
      select id, customer_id, plan_id, status, amount_pesewas
        from public.payments
       where provider_reference = ${providerReference}
       for update`;
    const payment = payments[0];
    if (!payment) return { kind: 'payment_not_found' };

    // Amount integrity: never trust the client NOR a webhook alone against underpayment.
    if (expectedAmountPesewas !== null && expectedAmountPesewas !== payment.amount_pesewas) {
      await tx`insert into public.payment_events (payment_id, event_type, signature_ok, payload)
               values (${payment.id}, 'amount_mismatch', true, ${tx.json(providerPayload as any)})`;
      return { kind: 'amount_mismatch' };
    }

    if (payment.status === 'success') {
      const existing = await tx`select id from public.subscriptions where payment_id = ${payment.id}`;
      return { kind: 'already_activated', subscriptionId: existing[0]?.id ?? null };
    }
    if (payment.status === 'refunded' || payment.status === 'partial_refund') {
      return { kind: 'payment_refunded' };
    }

    await tx`update public.payments
                set status = 'success', paid_at = now(), provider_payload = ${tx.json(providerPayload as any)}, updated_at = now()
              where id = ${payment.id}`;

    const plans = await tx<{ id: string; duration_hours: number | null; data_bytes: bigint | null; mikrotik_profile: string; max_devices: number }[]>`
      select id, duration_hours, data_bytes, mikrotik_profile, max_devices
        from public.plans where id = ${payment.plan_id}`;
    const plan = plans[0];
    if (!plan) return { kind: 'plan_missing' };

    const expiresAt = await nextExpiryFor(tx as any, payment.customer_id, plan.duration_hours);

    const inserted = await tx`
      insert into public.subscriptions
        (customer_id, plan_id, status, source, payment_id, expires_at, data_bytes_cap, device_limit)
      values
        (${payment.customer_id}, ${plan.id}, 'active', 'payment', ${payment.id}, ${expiresAt}, ${plan.data_bytes ?? null}, ${plan.max_devices})
      on conflict (payment_id) where payment_id is not null do nothing
      returning id`;

    if (inserted.length === 0) {
      const existing = await tx`select id from public.subscriptions where payment_id = ${payment.id}`;
      return { kind: 'already_activated', subscriptionId: existing[0]?.id ?? null };
    }

    await ensureHotspotCredentials(tx as any, payment.customer_id);
    await enqueueHotspotUpsert(tx as any, payment.customer_id, plan.mikrotik_profile, expiresAt);
    return { kind: 'activated', subscriptionId: inserted[0].id };
  });
}

export type VoucherRedeemResult =
  | { kind: 'redeemed'; subscriptionId: string; planName: string }
  | { kind: 'invalid' | 'expired_batch' | 'plan_missing' };

export function normalizeVoucherCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function voucherHash(code: string): string {
  return sha256Hex(normalizeVoucherCode(code));
}

export async function redeemVoucher(rawCode: string, customerId: string): Promise<VoucherRedeemResult> {
  const sql = getDb();
  const hash = voucherHash(rawCode);
  return await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; status: string; batch_expires: Date | null; plan_id: string }[]>`
      select v.id, v.status, b.expires_at as batch_expires, b.plan_id
        from public.vouchers v
        join public.voucher_batches b on b.id = v.batch_id
       where v.code_hash = ${hash}
       for update of v`;
    const v = rows[0];
    if (!v || v.status !== 'unused') return { kind: 'invalid' };
    if (v.batch_expires && new Date(v.batch_expires) < new Date()) return { kind: 'expired_batch' };

    await tx`update public.vouchers
                set status = 'redeemed', redeemed_by = ${customerId}, redeemed_at = now()
              where id = ${v.id}`;

    const plans = await tx<{ id: string; name: string; duration_hours: number | null; data_bytes: bigint | null; mikrotik_profile: string; max_devices: number }[]>`
      select id, name, duration_hours, data_bytes, mikrotik_profile, max_devices
        from public.plans where id = ${v.plan_id}`;
    const plan = plans[0];
    if (!plan) return { kind: 'plan_missing' };

    const expiresAt = await nextExpiryFor(tx as any, customerId, plan.duration_hours);

    const inserted = await tx`
      insert into public.subscriptions
        (customer_id, plan_id, status, source, voucher_id, expires_at, data_bytes_cap, device_limit)
      values
        (${customerId}, ${plan.id}, 'active', 'voucher', ${v.id}, ${expiresAt}, ${plan.data_bytes ?? null}, ${plan.max_devices})
      on conflict (voucher_id) where voucher_id is not null do nothing
      returning id`;

    await ensureHotspotCredentials(tx as any, customerId);
    await enqueueHotspotUpsert(tx as any, customerId, plan.mikrotik_profile, expiresAt);
    return { kind: 'redeemed', subscriptionId: inserted[0]?.id ?? '', planName: plan.name };
  });
}

export function formatGhsFromPesewas(pesewas: number): string {
  return (pesewas / 100).toFixed(2);
}
