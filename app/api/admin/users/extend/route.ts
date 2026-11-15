import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { enqueueHotspotUpsert } from '@/lib/hotspot';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({
  customer_id: z.string().uuid(),
  hours: z.number().int().min(1).max(24 * 365),
});

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);
  if (!['owner', 'admin'].includes(admin.role)) return errorJson('forbidden', 'Insufficient role.', 403);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'customer_id and hours (1..8760) required.', 400);
  const { customer_id, hours } = parsed.data;

  const sql = getDb();
  // Extend the current active subscription in place.
  const rows = await sql<{ id: string; new_expiry: string }[]>`
    update public.subscriptions
       set expires_at = coalesce(expires_at, now()) + make_interval(hours => ${hours}), updated_at = now()
     where id = (
       select id from public.subscriptions
        where customer_id = ${customer_id} and status = 'active'
        order by (expires_at is null), expires_at desc nulls last, created_at desc
        limit 1
     )
     returning id, expires_at::text as new_expiry`;
  if (!rows.length) return errorJson('no_active_subscription', 'No active subscription to extend.', 400);

  const sub = await sql<{ mikrotik_profile: string }[]>`
    select p.mikrotik_profile from public.subscriptions s join public.plans p on p.id = s.plan_id where s.id = ${rows[0].id}`;
  await enqueueHotspotUpsert(sql, customer_id, sub[0]?.mikrotik_profile ?? 'wavly-default', null);

  await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id, after_data)
            values ('admin', ${admin.adminId}, 'subscription.extend', 'subscriptions', ${rows[0].id},
                    ${sql.json({ added_hours: hours, new_expiry: rows[0].new_expiry } as any)})`;
  return json({ ok: true, new_expiry: rows[0].new_expiry });
}
