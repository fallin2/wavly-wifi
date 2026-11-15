import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { enqueueKickAndDisable, enqueueHotspotUpsert } from '@/lib/hotspot';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({
  customer_id: z.string().uuid(),
  status: z.enum(['active', 'suspended', 'banned']),
});

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);
  if (!['owner', 'admin'].includes(admin.role)) return errorJson('forbidden', 'Insufficient role.', 403);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'customer_id and status required.', 400);
  const { customer_id, status } = parsed.data;

  const sql = getDb();
  const before = await sql<{ account_status: string }[]>`select account_status from public.customers where id = ${customer_id}`;
  if (!before.length) return errorJson('not_found', 'Customer not found.', 404);

  await sql`update public.customers
               set account_status = ${status}, updated_at = now()
             where id = ${customer_id}`;

  const creds = await sql<{ username: string }[]>`select username from public.hotspot_credentials where customer_id = ${customer_id}`;
  const username = creds[0]?.username;
  if (username) {
    if (status === 'active') {
      const sub = await sql<{ mikrotik_profile: string }[]>`
        select p.mikrotik_profile from public.subscriptions s join public.plans p on p.id = s.plan_id
         where s.customer_id = ${customer_id} and s.status = 'active' order by s.created_at desc limit 1`;
      if (sub.length) await enqueueHotspotUpsert(sql, customer_id, sub[0].mikrotik_profile, null);
    } else {
      await enqueueKickAndDisable(sql, username);
    }
  }

  await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id, before_data, after_data)
            values ('admin', ${admin.adminId}, 'customer.set_status', 'customers', ${customer_id},
                    ${sql.json({ account_status: before[0].account_status } as any)},
                    ${sql.json({ account_status: status } as any)})`;
  return json({ ok: true });
}
