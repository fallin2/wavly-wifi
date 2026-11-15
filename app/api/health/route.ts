import { getDb } from '@/lib/db';
import { json, errorJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql<{ now: string }[]>`select now()::text as now`;
    const pending = await sql<{ n: number }[]>`select count(*)::int as n from public.hotspot_outbox where status = 'pending'`;
    return json({ ok: true, db_time: rows[0].now, outbox_pending: pending[0].n });
  } catch (err) {
    return errorJson('db_unavailable', 'Database unreachable', 503);
  }
}
