import { getDb } from '@/lib/db';
import { getAdminSession } from '@/lib/sessions';
import { errorJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\n') + '\n';
}

function csvResponse(filename: string, csv: string) {
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** Admin CSV exports: revenue_daily | payments | customers | vouchers */
export async function GET(req: Request) {
  const admin = await getAdminSession(req);
  if (!admin) return errorJson('unauthorized', 'Admin sign-in required.', 401);

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') ?? 'payments';
  const sql = getDb();
  const stamp = new Date().toISOString().slice(0, 10);

  if (kind === 'revenue_daily') {
    const rows = await sql`
      select day, currency, payment_count, gross_pesewas, refunded_pesewas
        from public.v_revenue_daily order by day asc`;
    return csvResponse(`wavly-revenue-daily-${stamp}.csv`,
      toCsv(['day', 'currency', 'payment_count', 'gross_pesewas', 'refunded_pesewas', 'net_pesewas'],
        rows.map((r: any) => [String(r.day).slice(0, 10), r.currency, r.payment_count, r.gross_pesewas, r.refunded_pesewas, Number(r.gross_pesewas) - Number(r.refunded_pesewas)])));
  }

  if (kind === 'payments') {
    const status = url.searchParams.get('status');
    const q = (url.searchParams.get('q') ?? '').trim();
    const rows = await sql`
      select p.id, p.created_at, p.paid_at, p.provider_reference, p.channel, p.momo_provider,
             p.status, p.amount_pesewas, p.refunded_amount_pesewas, p.failure_reason,
             c.phone_e164, c.display_name, pl.name as plan_name
        from public.payments p
        join public.customers c on c.id = p.customer_id
        join public.plans pl on pl.id = p.plan_id
       where (${status ?? null}::text is null or p.status = ${status ?? null})
         and (${q} = '' or c.phone_e164 ilike ${'%' + q + '%'} or coalesce(c.display_name,'') ilike ${'%' + q + '%'})
       order by p.created_at desc
       limit 10000`;
    return csvResponse(`wavly-payments-${stamp}.csv`,
      toCsv(['id', 'created_at', 'paid_at', 'reference', 'channel', 'momo_provider', 'status', 'amount_pesewas', 'refunded_pesewas', 'failure_reason', 'customer_phone', 'customer_name', 'plan'],
        rows.map((r: any) => [r.id, r.created_at?.toISOString?.() ?? r.created_at, r.paid_at?.toISOString?.() ?? r.paid_at ?? '', r.provider_reference, r.channel, r.momo_provider ?? '', r.status, r.amount_pesewas, r.refunded_amount_pesewas, r.failure_reason ?? '', r.phone_e164, r.display_name ?? '', r.plan_name])));
  }

  if (kind === 'customers') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const rows = await sql`
      select c.id, c.created_at, c.phone_e164, c.display_name, c.account_status,
             (select count(*) from public.subscriptions s where s.customer_id = c.id and s.status = 'active' and (s.expires_at is null or s.expires_at > now()))::int as active_subs,
             (select coalesce(sum(amount_pesewas - refunded_amount_pesewas), 0)::bigint from public.payments p where p.customer_id = c.id and p.status in ('success','partial_refund','refunded')) as lifetime_pesewas
        from public.customers c
       where c.deleted_at is null
         and (${q} = '' or c.phone_e164 ilike ${'%' + q + '%'} or coalesce(c.display_name,'') ilike ${'%' + q + '%'})
       order by c.created_at desc
       limit 10000`;
    return csvResponse(`wavly-customers-${stamp}.csv`,
      toCsv(['id', 'joined_at', 'phone', 'name', 'account_status', 'active_subs', 'lifetime_paid_pesewas'],
        rows.map((r: any) => [r.id, r.created_at?.toISOString?.() ?? r.created_at, r.phone_e164, r.display_name ?? '', r.account_status, r.active_subs, r.lifetime_pesewas])));
  }

  if (kind === 'vouchers') {
    const rows = await sql`
      select v.code_last4, v.status, v.redeemed_at, v.created_at,
             b.name as batch_name, pl.name as plan_name, r.phone_e164 as redeemed_by_phone
        from public.vouchers v
        join public.voucher_batches b on b.id = v.batch_id
        join public.plans pl on pl.id = b.plan_id
        left join public.customers r on r.id = v.redeemed_by
       order by v.created_at desc
       limit 20000`;
    return csvResponse(`wavly-vouchers-${stamp}.csv`,
      toCsv(['code_last4', 'status', 'redeemed_at', 'created_at', 'batch', 'plan', 'redeemed_by'],
        rows.map((r: any) => [r.code_last4, r.status, r.redeemed_at?.toISOString?.() ?? r.redeemed_at ?? '', r.created_at?.toISOString?.() ?? r.created_at, r.batch_name, r.plan_name, r.redeemed_by_phone ?? ''])));
  }

  return errorJson('bad_request', 'Unknown kind. Use revenue_daily | payments | customers | vouchers.', 400);
}
