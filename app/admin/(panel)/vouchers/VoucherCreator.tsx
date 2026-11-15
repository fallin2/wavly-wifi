'use client';
import { useEffect, useState } from 'react';

interface Batch { id: string; name: string; quantity: number; face_value_pesewas: number; expires_at: string | null; created_at: string; plan_name: string; unused_count: number; redeemed_count: number }

export default function VoucherCreator({ plans }: { plans: { id: string; name: string; price_pesewas: number }[] }) {
  const [name, setName] = useState('');
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [quantity, setQuantity] = useState(50);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[] | null>(null);

  // Pull latest batch stats after a create (or on first render for freshness)
  useEffect(() => { void refreshBatches(); /* eslint-disable-line */ }, []);
  async function refreshBatches() {
    try {
      const res = await fetch('/api/admin/vouchers?limit=1');
      const data = await res.json().catch(() => ({}));
      setBatches(data?.batches ?? []);
    } catch { /* non-fatal */ }
  }

  async function createBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Generate ${quantity} voucher codes? Codes are shown ONCE — download the CSV right after.`)) return;
    setBusy(true); setError(null); setCsv(null);
    try {
      const res = await fetch('/api/admin/vouchers/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, quantity, name: name.trim(), expires_at: expiresAt ? new Date(expiresAt).toISOString() : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? 'Generation failed.'); return; }
      setCsv(data.csv as string);
      setName('');
      void refreshBatches();
    } catch { setError('Network error.'); } finally { setBusy(false); }
  }

  function downloadCsv() {
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `wavly-vouchers-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 10px', fontSize: '0.95rem', border: '1px solid var(--line)', borderRadius: 8 };

  return (
    <div>
      <form className="card" onSubmit={createBatch} style={{ margin: '10px 0' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 8px' }}>Generate voucher batch</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          <div className="field" style={{ margin: 0 }}><label>Batch name</label>
            <input style={inputStyle} required placeholder="e.g. Legon campus kiosk — Nov" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>Plan</label>
            <select style={inputStyle} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — GH¢{(p.price_pesewas / 100).toFixed(2)}</option>)}
            </select></div>
          <div className="field" style={{ margin: 0 }}><label>Quantity</label>
            <input style={inputStyle} type="number" min={1} max={5000} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></div>
          <div className="field" style={{ margin: 0 }}><label>Unused codes die on (optional)</label>
            <input style={inputStyle} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
        </div>
        {error && <div className="error-box">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !planId} style={{ marginTop: 10 }}>{busy ? 'Generating…' : `Generate ${quantity} codes`}</button>
        <p className="hint">Codes print once. Only hashes are stored, so they can never be recovered or re-shown — keep the CSV.</p>
      </form>

      {csv && (
        <div className="ok-box">
          <b>Batch created.</b> This is the only time the codes exist outside the printer:{' '}
          <button className="btn btn-navy" style={{ padding: '6px 12px', fontSize: '0.85rem', marginLeft: 6 }} onClick={downloadCsv}>Download CSV</button>
        </div>
      )}

      {batches && batches.length > 0 && (
        <>
          <h2 style={{ fontSize: '1rem', margin: '18px 0 6px' }}>Recent batches</h2>
          <table className="data">
            <thead><tr><th>Batch</th><th>Plan</th><th>Qty</th><th>Unused</th><th>Redeemed</th><th>Value</th><th>Created</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td><b>{b.name}</b></td>
                  <td>{b.plan_name}</td>
                  <td>{b.quantity}</td>
                  <td>{b.unused_count}</td>
                  <td>{b.redeemed_count}</td>
                  <td>GH¢{(b.face_value_pesewas / 100).toFixed(2)}</td>
                  <td>{new Date(b.created_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Accra' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
