import Link from 'next/link';
import { getDb } from '@/lib/db';
import { formatDateGhana, timeLeft, ghsFromPesewas } from '@/lib/format';
import UserActions from './UserActions';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const filter = sp.filter ?? 'all';

  const sql = getDb();
  const rows = await sql`
    select c.id, c.phone_e164, c.display_name, c.account_status, c.created_at,
           (select count(*) from public.subscriptions s where s.customer_id = c.id and s.status = 'active' and (s.expires_at is null or s.expires_at > now()))::int as active_subs,
           (select p.name from public.subscriptions s2 join public.plans p on p.id = s2.plan_id
             where s2.customer_id = c.id and s2.status = 'active'
             order by s2.expires_at desc nulls last limit 1) as active_plan,
           (select s3.expires_at from public.subscriptions s3
             where s3.customer_id = c.id and s3.status = 'active'
             order by s3.expires_at desc nulls last limit 1) as active_expiry,
           (select coalesce(sum(p2.amount_pesewas - p2.refunded_amount_pesewas), 0)::bigint
              from public.payments p2 where p2.customer_id = c.id and p2.status in ('success','partial_refund','refunded')) as lifetime_pesewas
      from public.customers c
     where c.deleted_at is null
       and (${q} = '' or c.phone_e164 ilike ${'%' + q + '%'} or coalesce(c.display_name, '') ilike ${'%' + q + '%'})
       and (
         ${filter} = 'all'
         or (${filter} = 'suspended' and c.account_status <> 'active')
         or (${filter} = 'expiring' and exists (
              select 1 from public.subscriptions s4
               where s4.customer_id = c.id and s4.status = 'active'
                 and s4.expires_at is not null and s4.expires_at > now() and s4.expires_at < now() + interval '48 hours'))
       )
     order by c.created_at desc
     limit 100`;

  const exportHref = `/api/admin/reports/export?kind=customers${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <>
      <h1 className="admin-h1">Customers</h1>
      <p className="admin-sub">Newest first, capped at 100. Search by phone or name.</p>

      <form method="get" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input name="q" defaultValue={q} placeholder="Search phone or name…" style={{ flex: 1, minWidth: 180, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, fontSize: '0.95rem' }} />
        <select name="filter" defaultValue={filter} style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, fontSize: '0.95rem' }}>
          <option value="all">All</option>
          <option value="expiring">Expiring ≤ 48h</option>
          <option value="suspended">Suspended / banned</option>
        </select>
        <button className="btn btn-navy" type="submit">Search</button>
        <a className="btn btn-ghost" href={exportHref}>Export CSV</a>
      </form>

      <table className="data">
        <thead><tr><th>Customer</th><th>Status</th><th>Active plan</th><th>Lifetime paid</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id}>
              <td>
                <b>{r.display_name ?? '—'}</b><br />
                <span className="hint" style={{ margin: 0 }}>{r.phone_e164}</span><br />
                <span className="hint" style={{ margin: 0 }}>joined {formatDateShortGhanaLocal(r.created_at)}</span>
              </td>
              <td><span className={`pill ${r.account_status === 'active' ? 'pill-ok' : 'pill-bad'}`}>{r.account_status}</span></td>
              <td>
                {r.active_subs > 0 ? (
                  <>{r.active_plan}<br /><span className="hint" style={{ margin: 0 }}>{timeLeft(r.active_expiry)}</span></>
                ) : <span className="hint" style={{ margin: 0 }}>none</span>}
              </td>
              <td>{ghsFromPesewas(Number(r.lifetime_pesewas))}</td>
              <td><UserActions customerId={r.id} accountStatus={r.account_status} hasActiveSub={r.active_subs > 0} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="hint">No customers match.</td></tr>}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 10 }}>Support tool: extend grants time, it never moves money. Refunds live under <Link href="/admin/payments">Payments</Link>.</p>
    </>
  );
}

function formatDateShortGhanaLocal(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric' });
}
