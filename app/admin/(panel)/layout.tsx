import { redirect } from 'next/navigation';
import { getAdminSessionFromCookies } from '@/lib/sessions';
import Sidebar from './Sidebar';

export const dynamic = 'force-dynamic';

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminSessionFromCookies();
  if (!admin) redirect('/admin/login');

  return (
    <div className="admin-wrap">
      <Sidebar username={admin.username} role={admin.role} />
      <main className="admin-main">{children}</main>
    </div>
  );
}
