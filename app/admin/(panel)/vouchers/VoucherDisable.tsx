'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function VoucherDisable({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      className="btn"
      style={{ padding: '4px 10px', fontSize: '0.75rem', background: 'var(--bad)', color: '#fff', borderRadius: 8 }}
      onClick={async () => {
        if (!confirm('Disable this voucher? It cannot be redeemed afterwards.')) return;
        setBusy(true);
        try {
          const res = await fetch(`/api/admin/vouchers/${id}/disable`, { method: 'POST' });
          if (res.ok) router.refresh(); else alert('Could not disable (already used?).');
        } finally { setBusy(false); }
      }}
    >Disable</button>
  );
}
