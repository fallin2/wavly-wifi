import Link from 'next/link';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const settings = await getSettings();
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of ['mac', 'ip', 'link', 'dst']) if (sp[k]) qs.set(k, String(sp[k]));
  const suffix = qs.toString() ? `?${qs}` : '';

  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link className="brand" href="/">Wavly<span>WiFi</span></Link>
          <nav><Link href={`/privacy`}>Privacy</Link></nav>
        </div>
      </header>
      <main className="hero">
        <div className="container">
          <h1>Fast prepaid Wi‑Fi for Nkawie — pay with MoMo, connect in minutes.</h1>
          <p>Sign in with your phone number, pick a plan, approve the MoMo prompt and you&rsquo;re online. No contracts, no airtime cards.</p>
          <Link className="btn btn-primary" href={`/login${suffix}`}>Sign in to connect</Link>
          <small>Prices in Ghana cedis. Your phone number is used only to run your account. We never sell your data — see our <Link href="/privacy" style={{ color: '#ffd98a' }}>privacy notice</Link>.</small>
        </div>
      </main>
      <div className="container">
        <div className="card">
          <strong>How it works</strong>
          <ol style={{ margin: '10px 0 4px', paddingLeft: 20, lineHeight: 1.9 }}>
            <li>Connect to the <b>Wavly WiFi</b> network.</li>
            <li>Enter your phone number and the SMS code.</li>
            <li>Choose a plan and pay with MTN MoMo, Telecel Cash or AirtelTigo Money.</li>
            <li>Approve the prompt — you&rsquo;re connected automatically.</li>
          </ol>
        </div>
      </div>
      <footer className="footer">
        <div className="container">
          {settings.business_name} · Nkawie, Ghana{settings.support_phone ? <> · Support: {settings.support_phone}</> : null} · <Link href="/privacy">Privacy</Link>
        </div>
      </footer>
    </>
  );
}
