import type postgres from 'postgres';
import { getDb } from './db';
import { randomBase32 } from './crypto';

type Tx = postgres.TransactionSql<Record<string, any>>;

/** Idempotently create the hotspot credential row for a customer. Returns username/secret. */
export async function ensureHotspotCredentials(tx: Tx | postgres.Sql<Record<string, any>>, customerId: string) {
  const sql = tx as postgres.Sql;
  const existing = await sql`
    select username, secret from public.hotspot_credentials where customer_id = ${customerId}`;
  if (existing.length) return existing[0];

  for (let attempt = 0; attempt < 5; attempt++) {
    const username = ('wl' + randomBase32(8)).slice(0, 32);
    const secret = randomBase32(20);
    try {
      await sql`insert into public.hotspot_credentials (customer_id, username, secret) values (${customerId}, ${username}, ${secret})`;
      return { username, secret };
    } catch (err: any) {
      if (String(err?.code ?? '') === '23505') continue; // username collision → retry
      throw err;
    }
  }
  throw new Error('could not allocate hotspot username');
}

export interface UpsertPayload { secret: string; profile: string; limitUptimeMin: number; mac: string }

/** Enqueue an outbox op for the router to pull on its next sync. */
export async function enqueueOutbox(
  tx: Tx | postgres.Sql<Record<string, any>>,
  op: 'upsert' | 'enable' | 'disable' | 'kick',
  username: string,
  payload: Partial<UpsertPayload> = {},
) {
  const sql = tx as postgres.Sql;
  await sql`insert into public.hotspot_outbox (op, username, payload)
            values (${op}, ${username}, ${sql.json(payload as any)})`;
}

/** After (re)activation: push the full credential/profile state so the router can accept logins. */
export async function enqueueHotspotUpsert(tx: Tx | postgres.Sql<Record<string, any>>, customerId: string, profile: string, expiresAt: Date | null) {
  const sql = tx as postgres.Sql;
  const creds = await sql`select username, secret from public.hotspot_credentials where customer_id = ${customerId}`;
  const c = creds[0];
  if (!c) return;
  const limitMin = expiresAt ? Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 60000)) : 0;
  await enqueueOutbox(sql, 'upsert', c.username, { secret: c.secret, profile, limitUptimeMin: limitMin, mac: '-' });
}

export async function enqueueKickAndDisable(sql: postgres.Sql<Record<string, any>>, username: string) {
  await enqueueOutbox(sql, 'disable', username, {});
  await enqueueOutbox(sql, 'kick', username, {});
}

/** Voucher redemptions and MoMo activations share this entitlement stacking rule. */
export async function nextExpiryFor(tx: Tx, customerId: string, durationHours: number | null): Promise<Date | null> {
  if (!durationHours) return null; // data-cap-only entitlement: no time limit
  const rows = await tx<{ base: Date }[]>`
    select coalesce(max(expires_at), now()) as base
      from public.subscriptions
     where customer_id = ${customerId} and status = 'active' and expires_at > now()`;
  const baseRaw = rows[0]?.base ? new Date(rows[0].base) : new Date();
  const base = baseRaw > new Date() ? baseRaw : new Date();
  return new Date(base.getTime() + durationHours * 3600 * 1000);
}

export const db = getDb;
