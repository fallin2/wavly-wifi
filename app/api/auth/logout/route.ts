import { destroySession, clearCookie, CUSTOMER_COOKIE } from '@/lib/sessions';
import { json } from '@/lib/http';

export const runtime = 'nodejs';

function wantsHtml(req: Request): boolean {
  const ct = req.headers.get('content-type') ?? '';
  const mode = req.headers.get('sec-fetch-mode') ?? '';
  return ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data') || mode === 'navigate';
}

export async function POST(req: Request) {
  await destroySession(req, CUSTOMER_COOKIE);
  const cookie = clearCookie(CUSTOMER_COOKIE);
  if (wantsHtml(req)) {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': cookie } });
  }
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}
