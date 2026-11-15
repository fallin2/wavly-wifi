'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PlanRow {
  id: string; name: string; slug: string; description: string | null;
  price_pesewas: number; duration_hours: number | null; data_bytes: number | null;
  rate_limit_down_kbps: number | null; rate_limit_up_kbps: number | null;
  mikrotik_profile: string; max_devices: number;
  active: boolean; featured: boolean; sort_order: number;
}

const EMPTY: PlanRow = {
  id: '', name: '', slug: '', description: '', price_pesewas: 500, duration_hours: 24 * 30, data_bytes: null,
  rate_limit_down_kbps: 2048, rate_limit_up_kbps: 1024, mikrotik_profile: 'wavly-default', max_devices: 2,
  active: true, featured: false, sort_order: 100,
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ margin: '8px 0' }}>
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export default function PlansClient({ plans }: { plans: PlanRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PlanRow | null>(null); // null = closed; EMPTY = create
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const p = editing;
  const set = (patch: Partial<PlanRow>) => setEditing((prev) => (prev ? { ...prev, ...patch } : prev));

  async function save() {
    if (!p) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: p.id || undefined,
          name: p.name.trim(), slug: p.slug.trim(), description: p.description?.trim() || null,
          price_pesewas: Math.round(p.price_pesewas),
          duration_hours: p.duration_hours, data_bytes: p.data_bytes,
          rate_limit_down_kbps: p.rate_limit_down_kbps, rate_limit_up_kbps: p.rate_limit_up_kbps,
          mikrotik_profile: p.mikrotik_profile.trim(), max_devices: p.max_devices,
          active: p.active, featured: p.featured, sort_order: p.sort_order,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error?.message ?? 'Save failed.'); return; }
      setMsg('Saved.');
      setEditing(null);
      router.refresh();
    } catch { setMsg('Network error.'); } finally { setBusy(false); }
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 10px', fontSize: '0.95rem', border: '1px solid var(--line)', borderRadius: 8 };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0 12px' }}>
        <p className="hint" style={{ margin: 0 }}>Plans are soft-disabled (never deleted) so old payments stay interpretable.</p>
        <button className="btn btn-primary" onClick={() => { setEditing({ ...EMPTY }); setMsg(null); }}>+ New plan</button>
      </div>
      {msg && !editing && <div className="ok-box">{msg}</div>}

      <table className="data">
        <thead><tr><th>Plan</th><th>Price</th><th>Limit</th><th>Profile</th><th>Devices</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id}>
              <td><b>{plan.name}</b><br /><span className="hint" style={{ margin: 0 }}>{plan.slug}{plan.featured ? ' · featured' : ''}</span></td>
              <td>GH¢{(plan.price_pesewas / 100).toFixed(2)}</td>
              <td>
                {plan.duration_hours ? `${Math.round(plan.duration_hours / 24)}d` : 'time ∞'}
                {plan.data_bytes ? ` · ${(plan.data_bytes / 1024 ** 3).toFixed(0)} GB` : ''}
              </td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{plan.mikrotik_profile}</td>
              <td>{plan.max_devices}</td>
              <td><span className={`pill ${plan.active ? 'pill-ok' : 'pill-mut'}`}>{plan.active ? 'on' : 'off'}</span></td>
              <td><button className="btn btn-navy" style={{ padding: '5px 12px', fontSize: '0.8rem' }} onClick={() => { setEditing({ ...plan }); setMsg(null); }}>Edit</button></td>
            </tr>
          ))}
          {plans.length === 0 && <tr><td colSpan={7} className="hint">No plans yet — create the first one.</td></tr>}
        </tbody>
      </table>

      {p && (
        <div className="card" style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>{p.id ? `Edit: ${p.name}` : 'New plan'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <Field label="Name"><input style={inputStyle} value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Slug" hint="lowercase, digits, hyphens"><input style={inputStyle} value={p.slug} onChange={(e) => set({ slug: e.target.value })} /></Field>
            <Field label="Price (pesewas)" hint="GH¢1 = 100 pesewas; GH¢5.00 = 500"><input type="number" min={0} style={inputStyle} value={p.price_pesewas} onChange={(e) => set({ price_pesewas: Number(e.target.value) })} /></Field>
            <Field label="Duration (hours)" hint="blank = data-cap only"><input type="number" min={1} style={inputStyle} value={p.duration_hours ?? ''} onChange={(e) => set({ duration_hours: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Data cap (GB)" hint="blank = unlimited data"><input type="number" min={1} style={inputStyle} value={p.data_bytes ? Math.round(p.data_bytes / 1024 ** 3) : ''} onChange={(e) => set({ data_bytes: e.target.value === '' ? null : Math.round(Number(e.target.value) * 1024 ** 3) })} /></Field>
            <Field label="Rate down (kbps)"><input type="number" min={64} style={inputStyle} value={p.rate_limit_down_kbps ?? ''} onChange={(e) => set({ rate_limit_down_kbps: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Rate up (kbps)"><input type="number" min={64} style={inputStyle} value={p.rate_limit_up_kbps ?? ''} onChange={(e) => set({ rate_limit_up_kbps: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="MikroTik profile" hint="must match a profile on the router, e.g. wavly-basic"><input style={inputStyle} value={p.mikrotik_profile} onChange={(e) => set({ mikrotik_profile: e.target.value })} /></Field>
            <Field label="Max devices"><input type="number" min={1} max={8} style={inputStyle} value={p.max_devices} onChange={(e) => set({ max_devices: Number(e.target.value) })} /></Field>
            <Field label="Sort order"><input type="number" min={0} style={inputStyle} value={p.sort_order} onChange={(e) => set({ sort_order: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Description"><input style={inputStyle} value={p.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>
          <div style={{ display: 'flex', gap: 16, margin: '6px 0 10px' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={p.active} onChange={(e) => set({ active: e.target.checked })} /> Active</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={p.featured} onChange={(e) => set({ featured: e.target.checked })} /> Featured</label>
          </div>
          {msg && <div className="error-box">{msg}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
