import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getCustomerSessionFromCookies } from '@/lib/sessions';
import { getSettings } from '@/lib/settings';
import { ghsFromPesewas, formatDateGhana, timeLeft, bytesHuman } from '@/lib/format';
import AutoConnect from '@/app/components/AutoConnect';

export const dynamic = 'force-dynamic';

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await getCustomerSessionFromCookies();
  if (!session) redirect('/login');
  const sp = await searchParams;
  const showHotspotParams = Boolean(sp.link);
  const hotspotLink = sp.link ? decodeURIComponent(sp.link) : null;

  const sql = getDb();
  const subs = await sql`
    select s.id, s.status, s.started_at, s.expires_at, s.data_bytes_cap, s.data_bytes_used, s.device_limit, s.source,
           p.name as plan_name, p.slug as plan_slug
      from public.subscriptions s
      join public.plans p on p.id = s.plan_id
     where s.customer_id = ${session.customerId}
     order by s.created_at desc
     limit 6`;
  const payments = await sql`
    select p.id, p.amount_pesewas, p.status, p.channel, p.paid_at, p.created_at,
           pl.name as plan_name, p.provider_reference
      from public.payments p
      join public.plans pl on pl.id = p.plan_id
     where p.customer_id = ${session.customerId}
     order by p.created_at desc
     limit 8`;
  const settings = await getSettings();

  const active = subs.find((s) => s.status === 'active' && (!s.expires_at || new Date(s.expires_at as any) > new Date()));
  const best = active ?? subs[0] ?? null;

  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link className="brand" href="/">Wavly<span>WiFi</span></Link>
          <nav>
            <Link href="/buy">Buy plan</Link>
            <Link href="/redeem">Redeem voucher</Link>
            <form action="/api/auth/logout" method="post" style={{ display: 'inline' }}>
              <button type="submit" style={{ background: 'none', border: 0, color: '#cfe0ec', cursor: 'pointer', fontSize: '0.9rem' }}>Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="container" style={{ maxWidth: 640, paddingBottom: 48 }}>
        <h1 style={{ fontSize: '1.35rem', marginTop: 20 }}>My account</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.92rem' }}>{session.phoneE164}</p>

        {best ? (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{best.plan_name}</strong>
              {active
                ? <span className="pill pill-ok">ACTIVE</span>
                : best.status === 'expired'
                  ? <span className="pill pill-bad">EXPIRED</span>
                  : <span className="pill pill-mut">{String(best.status).toUpperCase()}</span>}
            </div>
            <div className="kv"><dt>Expires</dt><dd>{best.expires_at ? `${formatDateGhana(best.expires_at as any)} (${timeLeft(best.expires_at as any)})` : 'No time limit'}</dd></div>
            {best.data_bytes_cap ? (
              <>
                <div className="kv"><dt>Data used</dt><dd>{bytesHuman(Number(best.data_bytes_used))} of {bytesHuman(Number(best.data_bytes_cap))}</dd></div>
                <div className="progress" aria-hidden><div style={{ width: `${Math.min(100, (Number(best.data_bytes_used) / Number(best.data_bytes_cap)) * 100)}%` }} /></div>
              </>
            ) : null}
            <div className="kv"><dt>Devices</dt><dd>up to {best.device_limit}</dd></div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <Link className="btn btn-primary" href="/buy">Renew / upgrade</Link>
              <Link className="btn btn-ghost" href="/redeem">Use voucher</Link>
            </div>
          </div>
        ) : (
          <div className="card">
            <p style={{ marginTop: 0 }}>No plan on this number yet.</p>
            <Link className="btn btn-primary" href="/buy">Get connected — pick a plan</Link>
          </div>
        )}

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Connect this device</h3>
          <AutoConnect hotspotLink={showHotspotParams ? hotspotLink : null} auto={sp.fresh === '1'} />
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Recent payments</h3>
          {payments.length === 0 ? (
            <p className="hint">No payments yet — your receipts will appear here and via SMS.</p>
          ) : (
            payments.map((p) => (
              <div key={p.id} className="kv">
                <dt>{formatDateGhana(p.paid_at ?? p.created_at)} · {p.plan_name}</dt>
                <dd>{ghsFromPesewas(p.amount_pesewas)} · <span className={p.status === 'success' ? 'pill pill-ok' : p.status === 'pending' ? 'pill pill-warn' : 'pill pill-bad'}>{p.status}</span></dd>
              </div>
            ))
          )}
        </div>

        <p className="hint" style={{ textAlign: 'center' }}>Need help? {settings.support_phone ?? 'Ask any attendant'} · <Link href="/privacy">Privacy</Link></p>
      </main>
    </>
  );
}
