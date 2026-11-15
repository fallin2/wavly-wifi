import { getDb } from '@/lib/db';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = getDb();
  const plans = await sql`
    select id, name, slug, description, price_pesewas, currency, duration_hours, data_bytes,
           rate_limit_down_kbps, rate_limit_up_kbps, max_devices, featured
      from public.plans
     where active = true
     order by sort_order asc, price_pesewas asc`;
  return json({ plans });
}
