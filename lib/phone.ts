// Ghana phone helpers: accept +233XXXXXXXXX, 233XXXXXXXXX, 0XXXXXXXXX → canonical +233XXXXXXXXX.
const GH_RE = /^\+233[0-9]{9}$/;

export function normalizeGhanaPhone(raw: string): string | null {
  if (!raw) return null;
  let p = raw.trim().replace(/[\s()-]/g, '');
  if (p.startsWith('00233')) p = '+' + p.slice(2);
  if (p.startsWith('233')) p = '+' + p;
  else if (p.startsWith('0')) p = '+233' + p.slice(1);
  else if (/^[0-9]{9}$/.test(p)) p = '+233' + p;
  return GH_RE.test(p) ? p : null;
}

export function isGhanaPhone(raw: string): boolean {
  return normalizeGhanaPhone(raw) !== null;
}
