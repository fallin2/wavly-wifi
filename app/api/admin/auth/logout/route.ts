import { destroySession, clearCookie, ADMIN_COOKIE } from '@/lib/sessions';
import { json } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  await destroySession(req, ADMIN_COOKIE);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(ADMIN_COOKIE) });
}
