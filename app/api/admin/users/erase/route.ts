import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { enqueueKickAndDisable } from '@/lib/hotspot';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({ customer_id: z.string().uuid() });

/**
 * DPA erasure (Act 843) for a customer, owner/admin only:
 * ban + soft-delete + anonymise PII. Financial records (payments/subscriptions) are
 * retained as-is — standard lawful retention — but no longer joinable via PII.
 * Hotspot credentials are dropped after a router-side disable is enqueued.
 */
export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);
  if (!['owner', 'admin'].includes(admin.role)) return errorJson('forbidden', 'Insufficient role.', 403);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'customer_id required.', 400);

  const sql = getDb();
  const tombstoneDigits = () => String(Math.abs(Math.floor(Math.random() * 1e9))).padStart(9, '0');

  const before = await sql<{ phone_e164: string; deleted_at: Date | null }[]>`select phone_e164, deleted_at from public.customers where id = ${parsed.data.customer_id}`;
  if (!before.length) return errorJson('not_found', 'Customer not found.', 404);
  if (before[0].deleted_at) return errorJson('already_erased', 'Customer already erased.', 400);

  const creds = await sql<{ username: string }[]>`select username from public.hotspot_credentials where customer_id = ${parsed.data.customer_id}`;
  if (creds.length) await enqueueKickAndDisable(sql, creds[0].username);

  // Tombstone phone must satisfy the +233[0-9]{9} constraint and stay unique.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const tombstone = '+233' + tombstoneDigits();
    try {
      await sql.begin(async (tx) => {
        await tx`
          update public.customers set
            account_status = 'banned',
            deleted_at = now(),
            phone_e164 = ${tombstone},
            display_name = null,
            email = null,
            bound_mac = null,
            mac_binding = false,
            notes = null,
            updated_at = now()
          where id = ${parsed.data.customer_id}`;
        await tx`delete from public.sessions where kind = 'customer' and customer_id = ${parsed.data.customer_id}`;
        await tx`delete from public.devices where customer_id = ${parsed.data.customer_id}`;
        await tx`delete from public.hotspot_credentials where customer_id = ${parsed.data.customer_id}`;
        await tx`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id, before_data, after_data)
                 values ('admin', ${admin.adminId}, 'customer.erase', 'customers', ${parsed.data.customer_id},
                         ${tx.json({ phone_e164: before[0].phone_e164 } as any)},
                         ${tx.json({ phone_e164: tombstone, deleted_at: 'now' } as any)})`;
      });
      return json({ ok: true });
    } catch (err) {
      lastErr = err;
      const code = String((err as { code?: string })?.code ?? '');
      if (code !== '23505') break; // not a unique-violation → real failure
    }
  }
  console.error('erase failed', lastErr);
  return errorJson('erase_failed', 'Could not erase — see server log.', 500);
}
