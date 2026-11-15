import { getDb } from '@/lib/db';
import { safeEqual } from '@/lib/crypto';
import { checkRateLimit } from '@/lib/ratelimit';
import { encodeWireStream, simpleOp, upsertOp, type WireOp } from '@/lib/wire';
import { json, errorJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const key = process.env.ROUTER_SYNC_KEY;
  if (!key) return false;
  const provided = req.headers.get('x-router-key') ?? '';
  return provided.length > 0 && safeEqual(provided, key);
}

export async function GET(req: Request) {
  if (!authorized(req)) return errorJson('unauthorized', 'Bad router key.', 401);

  const rl = await checkRateLimit({ key: 'router:sync', windowSeconds: 300, max: 100 });
  if (!rl.allowed) return errorJson('rate_limited', 'Sync rate exceeded.', 429);

  const sql = getDb();
  // Claim atomically: oldest 60 pending ops, locked, marked sent in the same statement.
  const claimed = await sql<{ op: string; username: string; payload: any }[]>`
    with claimed as (
      select id from public.hotspot_outbox
       where status = 'pending'
       order by id
       limit 60
       for update skip locked
    )
    update public.hotspot_outbox o
       set status = 'sent', attempts = o.attempts + 1, sent_at = now()
      from claimed
     where o.id = claimed.id
     returning o.op, o.username, o.payload`;

  const ops: WireOp[] = [];
  for (const row of claimed) {
    const p = row.payload ?? {};
    switch (row.op) {
      case 'upsert':
        ops.push(upsertOp(row.username, String(p.secret ?? ''), String(p.profile ?? 'wavly-default'), Number(p.limitUptimeMin ?? 0), p.mac ?? '-'));
        break;
      case 'enable': ops.push(simpleOp(2, row.username)); break;
      case 'disable': ops.push(simpleOp(3, row.username)); break;
      case 'kick': ops.push(simpleOp(4, row.username)); break;
    }
  }

  const body = encodeWireStream(ops); // Wire Format v1 — empty stream is legal (router logs and idles)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Ops-Count': String(ops.length),
    },
  });
}
