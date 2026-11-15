import { getDb } from '@/lib/db';
import { getCustomerSession } from '@/lib/sessions';
import { json, errorJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Hotspot login credentials — session-gated; only ever returned to the account owner over HTTPS. */
export async function GET(req: Request) {
  const session = await getCustomerSession(req);
  if (!session) return errorJson('unauthorized', 'Not signed in.', 401);
  const sql = getDb();
  const rows = await sql<{ username: string; secret: string }[]>`
    select username, secret from public.hotspot_credentials where customer_id = ${session.customerId}`;
  if (!rows.length) return json({ username: null, secret: null });
  return json(rows[0], 200, { 'Cache-Control': 'no-store' });
}
