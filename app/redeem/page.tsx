'use client';
import { useState, type FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function RedeemForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/vouchers/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { router.push(`/login?next=${encodeURIComponent('/redeem')}`); return; }
      if (!res.ok) { setError(data?.error?.message ?? 'Voucher could not be applied.'); setBusy(false); return; }
      setOk(true);
      setTimeout(() => router.push('/account?fresh=1'), 1800);
    } catch {
      setError('Network problem — retry in a moment.');
      setBusy(false);
    }
  }

  if (ok) {
    return <div className="card"><div className="ok-box"><b>Voucher applied!</b> Your plan is active. Taking you to your account…</div></div>;
  }
  return (
    <form className="card" onSubmit={submit}>
      {error ? <div className="error-box">{error}</div> : null}
      <div className="field">
        <label htmlFor="code">Voucher code</label>
        <input id="code" autoCapitalize="characters" autoComplete="off" spellCheck={false}
               placeholder="WAV-XXXX-XXXX-XXXX" value={code}
               onChange={(e) => setCode(e.target.value.toUpperCase())} required autoFocus />
        <p className="hint">Dashes and spaces don&rsquo;t matter — type or paste it as printed.</p>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Applying…' : 'Redeem voucher'}</button>
    </form>
  );
}

export default function RedeemPage() {
  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link className="brand" href="/">Wavly<span>WiFi</span></Link>
          <nav><Link href="/account">Account</Link></nav>
        </div>
      </header>
      <main className="container" style={{ maxWidth: 480, paddingBottom: 40 }}>
        <h1 style={{ fontSize: '1.4rem', marginTop: 22 }}>Redeem a voucher</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.92rem' }}>You need to be signed in first. Your plan activates immediately after a valid code.</p>
        <Suspense fallback={<div className="card">Loading…</div>}>
          <RedeemForm />
        </Suspense>
      </main>
    </>
  );
}
