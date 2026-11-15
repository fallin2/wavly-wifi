'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RefundButton({ paymentId, remainingPesewas, status }: { paymentId: string; remainingPesewas: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (status !== 'success' && status !== 'partial_refund') {
    return <span className="hint" style={{ margin: 0 }}>—</span>;
  }

  async function refund() {
    const input = prompt(
      `Refund this payment.\nRemaining refundable: GH¢${(remainingPesewas / 100).toFixed(2)}\n\nEnter amount in GHS (blank = full refund):`,
      '',
    );
    if (input === null) return; // cancelled
    const amountGhs = input.trim() === '' ? undefined : Number(input.trim());
    if (amountGhs !== undefined && (!Number.isFinite(amountGhs) || amountGhs <= 0)) { alert('Enter a positive number.'); return; }
    const reason = prompt('Reason for the refund (required, min 3 chars):', '');
    if (!reason || reason.trim().length < 3) { alert('A reason is required.'); return; }
    if (!confirm(`Refund ${amountGhs === undefined ? 'the full remaining amount' : `GH¢${amountGhs.toFixed(2)}`}? This calls Paystack and may suspend the plan.`)) return;

    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/payments/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId, amount_pesewas: amountGhs === undefined ? undefined : Math.round(amountGhs * 100), reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error?.message ?? 'Refund failed.'); }
      else { setMsg(`Refunded GH¢${(data.refunded_pesewas / 100).toFixed(2)}.`); router.refresh(); }
    } catch { setMsg('Network error.'); } finally { setBusy(false); }
  }

  return (
    <div>
      <button className="btn" disabled={busy || remainingPesewas <= 0}
              style={{ padding: '5px 12px', fontSize: '0.78rem', background: 'var(--bad)', color: '#fff', borderRadius: 8 }}
              onClick={refund}>{busy ? 'Refunding…' : 'Refund'}</button>
      {msg && <div className="hint" style={{ marginTop: 3, maxWidth: 220 }}>{msg}</div>}
    </div>
  );
}
