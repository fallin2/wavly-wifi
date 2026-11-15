'use client';
// Two-step OTP flow: (1) phone → (2) code. Preserves hotspot params (mac/ip/link/dst) in the query string.
import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const qs = new URLSearchParams();
  for (const k of ['mac', 'ip', 'link', 'dst']) { const v = search.get(k); if (v) qs.set(k, v); }
  const suffix = qs.toString() ? `?${qs}` : '';

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? 'Could not send the code. Try again.'); setBusy(false); return; }
      if (data?.dev_code) setDevCode(data.dev_code);
      setStep('code');
    } catch {
      setError('Network problem — check your signal and retry.');
    }
    setBusy(false);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? 'Wrong code. Try again.'); setBusy(false); return; }
      // Carry the hotspot link forward so the account page can auto-connect the WiFi.
      router.push(`/account${suffix}${suffix.includes('?') ? '&' : '?'}fresh=1`);
      router.refresh();
    } catch {
      setError('Network problem — check your signal and retry.');
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {error ? <div className="error-box">{error}</div> : null}

      {step === 'phone' ? (
        <form onSubmit={requestCode}>
          <div className="field">
            <label htmlFor="phone">Phone number (Ghana)</label>
            <input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0244 123 456"
                   value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus />
            <p className="hint">We&rsquo;ll SMS a 6-digit code. Standard rates apply.</p>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          {devCode ? <div className="ok-box">Dev mode — your code is <b>{devCode}</b></div> : null}
          <p className="hint" style={{ marginBottom: 8 }}>Code sent to <b>{phone}</b>. <button type="button" className="btn-ghost" style={{ display: 'inline', border: 0, padding: 0, textDecoration: 'underline', cursor: 'pointer', background: 'none', color: 'var(--navy-light)' }} onClick={() => setStep('phone')}>Change number</button></p>
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                   placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Checking…' : 'Verify & continue'}</button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link className="brand" href="/">Wavly<span>WiFi</span></Link>
          <nav><Link href="/privacy">Privacy</Link></nav>
        </div>
      </header>
      <main className="container" style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: '1.4rem', marginTop: 22 }}>Sign in</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.92rem' }}>Use the phone number you want linked to your WiFi account.</p>
        <Suspense fallback={<div className="card">Loading…</div>}>
          <LoginForm />
        </Suspense>
        <p className="hint" style={{ textAlign: 'center' }}>Have a voucher? <Link href="/redeem">Redeem it here</Link> — you&rsquo;ll sign in first.</p>
      </main>
    </>
  );
}
