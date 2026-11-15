import { getDb } from '@/lib/db';
import PlansClient, { type PlanRow } from './PlansClient';

export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  const sql = getDb();
  const plans = await sql<PlanRow[]>`
    select id, name, slug, description, price_pesewas, duration_hours, data_bytes::text as data_bytes,
           rate_limit_down_kbps, rate_limit_up_kbps, mikrotik_profile, max_devices, active, featured, sort_order
      from public.plans order by sort_order asc, price_pesewas asc`;
  // postgres returns bigint as string; normalise
  const normalized = plans.map((p) => ({ ...p, data_bytes: p.data_bytes == null ? null : Number(p.data_bytes) }));
  return (
    <>
      <h1 className="admin-h1">Plans</h1>
      <p className="admin-sub">What customers can buy. Disable instead of delete to keep history intact.</p>
      <PlansClient plans={normalized} />
    </>
  );
}
