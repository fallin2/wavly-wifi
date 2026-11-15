import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { json, errorJson, assertSameOrigin } from '@/lib/http';
import { sha256Hex } from '@/lib/crypto';

export const runtime = 'nodejs';

const Body = z.object({
  plan_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(5000),
  name: z.string().min(2).max(80),
  expires_at: z.string().datetime().nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
});

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // unambiguous-ish base32 (no 0/1/8/9)

function voucherCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    const bytes = crypto.randomBytes(4);
    let s = '';
    for (let i = 0; i < 4; i++) s += ALPHABET[bytes[i] % 32];
    groups.push(s);
  }
  return `WAV-${groups.join('-')}`; // e.g. WAV-K3GH-9QXD-MT2P — displayed/printed, normalized on redeem
}

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await requireAdmin(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);
  if (!['owner', 'admin'].includes(admin.role)) return errorJson('forbidden', 'Insufficient role.', 403);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'Invalid batch parameters.', 400);
  const { plan_id, quantity, name, expires_at, agent_id } = parsed.data;

  const sql = getDb();
  const plans = await sql<{ id: string; name: string; price_pesewas: number }[]>`
    select id, name, price_pesewas from public.plans where id = ${plan_id}`;
  const plan = plans[0];
  if (!plan) return errorJson('plan_missing', 'Plan not found.', 400);

  const codes: string[] = [];
  const seen = new Set<string>();
  while (codes.length < quantity) {
    const c = voucherCode();
    const norm = c.replace(/-/g, '');
    if (seen.has(norm)) continue;
    seen.add(norm);
    codes.push(c);
  }

  const batch = await sql<{ id: string }[]>`
    insert into public.voucher_batches (name, plan_id, quantity, face_value_pesewas, agent_id, expires_at)
    values (${name}, ${plan.id}, ${quantity}, ${plan.price_pesewas}, ${agent_id ?? null}, ${expires_at ?? null})
    returning id`;
  const batchId = batch[0].id;

  // Insert in chunks; store hashes only.
  const CHUNK = 250;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK);
    const values = chunk.map((c) => {
      const norm = c.replace(/-/g, '');
      return { batch_id: batchId, code_hash: sha256Hex(norm), code_last4: norm.slice(-4) };
    });
    await sql`insert into public.vouchers ${sql(values, 'batch_id', 'code_hash', 'code_last4')}`;
  }

  await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id, after_data)
            values ('admin', ${admin.adminId}, 'voucher.batch_create', 'voucher_batches', ${batchId},
                    ${sql.json({ name, quantity, plan_id, face_value_pesewas: plan.price_pesewas } as any)})`;

  // ONE-TIME CSV — codes are not retrievable after this response (hashes only at rest).
  const csvHeader = 'code,plan,value_pesewas,batch\n';
  const csvRows = codes.map((c) => `${c},${plan.name},${plan.price_pesewas},${batchId}`).join('\n');
  const csv = csvHeader + csvRows + '\n';

  return json({ ok: true, batch_id: batchId, quantity, csv });
}
