import { NextResponse } from 'next/server';

export function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers });
}

export function errorJson(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function readClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? '0.0.0.0';
}

/** For mutating browser routes: session cookie auth already implies same-site; this adds Fetch-Metadata/Origin defence-in-depth. */
export function assertSameOrigin(req: Request): boolean {
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite) return secFetchSite === 'same-origin' || secFetchSite === 'same-site' || secFetchSite === 'none';
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser clients (curl) with valid credentials
  try {
    const host = new URL(origin).host;
    return host === req.headers.get('host');
  } catch {
    return false;
  }
}
