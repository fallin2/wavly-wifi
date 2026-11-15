import { getDb } from './db';

export interface Settings {
  business_name: string;
  support_phone: string | null;
  support_whatsapp: string | null;
  privacy_notice: string;
  currency: string;
  max_devices_default: number;
}

const FALLBACK: Settings = {
  business_name: 'Wavly WiFi',
  support_phone: null,
  support_whatsapp: null,
  privacy_notice: 'We collect only your phone number and usage data to provide this service. Data is kept for 24 months and never sold.',
  currency: 'GHS',
  max_devices_default: 1,
};

export async function getSettings(): Promise<Settings> {
  try {
    const sql = getDb();
    const rows = await sql<Settings[]>`
      select business_name, support_phone, support_whatsapp, privacy_notice, currency, max_devices_default
        from public.settings where id = 1`;
    return rows[0] ?? FALLBACK;
  } catch {
    return FALLBACK; // portal must stay renderable even when the DB hiccups
  }
}
