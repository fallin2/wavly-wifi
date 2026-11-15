import Link from 'next/link';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function ExpiredPage() {
  const settings = await getSettings();
  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link className="brand" href="/">Wavly<span>WiFi</span></Link>
        </div>
      </header>
      <main className="container" style={{ maxWidth: 480, paddingBottom: 48 }}>
        <div className="card" style={{ textAlign: 'center', padding: '28px 22px' }}>
          <div style={{ fontSize: '2.6rem' }}>⏳</div>
          <h1 style={{ fontSize: '1.3rem', margin: '8px 0 6px' }}>Your plan has ended</h1>
          <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>No worries — renewing takes under a minute. Your account and history stay right where they are.</p>
          <Link className="btn btn-primary btn-block" href="/buy" style={{ marginTop: 8 }}>Renew now</Link>
          <p className="hint" style={{ marginTop: 12 }}>Or redeem a voucher: <Link href="/redeem">/redeem</Link></p>
        </div>
        <p className="hint" style={{ textAlign: 'center' }}>Support: {settings.support_phone ?? 'ask any attendant'}</p>
      </main>
    </>
  );
}
