'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SettingsForm {
  business_name: string;
  support_phone: string;
  support_whatsapp: string;
  receipt_prefix: string;
  max_devices_default: number;
  sync_interval_seconds: number;
  privacy_notice: string;
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: '0.95rem', border: '1px solid var(--line)', borderRadius: 8 };

export default function SettingsClient({ initial }: { initial: SettingsForm }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Partial<SettingsForm>) => setF((p) => ({ ...p, ...patch }));

  return (
    <form
      className="card"
      style={{ maxWidth: 640 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setMsg(null);
        try {
          const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...f, max_devices_default: Number(f.max_devices_default), sync_interval_seconds: Number(f.sync_interval_seconds) }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) { setMsg('Saved.'); router.refresh(); } else setMsg(data?.error?.message ?? 'Save failed.');
        } catch { setMsg('Network error.'); } finally { setBusy(false); }
      }}
    >
      <div className="field"><label htmlFor="bn">Business name</label><input id="bn" style={inputStyle} value={f.business_name} onChange={(e) => set({ business_name: e.target.value })} required /></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="sp">Support phone</label><input id="sp" placeholder="+233241234567" style={inputStyle} value={f.support_phone} onChange={(e) => set({ support_phone: e.target.value })} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="wa">Support WhatsApp</label><input id="wa" placeholder="+233241234567" style={inputStyle} value={f.support_whatsapp} onChange={(e) => set({ support_whatsapp: e.target.value })} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginTop: 8 }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="rp">Receipt prefix</label><input id="rp" style={inputStyle} value={f.receipt_prefix} onChange={(e) => set({ receipt_prefix: e.target.value })} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="md">Default device limit</label><input id="md" type="number" min={1} max={8} style={inputStyle} value={f.max_devices_default} onChange={(e) => set({ max_devices_default: Number(e.target.value) })} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="si">Router sync (sec)</label><input id="si" type="number" min={15} max={300} style={inputStyle} value={f.sync_interval_seconds} onChange={(e) => set({ sync_interval_seconds: Number(e.target.value) })} /></div>
      </div>
      <div className="field"><label htmlFor="pn">Privacy notice (portal)</label><textarea id="pn" rows={3} style={{ ...inputStyle, resize: 'vertical' }} value={f.privacy_notice} onChange={(e) => set({ privacy_notice: e.target.value })} required /></div>
      {msg && <div className={msg === 'Saved.' ? 'ok-box' : 'error-box'}>{msg}</div>}
      <button className="btn btn-navy" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
    </form>
  );
}
