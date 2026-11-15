'use client';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/admin', label: 'Overview', icon: '◉' },
  { href: '/admin/users', label: 'Customers', icon: '👤' },
  { href: '/admin/plans', label: 'Plans', icon: '▦' },
  { href: '/admin/vouchers', label: 'Vouchers', icon: '▤' },
  { href: '/admin/payments', label: 'Payments & refunds', icon: ' GH¢' },
  { href: '/admin/reports', label: 'Reports', icon: '↗' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙' },
  { href: '/admin/account', label: 'Account', icon: '○' },
];

export default function Sidebar({ username, role }: { username: string; role: string }) {
  const pathname = usePathname();
  return (
    <aside className="admin-side">
      <a className="brand" href="/admin">Wavly<span>WiFi</span></a>
      <div style={{ fontSize: '0.75rem', color: '#7d99ad', margin: '0 4px 10px' }}>
        <b style={{ color: '#fff' }}>{username}</b> · {role}
      </div>
      <nav>
        {NAV.map((item) => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
          return (
            <a key={item.href} href={item.href} className={active ? 'active' : ''}>
              <span style={{ display: 'inline-block', width: 22, opacity: 0.85 }}>{item.icon}</span>{item.label}
            </a>
          );
        })}
      </nav>
      <form action="/api/admin/auth/logout" method="post" style={{ marginTop: 18 }}>
        <button type="submit" className="btn btn-ghost btn-block" style={{ color: '#ffd9a0', borderColor: '#3a5a74' }}>
          Sign out
        </button>
      </form>
    </aside>
  );
}
