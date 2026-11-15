// Paystack client (Ghana: GHS, MoMo charge API). Amounts are integer pesewas.
import crypto from 'crypto';

const BASE = 'https://api.paystack.co';

export type MomoProvider = 'mtn' | 'vod' | 'atl'; // Paystack codes: MTN, Telecel (vod), AirtelTigo (atl)

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set');
  return key;
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const digest = crypto.createHmac('sha512', secretKey()).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function paystackFetch(path: string, init: RequestInit) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* leave null */ }
  return { status: res.status, body, raw: text };
}

export interface ChargeMomoParams {
  reference: string;
  email: string;
  amountPesewas: number;
  momoPhone: string;      // +233XXXXXXXXX or 0XXXXXXXXX — Paystack accepts 0-prefixed
  provider: MomoProvider;
}

/** Initiate a MoMo charge → customer approves the prompt/USSD on their phone. */
export async function chargeMobileMoney(p: ChargeMomoParams) {
  const momo = p.momoPhone.replace(/^\+233/, '0'); // Paystack wants local format
  const { status, body } = await paystackFetch('/transaction/charge', {
    method: 'POST',
    body: JSON.stringify({
      email: p.email,
      amount: p.amountPesewas,
      currency: 'GHS',
      reference: p.reference,
      mobile_money: { phone: momo, provider: p.provider },
    }),
  });
  return {
    ok: status < 400 && body?.status === true,
    httpStatus: status,
    providerStatus: body?.data?.status ?? null,      // 'pay_offline' | 'send_otp' | 'success' | 'failed'
    message: body?.message ?? body?.data?.display_text ?? null,
    raw: body,
  };
}

/** Card path: hosted checkout URL (redirect). Used as an alternative channel. */
export async function initializeCardTransaction(p: { reference: string; email: string; amountPesewas: number; callbackUrl: string }) {
  const { status, body } = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: p.email,
      amount: p.amountPesewas,
      currency: 'GHS',
      reference: p.reference,
      channels: ['card'],
      callback_url: p.callbackUrl,
    }),
  });
  return {
    ok: status < 400 && body?.status === true,
    authorizationUrl: body?.data?.authorization_url ?? null,
    message: body?.message ?? null,
    raw: body,
  };
}

export async function verifyTransaction(reference: string) {
  const { status, body } = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
  return {
    ok: status < 400 && body?.status === true,
    providerStatus: body?.data?.status ?? null,      // 'success' | 'failed' | 'abandoned' | ...
    amountPesewas: body?.data?.amount ?? null,
    reference: body?.data?.reference ?? null,
    channel: body?.data?.channel ?? null,
    paidAt: body?.data?.paid_at ?? null,
    raw: body,
  };
}


/** Refund a transaction (full or partial, amount in pesewas). Paystack processes asynchronously; we record the request result. */
export async function refundTransaction(reference: string, amountPesewas?: number) {
  const { status, body } = await paystackFetch('/refund', {
    method: 'POST',
    body: JSON.stringify(amountPesewas ? { transaction: reference, amount: amountPesewas } : { transaction: reference }),
  });
  return {
    ok: status < 400 && body?.status === true,
    refundId: body?.data?.id != null ? String(body.data.id) : null,
    message: body?.message ?? null,
    raw: body,
  };
}

/** Paystack webhooks use the charge.success event for MoMo charges. */
export interface ParsedPaystackEvent {
  event: string;
  reference: string | null;
  amountPesewas: number | null;
  status: string | null;
  channel: string | null;
  paidAt: string | null;
  raw: unknown;
}

export function parseWebhookEvent(rawBody: string): ParsedPaystackEvent | null {
  let body: any;
  try { body = JSON.parse(rawBody); } catch { return null; }
  const data = body?.data ?? {};
  return {
    event: String(body?.event ?? ''),
    reference: data?.reference ?? null,
    amountPesewas: typeof data?.amount === 'number' ? data.amount : null,
    status: data?.status ?? null,
    channel: data?.channel ?? null,
    paidAt: data?.paid_at ?? data?.transaction_date ?? null,
    raw: body,
  };
}
