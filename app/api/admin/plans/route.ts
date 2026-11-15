import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { json, errorJson, assertSameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

const Body = z.object({
  id: z.string().uuid().optional(),               // present → update; absent → create
  name: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9-]{2,48}$/),
  description: z.string().max(300).nullable().optional(),
  price_pesewas: z.number().int().min(0).max(10_000_000),
  duration_hours: z.number().int().min(1).max(24 * 365).nullable().optional(),
  data_bytes: z.number().int().min(1).nullable().optional(),
  rate_limit_down_kbps: z.number().int().min(64).nullable().optional(),
  rate_limit_up_kbps: z.number().int().min(64).nullable().optional(),
  mikrotik_profile: z.string().regex(/^wavly-[a-z0-9-]{1,40}$/),
  max_devices: z.number().int().min(1).max(8),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(9999).default(100),
}).refine((d) => d.duration_hours != null || d.data_bytes != null, { message: 'A plan must limit time or data.' });

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);
  if (!['owner', 'admin'].includes(admin.role)) return errorJson('forbidden', 'Insufficient role.', 403);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid plan.';
    return errorJson('bad_request', msg, 400);
  }
  const d = parsed.data;
  const sql = getDb();

  if (d.id) {
    const before = await sql`select * from public.plans where id = ${d.id}`;
    if (!before.length) return errorJson('not_found', 'Plan not found.', 404);
    const rows = await sql`
      update public.plans set
        name = ${d.name}, slug = ${d.slug}, description = ${d.description ?? null},
        price_pesewas = ${d.price_pesewas}, duration_hours = ${d.duration_hours ?? null}, data_bytes = ${d.data_bytes ?? null},
        rate_limit_down_kbps = ${d.rate_limit_down_kbps ?? null}, rate_limit_up_kbps = ${d.rate_limit_up_kbps ?? null},
        mikrotik_profile = ${d.mikrotik_profile}, max_devices = ${d.max_devices},
        active = ${d.active}, featured = ${d.featured}, sort_order = ${d.sort_order}, updated_at = now()
      where id = ${d.id}
      returning id`;
    await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id, before_data, after_data)
              values ('admin', ${admin.adminId}, 'plan.update', 'plans', ${d.id},
                      ${sql.json(before[0] as any)}, ${sql.json(d as any)})`;
    return json({ ok: true, id: rows[0].id });
  }

  const exists = await sql`select id from public.plans where slug = ${d.slug}`;
  if (exists.length) return errorJson('slug_taken', 'A plan with that slug already exists.', 409);

  const rows = await sql`
    insert into public.plans (name, slug, description, price_pesewas, duration_hours, data_bytes,
                              rate_limit_down_kbps, rate_limit_up_kbps, mikrotik_profile, max_devices, active, featured, sort_order)
    values (${d.name}, ${d.slug}, ${d.description ?? null}, ${d.price_pesewas}, ${d.duration_hours ?? null}, ${d.data_bytes ?? null},
            ${d.rate_limit_down_kbps ?? null}, ${d.rate_limit_up_kbps ?? null}, ${d.mikrotik_profile}, ${d.max_devices},
            ${d.active}, ${d.featured}, ${d.sort_order})
    returning id`;
  await sql`insert into public.audit_log (actor_kind, actor_id, action, target_table, target_id, after_data)
            values ('admin', ${admin.adminId}, 'plan.create', 'plans', ${rows[0].id}, ${sql.json(d as any)})`;
  return json({ ok: true, id: rows[0].id });
}
