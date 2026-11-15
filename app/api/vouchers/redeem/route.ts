import { z } from 'zod';
import { getCustomerSession } from '@/lib/sessions';
import { redeemVoucher, formatGhsFromPesewas } from '@/lib/billing';
import { json, errorJson, assertSameOrigin } from '@/lib/http';
import { checkRateLimit } from '@/lib/ratelimit';
import { normalizeVoucherCode } from '@/lib/billing';

export const runtime = 'nodejs';

const Body = z.object({ code: z.string().min(8).max(40) });

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return errorJson('forbidden', 'Bad origin.', 403);
  const session = await getCustomerSession(req);
  if (!session) return errorJson('unauthorized', 'Not signed in.', 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('bad_request', 'Enter the voucher code.', 400);

  const rl = await checkRateLimit({ key: `voucher:redeem:${session.customerId}`, windowSeconds: 3600, max: 20 });
  if (!rl.allowed) return errorJson('rate_limited', 'Too many attempts. Try later.', 429);

  const code = normalizeVoucherCode(parsed.data.code);
  const result = await redeemVoucher(code, session.customerId);

  switch (result.kind) {
    case 'redeemed':
      return json({ ok: true, plan: result.planName, subscription_id: result.subscriptionId });
    case 'expired_batch':
      return errorJson('voucher_expired', 'This voucher batch has expired.', 400);
    case 'plan_missing':
      return errorJson('plan_missing', 'The plan for this voucher no longer exists — contact support.', 400);
    default:
      return errorJson('invalid_voucher', 'Voucher not found or already used.', 400);
  }
}
