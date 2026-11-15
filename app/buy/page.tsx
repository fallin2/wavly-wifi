import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getCustomerSessionFromCookies } from '@/lib/sessions';
import { getSettings } from '@/lib/settings';
import { ghsFromPesewas, bytesHuman, hotspotQuery } from '@/lib/format';
import Checkout from './Checkout';

export const dynamic = 'force-dynamic';

export default async function BuyPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await getCustomerSessionFromCookies();
  if (!session) redirect('/login');
  const sp = await searchParams;
  const planId = sp.plan ?? null;

  const sql = getDb();
  const plans = await sql<{ id: string; name: string; description: string | null; price_pesewas: number; duration_hours: number | null; data_bytes: string | null; rate_limit_down_kbps: number | null; rate_limit_up_kbps: number | null; max_devices: number; featured: boolean }[]>`
    select id, name, description, price_pesewas, duration_hours, data_bytes, rate_limit_down_kbps, rate_limit_up_kbps, max_devices, featured
      from public.plans where active = true order by sort_order asc, price_pesewas asc`;
  const settings = await getSettings();
  const selected = planId ? plans.find((p) => p.id === planId) ?? null : null;

  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link className="brand" href="/">Wavly<span>WiFi</span></Link>
          <nav><Link href="/account">Account</Link></nav>
        </div>
      </header>
      <main className="container" style={{ maxWidth: 640, paddingBottom: 40 }}>
        {selected ? (
          <>
            <h1 style={{ fontSize: '1.35rem', marginTop: 20 }}>Checkout — {selected.name}</h1>
            <p style={{ color: 'var(--muted)', fontSize: '0.92rem' }}>Signed in as <b>{session.phoneE164}</b>. <Link href="/buy">Pick a different plan</Link></p>
            <Checkout plan={{ id: selected.id, name: selected.name, priceDisplay: ghsFromPesewas(selected.price_pesewas) }} defaultPhone={session.phoneE164} />
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '1.35rem', marginTop: 20 }}>Choose a plan</h1>
            <p style={{ color: 'var(--muted)', fontSize: '0.92rem' }}>All prices in pesewas-accurate Ghana cedis. Plans renew manually — no surprise charges.</p>
            <div className="plan-grid">
              {plans.map((p) => (
                <div key={p.id} className={'plan-card' + (p.featured ? ' featured' : '')}>
                  {p.featured ? <span className="badge-featured">Popular</span> : null}
                  <div className="plan-name">{p.name}</div>
                  <div className="plan-price">{ghsFromPesewas(p.price_pesewas)}<small> {p.duration_hours ? `/ ${p.duration_hours >= 24 ? Math.round(p.duration_hours / 24) + ' day(s)' : p.duration_hours + 'h'}` : ''}</small></div>
                  {p.description ? <div className="plan-meta">{p.description}</div> : null}
                  <div className="plan-meta">
                    {p.rate_limit_down_kbps ? <>↓ {(p.rate_limit_down_kbps / 1024).toFixed(0)} Mbps</> : null}
                    {p.rate_limit_up_kbps ? <> ↑ {(p.rate_limit_up_kbps / 1024).toFixed(0)} Mbps</> : null}
                    {' · '}{p.max_devices} device{p.max_devices > 1 ? 's' : ''}
                    {p.data_bytes ? <>{' · '}{bytesHuman(Number(p.data_bytes))}</> : null}
                  </div>
                  <Link className="btn btn-primary" href={`/buy?plan=${p.id}`} style={{ marginTop: 'auto' }}>Choose</Link>
                </div>
              ))}
            </div>
            <p className="hint">Paying with MoMo? Prompt arrives on the MoMo phone — approval activates instantly. Support: {settings.support_phone ?? 'ask any attendant'}.</p>
          </>
        )}
      </main>
    </>
  );
}
