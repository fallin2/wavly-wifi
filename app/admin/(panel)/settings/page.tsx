import { getDb } from '@/lib/db';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const sql = getDb();
  const [s] = await sql`select business_name, support_phone, support_whatsapp, receipt_prefix, max_devices_default, sync_interval_seconds, privacy_notice
                          from public.settings where id = 1`;
  return (
    <>
      <h1 className="admin-h1">Business settings</h1>
      <p className="admin-sub">Shown across the portal (footer, support links, receipt prefix) and used by the OTP/sync limits. Changes take effect immediately.</p>
      <SettingsClient
        initial={{
          business_name: s?.business_name ?? 'Wavly WiFi',
          support_phone: s?.support_phone ?? '',
          support_whatsapp: s?.support_whatsapp ?? '',
          receipt_prefix: s?.receipt_prefix ?? 'WVL',
          max_devices_default: s?.max_devices_default ?? 1,
          sync_interval_seconds: s?.sync_interval_seconds ?? 45,
          privacy_notice: s?.privacy_notice ?? '',
        }}
      />
    </>
  );
}
