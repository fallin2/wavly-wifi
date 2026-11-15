import Link from 'next/link';
import { getDb } from '@/lib/db';
import { ghsFromPesewas, formatDateGhana } from '@/lib/format';
import RefundButton from './RefundButton';

export const dynamic = 'force-dynamic';

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status ?? 'all';

  const sql = getDb();
  const rows = await sql`
    select p.id, p.amount_pesewas, p.refunded_amount_pesewas, p.channel, p.status, p.provider_reference,
           p.momo_provider, p.paid_at, p.created_at, p.failure_reason,
           c.phone_e164, c.display_name, pl.name as plan_name
      from public.payments p
      join public.customers c on c.id = p.customer_id
      join public.plans pl on pl.id = p.plan_id
     where (${status} = 'all' or p.status = ${status})
     order by p.created_at desc
     limit 100`;

  const exportHref = `/api/admin/reports/export?kind=payments${status !== 'all' ? `&status=${encodeURIComponent(status)}` : ''}`;

  return (
    <>
      <h1 className="admin-h1">Payments & refunds</h1>
      <p className="admin-sub">Success is written only from verified webhook/server-side checks. Newest first, capped at 100.</p>

      <form method="get" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select name="status" defaultValue={status} style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, fontSize: '0.95rem' }}>
          {['all', 'success', 'pending', 'failed', 'abandoned', 'partial_refund', 'refunded'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn btn-navy" type="submit">Filter</button>
        <a className="btn btn-ghost" href={exportHref}>Export CSV</a>
      </form>

      <table className="data">
        <thead><tr><th>When</th><th>Customer</th><th>Plan</th><th>Channel</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th>Action</th></tr></thead>
        <tbody>
          {rows.map((p: any) => {
            const remaining = p.amount_pesewas - p.refunded_amount_pesewas;
            return (
              <tr key={p.id}>
                <td>{p.paid_at ? formatDateGhana(p.paid_at) : formatDateGhana(p.created_at)}<br /><span className="hint" style={{ margin: 0 }}>{p.provider_reference}</span></td>
                <td>{p.display_name ?? '—'}<br /><span className="hint" style={{ margin: 0 }}>{p.phone_e164}</span></td>
                <td>{p.plan_name}</td>
                <td>{p.channel === 'mobile_money' ? `MoMo (${p.momo_provider ?? '?'})` : 'Card'}</td>
                <td>
                  <span className={`pill ${p.status === 'success' ? 'pill-ok' : p.status === 'pending' ? 'pill-warn' : p.status === 'failed' || p.status === 'abandoned' ? 'pill-bad' : 'pill-mut'}`}>{p.status}</span>
                  {p.failure_reason && <div className="hint" style={{ margin: 0 }}>{p.failure_reason}</div>}
                  {p.refunded_amount_pesewas > 0 && <div className="hint" style={{ margin: 0 }}>refunded: {ghsFromPesewas(p.refunded_amount_pesewas)}</div>}
                </td>
                <td style={{ textAlign: 'right' }}>{ghsFromPesewas(p.amount_pesewas)}</td>
                <td><RefundButton paymentId={p.id} remainingPesewas={remaining} status={p.status} /></td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={7} className="hint">No payments match.</td></tr>}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 10 }}>Refunds call Paystack first, then our ledger — a failed Paystack call changes nothing. Full refunds suspend the entitlement. <Link href="/admin/reports">See revenue reports →</Link></p>
    </>
  );
}
