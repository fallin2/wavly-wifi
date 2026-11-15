import { z } from 'zod';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';
import { json, errorJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
  batch_id: z.string().uuid().optional(),
  status: z.enum(['unused', 'redeemed', 'disabled', 'expired']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);

  const url = new URL(req.url);
  const q = Query.safeParse({
    batch_id: url.searchParams.get('batch_id') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!q.success) return errorJson('bad_request', 'Bad filter.', 400);

  const sql = getDb();
  const rows = await sql`
    select v.id, v.code_last4, v.status, v.redeemed_at, v.created_at,
           b.name as batch_name, b.id as batch_id, p.name as plan_name, p.slug as plan_slug,
           r.phone_e164 as redeemed_by_phone
      from public.vouchers v
      join public.voucher_batches b on b.id = v.batch_id
      join public.plans p on p.id = b.plan_id
      left join public.customers r on r.id = v.redeemed_by
     where (${q.data.batch_id ?? null}::uuid is null or v.batch_id = ${q.data.batch_id ?? null}::uuid)
       and (${q.data.status ?? null}::text is null or v.status = ${q.data.status ?? null})
     order by v.created_at desc
     limit ${q.data.limit}`;

  const batches = await sql`
    select b.id, b.name, b.quantity, b.face_value_pesewas, b.expires_at, b.created_at,
           p.name as plan_name,
           count(*) filter (where v.status = 'unused')  as unused_count,
           count(*) filter (where v.status = 'redeemed') as redeemed_count
      from public.voucher_batches b
      join public.plans p on p.id = b.plan_id
      left join public.vouchers v on v.batch_id = b.id
     group by b.id, p.name
     order by b.created_at desc
     limit 50`;

  return json({ vouchers: rows, batches });
}
