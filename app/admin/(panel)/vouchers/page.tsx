import { getDb } from '@/lib/db';
import { ghsFromPesewas, formatDateGhana } from '@/lib/format';
import VoucherCreator from './VoucherCreator';
import VoucherDisable from './VoucherDisable';

export const dynamic = 'force-dynamic';

export default async function AdminVouchersPage() {
  const sql = getDb();
  const plans = await sql<{ id: string; name: string; price_pesewas: number }[]>`
    select id, name, price_pesewas from public.plans where active = true order by sort_order asc`;
  const vouchers = await sql`
    select v.id, v.code_last4, v.status, v.redeemed_at, v.created_at,
           b.name as batch_name, p.name as plan_name, p.slug as plan_slug,
           r.phone_e164 as redeemed_by_phone
      from public.vouchers v
      join public.voucher_batches b on b.id = v.batch_id
      join public.plans p on p.id = b.plan_id
      left join public.customers r on r.id = v.redeemed_by
     order by v.created_at desc
     limit 60`;

  return (
    <>
      <h1 className="admin-h1">Vouchers</h1>
      <p className="admin-sub">Printable codes for agents and campus kiosks. Only code hashes are stored.</p>
      <VoucherCreator plans={plans} />

      <h2 style={{ fontSize: '1rem', margin: '20px 0 6px' }}>Latest vouchers</h2>
      <table className="data">
        <thead><tr><th>Code</th><th>Batch</th><th>Plan</th><th>Status</th><th>Redeemed by</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {vouchers.map((v: any) => (
            <tr key={v.id}>
              <td style={{ fontFamily: 'monospace' }}>••••-{v.code_last4}</td>
              <td>{v.batch_name}</td>
              <td>{v.plan_name}</td>
              <td><span className={`pill ${v.status === 'unused' ? 'pill-ok' : v.status === 'redeemed' ? 'pill-mut' : 'pill-bad'}`}>{v.status}</span></td>
              <td>{v.redeemed_by_phone ?? '—'}</td>
              <td>{formatDateGhana(v.created_at)}</td>
              <td>{v.status === 'unused' && <VoucherDisable id={v.id} />}</td>
            </tr>
          ))}
          {vouchers.length === 0 && <tr><td colSpan={7} className="hint">No vouchers yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
