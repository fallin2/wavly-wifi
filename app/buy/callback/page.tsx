'use client';
// Return URL after card checkout (Paystack callback). Polls our server; server talks to Paystack.
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function CallbackInner() {
  const search = useSearchParams();
  const router = useRouter();
  const reference = search.get('reference') ?? '';
  const [status, setStatus] = useState<'checking' | 'success' | 'pending' | 'failed'>('checking');

  useEffect(() => {
    if (!reference) { setStatus('failed'); return; }
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/payments/verify?reference=${encodeURIComponent(reference)}`);
        const data = await res.json().catch(() => ({}));
        if (data?.status === 'success') { clearInterval(timer); setStatus('success'); setTimeout(() => router.push('/account?fresh=1'), 1600); return; }
        if (data?.status === 'failed' || data?.status === 'abandoned') { clearInterval(timer); setStatus('failed'); return; }
      } catch { /* keep polling */ }
      if (attempts > 30) { clearInterval(timer); setStatus('pending'); }
    }, 3000);
    return () => clearInterval(timer);
  }, [reference, router]);

  if (status === 'success') return <div className="ok-box"><b>Payment received!</b> Your plan is active. Taking you to your account…</div>;
  if (status === 'failed') return <div className="error-box">Payment was not completed. <Link href="/buy">Back to plans</Link></div>;
  if (status === 'pending') return <div className="ok-box">Still confirming with the bank… your plan activates automatically once it lands. <Link href="/account">Go to account</Link></div>;
  return <div className="card"><div className="progress"><div style={{ width: '60%' }} /></div><p className="hint">Confirming your payment…</p></div>;
}

export default function CallbackPage() {
  return (
    <>
      <header className="topbar"><div className="container"><Link className="brand" href="/">Wavly<span>WiFi</span></Link></div></header>
      <main className="container" style={{ maxWidth: 480, paddingBottom: 48 }}>
        <h1 style={{ fontSize: '1.3rem', marginTop: 22 }}>Payment confirmation</h1>
        <Suspense fallback={<div className="card">Loading…</div>}><CallbackInner /></Suspense>
      </main>
    </>
  );
}
