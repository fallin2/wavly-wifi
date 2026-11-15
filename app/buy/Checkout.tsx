'use client';
// Plan checkout: pick MoMo network → enter MoMo number → server initiates charge →
// "approve on your phone" screen polls /api/payments/verify until success/failure.
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface PlanLite { id: string; name: string; priceDisplay: string }

export default function Checkout({ plan, defaultPhone }: { plan: PlanLite; defaultPhone: string }) {
  const router = useRouter();
  const [provider, setProvider] = useState<'mtn' | 'vod' | 'atl'>('mtn');
  const [momoPhone, setMomoPhone] = useState(defaultPhone.replace(/^\+233/, '0'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'form' | 'pending' | 'success' | 'failed'>('form');
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState<string>('');

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/payments/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: plan.id, channel: 'mobile_money', momo_provider: provider, momo_phone: momoPhone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? 'Payment could not be started.'); setBusy(false); return; }
      setReference(data.reference);
      setMessage(data.message ?? 'Approve the prompt on your phone.');
      setStage('pending');
    } catch {
      setError('Network problem — check your signal and retry. (You were not charged if no prompt arrived.)');
      setBusy(false);
    }
  }

  useEffect(() => {
    if (stage !== 'pending' || !reference) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/payments/verify?reference=${encodeURIComponent(reference)}`);
        const data = await res.json().catch(() => ({}));
        if (data?.status === 'success') { clearInterval(timer); setStage('success'); return; }
        if (data?.status === 'failed' || data?.status === 'abandoned') { clearInterval(timer); setStage('failed'); setMessage('Payment failed or was cancelled.'); return; }
      } catch { /* transient — keep polling */ }
      if (attempts >= 40) { clearInterval(timer); setMessage('Still waiting… check your phone for the MoMo prompt, or come back later — we will activate automatically once you approve.'); }
    }, 3000);
    return () => clearInterval(timer);
  }, [stage, reference]);

  useEffect(() => {
    if (stage === 'success') {
      const t = setTimeout(() => router.push('/account?fresh=1'), 1500);
      return () => clearTimeout(t);
    }
  }, [stage, router]);

  if (stage === 'pending') {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Approve on your phone</h3>
        <p>{message}</p>
        <p className="hint">Reference: <span className="mono">{reference}</span> — screenshot this for support.</p>
        <div className="progress" style={{ margin: '14px 0' }}><div style={{ width: '70%' }} /></div>
        <p className="hint">Waiting for MoMo confirmation… this page updates itself. If nothing arrives within a minute, check your MoMo messages — the prompt may have appeared as a USSD dialog.</p>
      </div>
    );
  }
  if (stage === 'success') {
    return (
      <div className="card">
        <div className="ok-box"><b>Payment received!</b> Your plan is active. Taking you to your account…</div>
      </div>
    );
  }
  if (stage === 'failed') {
    return (
      <div className="card">
        <div className="error-box"><b>Payment not completed.</b> {message}</div>
        <button className="btn btn-primary" onClick={() => setStage('form')}>Try again</button>
      </div>
    );
  }
  return (
    <form className="card" onSubmit={start}>
      {error ? <div className="error-box">{error}</div> : null}
      <div className="field">
        <label htmlFor="provider">MoMo network</label>
        <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value as any)}>
          <option value="mtn">MTN MoMo</option>
          <option value="vod">Telecel Cash</option>
          <option value="atl">AirtelTigo Money</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="momo">MoMo phone number</label>
        <input id="momo" type="tel" inputMode="tel" autoComplete="tel" value={momoPhone}
               onChange={(e) => setMomoPhone(e.target.value)} placeholder="0244 123 456" required />
        <p className="hint">We send the payment prompt to this number. Amount: <b>{plan.priceDisplay}</b>.</p>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Starting…' : `Pay ${plan.priceDisplay}`}</button>
      <p className="hint">Payments are processed by Paystack. Wavly WiFi never sees your MoMo PIN.</p>
    </form>
  );
}
