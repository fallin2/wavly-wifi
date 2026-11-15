'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UserActions({ customerId, accountStatus, hasActiveSub }: {
  customerId: string;
  accountStatus: string;
  hasActiveSub: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function post(url: string, body: unknown, okMsg: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error?.message ?? 'Failed.'); return; }
      setMsg(okMsg);
      router.refresh();
    } catch { setMsg('Network error.'); } finally { setBusy(false); }
  }

  const btn = (label: string, onClick: () => void, danger = false) => (
    <button
      key={label}
      disabled={busy}
      onClick={onClick}
      className="btn"
      style={{ padding: '5px 9px', fontSize: '0.75rem', marginRight: 4, marginBottom: 4,
               background: danger ? 'var(--bad)' : '#22344a', color: '#fff', borderRadius: 8 }}
    >{label}</button>
  );

  return (
    <div>
      {accountStatus === 'active' ? (
        <>
          {btn('Suspend', () => post('/api/admin/users/set-status', { customer_id: customerId, status: 'suspended' }, 'Suspended — router notified.'), true)}
          {btn('Ban', () => { if (confirm('Ban this customer? They will not be able to sign in or use the hotspot.')) post('/api/admin/users/set-status', { customer_id: customerId, status: 'banned' }, 'Banned.'); }, true)}
        </>
      ) : (
        btn('Reinstate', () => post('/api/admin/users/set-status', { customer_id: customerId, status: 'active' }, 'Reinstated.'))
      )}
      {hasActiveSub && btn('+24h', () => post('/api/admin/users/extend', { customer_id: customerId, hours: 24 }, 'Extended by 24h.'))}
      {hasActiveSub && btn('+7d', () => post('/api/admin/users/extend', { customer_id: customerId, hours: 168 }, 'Extended by 7 days.'))}
      {btn('Re-push Wi-Fi creds', () => post('/api/admin/users/resync', { customer_id: customerId }, 'Re-pushed to router.'))}
      {msg && <div className="hint" style={{ marginTop: 2 }}>{msg}</div>}
    </div>
  );
}
