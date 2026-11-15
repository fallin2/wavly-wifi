import { getAdminSessionFromCookies } from '@/lib/sessions';
import { getDb } from '@/lib/db';
import AccountClient from './AccountClient';

export const dynamic = 'force-dynamic';

export default async function AdminAccountPage() {
  const admin = await getAdminSessionFromCookies(); // layout also guards; double-check for type safety
  if (!admin) return null;
  const sql = getDb();
  const rows = await sql<{ totp_enrolled_at: string | null }[]>`select totp_enrolled_at from public.admin_users where id = ${admin.adminId}`;
  const totpEnrolled = !!rows[0]?.totp_enrolled_at;

  return (
    <>
      <h1 className="admin-h1">Account & security</h1>
      <p className="admin-sub">Signed in as <b>{admin.username}</b> · role <b>{admin.role}</b>. Password {totpEnrolled ? '· 2FA enrolled' : '· 2FA pending enrollment'}.</p>
      <AccountClient />
      <p className="hint" style={{ marginTop: 14 }}>Both actions sign you out everywhere. After changing the password or resetting 2FA you will sign in again — with password only + fresh TOTP enrollment for the latter.</p>
    </>
  );
}
