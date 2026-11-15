import { getDb } from '@/lib/db';
import { safeEqual } from '@/lib/crypto';
import { checkRateLimit } from '@/lib/ratelimit';
import { json, errorJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const key = process.env.ROUTER_SYNC_KEY;
  if (!key) return false;
  const provided = req.headers.get('x-router-key') ?? '';
  return provided.length > 0 && safeEqual(provided, key);
}

interface UsageLine { mac: string; username: string; bytesIn: number; bytesOut: number }

function parseBody(raw: string): UsageLine[] {
  const out: UsageLine[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(',');
    if (parts.length < 5) continue;
    const [mac, username, bytesIn, bytesOut] = parts;
    const bi = Number(bytesIn), bo = Number(bytesOut);
    if (!/^[0-9a-f:]{17}$/i.test(mac)) continue;
    if (!/^[a-z0-9]{6,32}$/i.test(username)) continue;
    if (!Number.isFinite(bi) || !Number.isFinite(bo) || bi < 0 || bo < 0) continue;
    out.push({ mac: mac.toLowerCase(), username: username.toLowerCase(), bytesIn: bi, bytesOut: bo });
  }
  return out;
}

export async function POST(req: Request) {
  if (!authorized(req)) return errorJson('unauthorized', 'Bad router key.', 401);

  const rl = await checkRateLimit({ key: 'router:usage', windowSeconds: 300, max: 100 });
  if (!rl.allowed) return errorJson('rate_limited', 'Usage rate exceeded.', 429);

  const raw = await req.text();
  if (raw.length > 256 * 1024) return errorJson('too_large', 'Payload too large.', 413);
  const lines = parseBody(raw);

  const sql = getDb();
  let processed = 0, crossedCaps = 0;

  for (const line of lines) {
    const creds = await sql<{ customer_id: string }[]>`
      select customer_id from public.hotspot_credentials where username = ${line.username}`;
    const customerId = creds[0]?.customer_id ?? null;

    // Devices: upsert seen MAC (feeds MAC-binding UI + support).
    if (customerId) {
      await sql`insert into public.devices (customer_id, mac, first_seen_at, last_seen_at)
                values (${customerId}, ${line.mac}, now(), now())
                on conflict (customer_id, mac) do update set last_seen_at = now()`.catch(() => {});
    }

    const prev = await sql<{ last_bytes_in: string; last_bytes_out: string }[]>`
      select last_bytes_in, last_bytes_out from public.router_usage_state where username = ${line.username}`;
    const prevIn = prev[0] ? Number(prev[0].last_bytes_in) : 0;
    const prevOut = prev[0] ? Number(prev[0].last_bytes_out) : 0;
    // Counter resets (router reboot / user re-created) → treat current as the delta.
    const deltaIn = line.bytesIn >= prevIn ? line.bytesIn - prevIn : line.bytesIn;
    const deltaOut = line.bytesOut >= prevOut ? line.bytesOut - prevOut : line.bytesOut;

    await sql`insert into public.router_usage_state (username, last_bytes_in, last_bytes_out, updated_at)
              values (${line.username}, ${line.bytesIn}, ${line.bytesOut}, now())
              on conflict (username) do update
                set last_bytes_in = ${line.bytesIn}, last_bytes_out = ${line.bytesOut}, updated_at = now()`;

    if (deltaIn + deltaOut > 0) {
      await sql`insert into public.usage_records (username, customer_id, bytes_in, bytes_out, source)
                values (${line.username}, ${customerId}, ${deltaIn}, ${deltaOut}, 'router_sync')`;

      if (customerId) {
        // Attribute to the live subscription with a cap (most recent first).
        const subs = await sql<{ id: string; data_bytes_cap: string | null; data_bytes_used: string }[]>`
          select id, data_bytes_cap, data_bytes_used
            from public.subscriptions
           where customer_id = ${customerId} and status = 'active'
           order by created_at desc`;
        for (const sub of subs) {
          const updated = await sql<{ id: string; crossed: boolean }[]>`
            update public.subscriptions
               set data_bytes_used = data_bytes_used + ${deltaIn + deltaOut}, updated_at = now()
             where id = ${sub.id}
            returning id, (data_bytes_cap is not null and data_bytes_used >= data_bytes_cap and (data_bytes_used - ${deltaIn + deltaOut}) < data_bytes_cap) as crossed`;
          if (updated[0]?.crossed) {
            crossedCaps++;
            // Out of data: kick the session. New purchase re-upserts credentials automatically.
            await sql`insert into public.hotspot_outbox (op, username, payload) values
                      ('kick', ${line.username}, '{}'::jsonb), ('disable', ${line.username}, '{}'::jsonb)`;
          }
          break; // newest subscription absorbs the traffic
        }
      }
    }
    processed++;
  }

  return json({ ok: true, processed, crossed_caps: crossedCaps });
}
