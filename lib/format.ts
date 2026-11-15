export function ghsFromPesewas(pesewas: number | null | undefined): string {
  const v = (pesewas ?? 0) / 100;
  return `GH¢${v.toFixed(2)}`;
}

export const GH_TZ = 'Africa/Accra';

export function formatDateGhana(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { timeZone: GH_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDateShortGhana(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { timeZone: GH_TZ, day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeLeft(expiry: Date | string | null | undefined): string {
  if (!expiry) return 'No expiry';
  const ms = new Date(expiry).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${m}m left`;
  return `${m}m left`;
}

export function bytesHuman(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b < 1024 ** 4) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  return `${(b / 1024 ** 4).toFixed(2)} TB`;
}

/** Preserve hotspot params through the OTP flow via a query string. */
export function hotspotQuery(params: Record<string, string | string[] | undefined>): string {
  const keep = ['mac', 'ip', 'link', 'dst'];
  const q = new URLSearchParams();
  for (const k of keep) {
    const v = params[k];
    if (typeof v === 'string' && v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
