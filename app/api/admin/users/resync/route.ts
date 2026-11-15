import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { enqueueHotspotUpsert } from '@/lib/hotspot';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({ customer_id: z.string().uuid() });

/** Re-push the hotspot credentials for a customer's current active subscription (support "Re-sync" button). */
export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'customer_id required.', 400);
  const { customer_id } = parsed.data;

  const sql = getDb();
  const sub = await sql<{ mikrotik_profile: string }[]>`
    select p.mikrotik_profile from public.subscriptions s join public.plans p on p.id = s.plan_id
     where s.customer_id = ${customer_id} and s.status = 'active'
     order by s.created_at desc limit 1`;
  if (!sub.length) return errorJson('no_active_subscription', 'No active subscription to push.', 400);

  await enqueueHotspotUpsert(sql, customer_id, sub[0].mikrotik_profile, null);
  const creds = await sql<{ username: string }[]>`select username from public.hotspot_credentials where customer_id = ${customer_id}`;
  await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id)
            values ('admin', ${admin.adminId}, 'hotspot.resync', 'hotspot_credentials', ${customer_id})`;
  return json({ ok: true, username: creds[0]?.username ?? null });
}
