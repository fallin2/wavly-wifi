import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(10, 'At least 10 characters').max(128),
});

/** Change own admin password. Invalidates ALL of the admin's sessions (forces fresh login + TOTP). */
export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', parsed.error.issues[0]?.message ?? 'Enter both passwords.', 400);

  const sql = getDb();
  const rows = await sql<{ password_hash: string }[]>`select password_hash from public.admin_users where id = ${admin.adminId}`;
  const row = rows[0];
  if (!row) return errorJson('not_found', 'Admin not found.', 404);
  const ok = await bcrypt.compare(parsed.data.current_password, row.password_hash);
  if (!ok) return errorJson('bad_password', 'Current password is wrong.', 403);
  if (await bcrypt.compare(parsed.data.new_password, row.password_hash)) {
    return errorJson('same_password', 'New password must differ from the current one.', 400);
  }

  const hash = await bcrypt.hash(parsed.data.new_password, 10);
  await sql`update public.admin_users set password_hash = ${hash}, failed_attempts = 0, locked_until = null, updated_at = now() where id = ${admin.adminId}`;
  await sql`delete from public.sessions where kind = 'admin' and admin_id = ${admin.adminId}`;
  await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id)
            values ('admin', ${admin.adminId}, 'admin.password_change', 'admin_users', ${admin.adminId})`;
  return json({ ok: true });
}
