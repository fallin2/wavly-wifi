'use client';
import { useState } from 'react';

const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: '0.95rem', border: '1px solid var(--line)', borderRadius: 8 };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, message: data?.error?.message as string | undefined };
}

export default function AccountClient() {
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const [tfaPw, setTfaPw] = useState('');
  const [tfaMsg, setTfaMsg] = useState<string | null>(null);
  const [tfaBusy, setTfaBusy] = useState(false);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
      <form
        className="card"
        style={{ margin: 0 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setPwBusy(true); setPwMsg(null);
          const r = await post('/api/admin/account/password', { current_password: pwCurrent, new_password: pwNew });
          if (r.ok) { setPwMsg('Password changed — signing you out…'); setTimeout(() => { window.location.href = '/admin/login'; }, 1400); }
          else setPwMsg(r.message ?? 'Failed.');
          setPwBusy(false);
        }}
      >
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Change password</h2>
        <div className="field"><label>Current password</label><input style={inputStyle} type="password" autoComplete="current-password" required value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} /></div>
        <div className="field"><label>New password (min 10 chars)</label><input style={inputStyle} type="password" autoComplete="new-password" minLength={10} required value={pwNew} onChange={(e) => setPwNew(e.target.value)} /></div>
        {pwMsg && <div className={pwMsg.startsWith('Password changed') ? 'ok-box' : 'error-box'}>{pwMsg}</div>}
        <button className="btn btn-navy" disabled={pwBusy}>{pwBusy ? 'Saving…' : 'Change password'}</button>
      </form>

      <form
        className="card"
        style={{ margin: 0 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!confirm('Reset 2FA? Your authenticator entry stops working immediately and the next sign-in forces re-enrollment.')) return;
          setTfaBusy(true); setTfaMsg(null);
          const r = await post('/api/admin/account/totp-reset', { current_password: tfaPw });
          if (r.ok) { setTfaMsg('2FA reset — signing you out…'); setTimeout(() => { window.location.href = '/admin/login'; }, 1400); }
          else setTfaMsg(r.message ?? 'Failed.');
          setTfaBusy(false);
        }}
      >
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Reset 2FA (lost phone)</h2>
        <p className="hint">Clears your TOTP secret. The next sign-in asks you to set up a new authenticator. Requires your current password.</p>
        <div className="field"><label>Current password</label><input style={inputStyle} type="password" autoComplete="current-password" required value={tfaPw} onChange={(e) => setTfaPw(e.target.value)} /></div>
        {tfaMsg && <div className={tfaMsg.startsWith('2FA reset') ? 'ok-box' : 'error-box'}>{tfaMsg}</div>}
        <button className="btn btn-danger" disabled={tfaBusy}>{tfaBusy ? 'Resetting…' : 'Reset 2FA'}</button>
      </form>
    </div>
  );
}
