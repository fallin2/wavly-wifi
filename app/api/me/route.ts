import { getDb } from '@/lib/db';
import { getCustomerSession } from '@/lib/sessions';
import { json, errorJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getCustomerSession(req);
  if (!session) return errorJson('unauthorized', 'Not signed in.', 401);

  const sql = getDb();
  const subs = await sql`
    select s.id, s.status, s.started_at, s.expires_at, s.data_bytes_cap, s.data_bytes_used, s.device_limit, s.source,
           p.name as plan_name, p.slug as plan_slug, p.mikrotik_profile, p.rate_limit_down_kbps, p.rate_limit_up_kbps
      from public.subscriptions s
      join public.plans p on p.id = s.plan_id
     where s.customer_id = ${session.customerId}
     order by s.created_at desc
     limit 10`;
  const creds = await sql`select username from public.hotspot_credentials where customer_id = ${session.customerId}`;

  return json({
    customer: { phone: session.phoneE164, name: session.displayName },
    username: creds[0]?.username ?? null,
    subscriptions: subs,
  });
}
