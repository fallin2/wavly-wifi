import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

const Phone = z.union([z.literal(''), z.string().regex(/^\+233[0-9]{9}$/, 'Use +233 format, e.g. +233241234567')]);

const Body = z.object({
  business_name: z.string().trim().min(2).max(80),
  support_phone: Phone,
  support_whatsapp: Phone,
  receipt_prefix: z.string().regex(/^[A-Za-z0-9]{2,10}$/, '2–10 letters/digits'),
  max_devices_default: z.number().int().min(1).max(8),
  sync_interval_seconds: z.number().int().min(15).max(300),
  privacy_notice: z.string().trim().min(10).max(2000),
});

/** Update the singleton settings row. Owner/admin only. Audit-logged. */
export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);
  if (!['owner', 'admin'].includes(admin.role)) return errorJson('forbidden', 'Insufficient role.', 403);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', parsed.error.issues[0]?.message ?? 'Check the form.', 400);
  const d = parsed.data;

  const sql = getDb();
  const before = await sql`select business_name, support_phone, support_whatsapp, receipt_prefix, max_devices_default, sync_interval_seconds, privacy_notice from public.settings where id = 1`;
  await sql`
    update public.settings set
      business_name = ${d.business_name},
      support_phone = ${d.support_phone || null},
      support_whatsapp = ${d.support_whatsapp || null},
      receipt_prefix = ${d.receipt_prefix.toUpperCase()},
      max_devices_default = ${d.max_devices_default},
      sync_interval_seconds = ${d.sync_interval_seconds},
      privacy_notice = ${d.privacy_notice},
      updated_at = now()
    where id = 1`;
  await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id, before_data, after_data)
            values ('admin', ${admin.adminId}, 'settings.update', 'settings', '1',
                    ${sql.json(before[0] as any)}, ${sql.json(d as any)})`;
  return json({ ok: true });
}
