'use client';
// Admin sign-in: password step, then TOTP (or enrollment on first login).
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'password' | 'totp' | 'enroll'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingToken, setPendingToken] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? 'Sign-in failed.'); return; }
      setPendingToken(data.pending_token);
      if (data.status === 'totp_required') setStep('totp');
      else if (data.status === 'enroll_required') { setOtpauthUrl(data.otpauth_url); setSecret(data.secret); setStep('enroll'); }
      else setError('Unexpected response.');
    } catch {
      setError('Network error — try again.');
    } finally { setBusy(false); }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/admin/auth/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_token: pendingToken, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? 'Code rejected.'); return; }
      router.push('/admin');
      router.refresh();
    } catch {
      setError('Network error — try again.');
    } finally { setBusy(false); }
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--navy-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <span className="brand" style={{ fontSize: '1.5rem' }}>Wavly<span>WiFi</span></span>
          <p style={{ color: '#9fb8cc', fontSize: '0.85rem', marginTop: 6 }}>Admin console</p>
        </div>

        <div className="card" style={{ margin: 0 }}>
          {step === 'password' && (
            <form onSubmit={submitPassword}>
              <h1 style={{ fontSize: '1.15rem', margin: '0 0 12px' }}>Sign in</h1>
              <div className="field">
                <label htmlFor="u">Username</label>
                <input id="u" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="p">Password</label>
                <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </div>
              {error && <div className="error-box">{error}</div>}
              <button className="btn btn-navy btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
            </form>
          )}

          {step === 'totp' && (
            <form onSubmit={submitCode}>
              <h1 style={{ fontSize: '1.15rem', margin: '0 0 4px' }}>Two-factor code</h1>
              <p className="hint" style={{ margin: '0 0 10px' }}>Enter the 6-digit code from your authenticator app.</p>
              <div className="field">
                <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus placeholder="123456"
                       style={{ fontSize: '1.6rem', letterSpacing: '0.4em', textAlign: 'center' }}
                       value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
              </div>
              {error && <div className="error-box">{error}</div>}
              <button className="btn btn-navy btn-block" disabled={busy}>{busy ? 'Verifying…' : 'Verify & enter'}</button>
              <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => { setStep('password'); setCode(''); setError(null); }}>← Back</button>
            </form>
          )}

          {step === 'enroll' && (
            <form onSubmit={submitCode}>
              <h1 style={{ fontSize: '1.15rem', margin: '0 0 4px' }}>Set up 2FA</h1>
              <p className="hint" style={{ margin: '0 0 10px' }}>
                Scan this into Google Authenticator / Authy, or type the setup key manually. This is shown once.
              </p>
              <div style={{ background: '#0d2233', padding: 12, borderRadius: 10, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.8rem', color: '#ffd984', marginBottom: 10 }}>
                {secret}
              </div>
              {otpauthUrl && <div style={{ fontSize: '0.75rem', color: 'var(--muted)', wordBreak: 'break-all', marginBottom: 10 }}>{otpauthUrl}</div>}
              <div className="field">
                <label htmlFor="ecode">6-digit code from the app</label>
                <input id="ecode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus placeholder="123456" style={{ fontSize: '1.4rem', letterSpacing: '0.35em', textAlign: 'center' }}
                       value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
              </div>
              {error && <div className="error-box">{error}</div>}
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Confirming…' : 'Confirm & finish setup'}</button>
            </form>
          )}
        </div>
        <p style={{ color: '#5f7a90', fontSize: '0.72rem', textAlign: 'center', marginTop: 14 }}>
          Restricted area. All actions are logged.
        </p>
      </div>
    </main>
  );
}
