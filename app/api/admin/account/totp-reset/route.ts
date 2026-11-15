import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({ current_password: z.string().min(1).max(128) });

/** Clear own TOTP enrollment (lost phone). Next sign-in re-forces enrollment. Invalidates all admin sessions. */
export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'Enter your current password.', 400);

  const sql = getDb();
  const rows = await sql<{ password_hash: string }[]>`select password_hash from public.admin_users where id = ${admin.adminId}`;
  const row = rows[0];
  if (!row) return errorJson('not_found', 'Admin not found.', 404);
  const ok = await bcrypt.compare(parsed.data.current_password, row.password_hash);
  if (!ok) return errorJson('bad_password', 'Current password is wrong.', 403);

  await sql`update public.admin_users set totp_secret = null, totp_enrolled_at = null, updated_at = now() where id = ${admin.adminId}`;
  await sql`delete from public.sessions where kind = 'admin' and admin_id = ${admin.adminId}`;
  await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id)
            values ('admin', ${admin.adminId}, 'admin.totp_reset', 'admin_users', ${admin.adminId})`;
  return json({ ok: true });
}
