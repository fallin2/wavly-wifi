import Link from 'next/link';
import { getDb } from '@/lib/db';
import { ghsFromPesewas, formatDateGhana } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface KpiRow {
  active_subs: number;
  new_customers_30d: number;
  rev_today: number;
  rev_30d: number;
  payments_today: number;
  expiring_48h: number;
  open_outbox: number;
  failed_payments_7d: number;
}

export default async function AdminOverview() {
  const sql = getDb();
  const [kpi] = await sql<KpiRow[]>`
    select
      (select count(*)::int from public.subscriptions where status = 'active' and (expires_at is null or expires_at > now())) as active_subs,
      (select count(*)::int from public.customers where created_at > now() - interval '30 days' and deleted_at is null) as new_customers_30d,
      (select coalesce(sum(amount_pesewas - refunded_amount_pesewas), 0)::bigint from public.payments
        where status in ('success','partial_refund','refunded') and (paid_at at time zone 'Africa/Accra')::date = (now() at time zone 'Africa/Accra')::date) as rev_today,
      (select coalesce(sum(amount_pesewas - refunded_amount_pesewas), 0)::bigint from public.payments
        where status in ('success','partial_refund','refunded') and paid_at > now() - interval '30 days') as rev_30d,
      (select count(*)::int from public.payments where status = 'success' and (paid_at at time zone 'Africa/Accra')::date = (now() at time zone 'Africa/Accra')::date) as payments_today,
      (select count(*)::int from public.v_expiring_subscriptions) as expiring_48h,
      (select count(*)::int from public.hotspot_outbox where processed_at is null) as open_outbox,
      (select count(*)::int from public.payments where status = 'failed' and created_at > now() - interval '7 days') as failed_payments_7d`;

  const expiring = await sql`select * from public.v_expiring_subscriptions order by expires_at asc limit 12`;
  const recentPayments = await sql`
    select p.id, p.amount_pesewas, p.channel, p.status, p.paid_at, c.phone_e164, c.display_name
      from public.payments p join public.customers c on c.id = p.customer_id
     order by p.created_at desc limit 8`;

  return (
    <>
      <h1 className="admin-h1">Overview</h1>
      <p className="admin-sub">Live figures, Africa/Accra timezone. Money numbers net of refunds.</p>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">Active plans</div><div className="value">{kpi.active_subs}</div><div className="sub">usable right now</div></div>
        <div className="kpi"><div className="label">Revenue today</div><div className="value">{ghsFromPesewas(Number(kpi.rev_today))}</div><div className="sub">{kpi.payments_today} payments</div></div>
        <div className="kpi"><div className="label">Revenue 30d</div><div className="value">{ghsFromPesewas(Number(kpi.rev_30d))}</div><div className="sub">net of refunds</div></div>
        <div className="kpi"><div className="label">New customers 30d</div><div className="value">{kpi.new_customers_30d}</div><div className="sub">signups</div></div>
        <div className="kpi"><div className="label">Expiring ≤ 48h</div><div className="value" style={{ color: kpi.expiring_48h > 0 ? '#b45309' : undefined }}>{kpi.expiring_48h}</div><div className="sub"><Link href="/admin/users?filter=expiring">see list →</Link></div></div>
        <div className="kpi"><div className="label">Failed payments 7d</div><div className="value">{kpi.failed_payments_7d}</div><div className="sub">worth a support look</div></div>
        <div className="kpi"><div className="label">Router outbox</div><div className="value" style={{ color: kpi.open_outbox > 50 ? 'var(--bad)' : undefined }}>{kpi.open_outbox}</div><div className="sub">pending pushes to MikroTik</div></div>
      </div>

      <h2 style={{ fontSize: '1rem', margin: '18px 0 8px' }}>Expiring in the next 48 hours</h2>
      {expiring.length === 0 ? <p className="hint">Nobody expiring soon. 🎉</p> : (
        <table className="data">
          <thead><tr><th>Customer</th><th>Plan</th><th>Expires</th><th>Hours left</th></tr></thead>
          <tbody>
            {expiring.map((r: any) => (
              <tr key={r.id}>
                <td><b>{r.display_name ?? r.phone_e164}</b><br /><span className="hint" style={{ margin: 0 }}>{r.phone_e164}</span></td>
                <td>{r.plan_name}</td>
                <td>{formatDateGhana(r.expires_at)}</td>
                <td>{r.hours_left}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: '1rem', margin: '22px 0 8px' }}>Latest payments</h2>
      <table className="data">
        <thead><tr><th>When</th><th>Customer</th><th>Channel</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {recentPayments.map((p: any) => (
            <tr key={p.id}>
              <td>{p.paid_at ? formatDateGhana(p.paid_at) : '—'}</td>
              <td>{p.display_name ?? p.phone_e164}</td>
              <td>{p.channel === 'mobile_money' ? 'MoMo' : p.channel}</td>
              <td><span className={`pill ${p.status === 'success' ? 'pill-ok' : p.status === 'pending' ? 'pill-warn' : 'pill-bad'}`}>{p.status}</span></td>
              <td style={{ textAlign: 'right' }}>{ghsFromPesewas(p.amount_pesewas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 18 }}><Link href="/admin/payments">All payments & refunds →</Link></p>
    </>
  );
}
