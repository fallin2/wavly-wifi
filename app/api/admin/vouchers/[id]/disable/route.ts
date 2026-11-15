import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await requireAdmin(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);
  if (!['owner', 'admin'].includes(admin.role)) return errorJson('forbidden', 'Insufficient role.', 403);

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson('bad_request', 'Bad voucher id.', 400);

  const sql = getDb();
  const rows = await sql`update public.vouchers set status = 'disabled' where id = ${id} and status = 'unused' returning id`;
  if (!rows.length) return errorJson('not_found', 'Voucher not found or already used.', 404);

  await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id)
            values ('admin', ${admin.adminId}, 'voucher.disable', 'vouchers', ${id})`;
  return json({ ok: true });
}
