import Link from 'next/link';
import { getDb } from '@/lib/db';
import { ghsFromPesewas } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  const sql = getDb();
  const daily = await sql`
    select day, payment_count, gross_pesewas, refunded_pesewas
      from public.v_revenue_daily
     where day > (now() at time zone 'Africa/Accra')::date - interval '30 days'
     order by day desc`;

  const maxGross = Math.max(1, ...daily.map((d: any) => Number(d.gross_pesewas) || 0));
  const totals = daily.reduce((acc: { gross: number; refunded: number; count: number }, d: any) => {
    acc.gross += Number(d.gross_pesewas) || 0;
    acc.refunded += Number(d.refunded_pesewas) || 0;
    acc.count += Number(d.payment_count) || 0;
    return acc;
  }, { gross: 0, refunded: 0, count: 0 });

  const byChannel = await sql`
    select channel, count(*)::int as n, coalesce(sum(amount_pesewas - refunded_amount_pesewas), 0)::bigint as net
      from public.payments
     where status in ('success','partial_refund','refunded') and created_at > now() - interval '30 days'
     group by channel`;

  const byPlan = await sql`
    select pl.name as plan_name, count(*)::int as n, coalesce(sum(p.amount_pesewas - p.refunded_amount_pesewas), 0)::bigint as net
      from public.payments p join public.plans pl on pl.id = p.plan_id
     where p.status in ('success','partial_refund','refunded') and p.created_at > now() - interval '30 days'
     group by pl.name order by net desc`;

  return (
    <>
      <h1 className="admin-h1">Reports</h1>
      <p className="admin-sub">Last 30 days, Africa/Accra. Amounts net of refunds.</p>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">Gross (30d)</div><div className="value">{ghsFromPesewas(totals.gross)}</div><div className="sub">{totals.count} payments</div></div>
        <div className="kpi"><div className="label">Refunded (30d)</div><div className="value">{ghsFromPesewas(totals.refunded)}</div><div className="sub">all channels</div></div>
        <div className="kpi"><div className="label">Net (30d)</div><div className="value">{ghsFromPesewas(totals.gross - totals.refunded)}</div><div className="sub">what keeps the lights on</div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '4px 0 16px', flexWrap: 'wrap' }}>
        <a className="btn btn-navy" href="/api/admin/reports/export?kind=revenue_daily">Revenue CSV (daily)</a>
        <a className="btn btn-ghost" href="/api/admin/reports/export?kind=payments">Payments CSV</a>
        <a className="btn btn-ghost" href="/api/admin/reports/export?kind=customers">Customers CSV</a>
        <a className="btn btn-ghost" href="/api/admin/reports/export?kind=vouchers">Vouchers CSV</a>
      </div>

      <h2 style={{ fontSize: '1rem', margin: '16px 0 8px' }}>Daily revenue</h2>
      <table className="data">
        <thead><tr><th>Day</th><th>Payments</th><th>Gross</th><th>Refunded</th><th style={{ width: '30%' }}></th></tr></thead>
        <tbody>
          {daily.map((d: any) => (
            <tr key={String(d.day)}>
              <td>{new Date(d.day).toLocaleDateString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short' })}</td>
              <td>{d.payment_count}</td>
              <td>{ghsFromPesewas(Number(d.gross_pesewas))}</td>
              <td>{ghsFromPesewas(Number(d.refunded_pesewas))}</td>
              <td><div className="hbar"><div style={{ width: `${Math.round((Number(d.gross_pesewas) / maxGross) * 100)}%` }} /></div></td>
            </tr>
          ))}
          {daily.length === 0 && <tr><td colSpan={5} className="hint">No revenue yet in this window.</td></tr>}
        </tbody>
      </table>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14, marginTop: 18 }}>
        <div className="card" style={{ margin: 0 }}>
          <h2 style={{ fontSize: '0.95rem', margin: '0 0 8px' }}>By channel (30d)</h2>
          {byChannel.length === 0 ? <p className="hint">Nothing yet.</p> : (
            <table className="data">
              <thead><tr><th>Channel</th><th>Payments</th><th style={{ textAlign: 'right' }}>Net</th></tr></thead>
              <tbody>{byChannel.map((r: any) => <tr key={r.channel}><td>{r.channel === 'mobile_money' ? 'MoMo' : r.channel}</td><td>{r.n}</td><td style={{ textAlign: 'right' }}>{ghsFromPesewas(Number(r.net))}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="card" style={{ margin: 0 }}>
          <h2 style={{ fontSize: '0.95rem', margin: '0 0 8px' }}>By plan (30d)</h2>
          {byPlan.length === 0 ? <p className="hint">Nothing yet.</p> : (
            <table className="data">
              <thead><tr><th>Plan</th><th>Payments</th><th style={{ textAlign: 'right' }}>Net</th></tr></thead>
              <tbody>{byPlan.map((r: any) => <tr key={r.plan_name}><td>{r.plan_name}</td><td>{r.n}</td><td style={{ textAlign: 'right' }}>{ghsFromPesewas(Number(r.net))}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>Need raw data for accounting? <Link href="/api/admin/reports/export?kind=payments">Download payments CSV →</Link></p>
    </>
  );
}
