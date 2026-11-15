#!/usr/bin/env node
// Create or rotate an admin user. Usage:
//   DATABASE_URL=postgres://... node scripts/create-admin.mjs --username owner --password '...' [--role owner|admin|support]
// Passwords are bcrypt-hashed; TOTP enrollment is forced on first login (secret issued by /api/admin/auth/login).
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const args = process.argv.slice(2);
const get = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const username = (get('username') || '').toLowerCase();
const password = get('password');
const role = get('role') || 'owner';

if (!/^[a-z0-9_.-]{3,32}$/.test(username)) { console.error('Username must match ^[a-z0-9_.-]{3,32}$'); process.exit(1); }
if (!password || password.length < 10) { console.error('Password must be at least 10 characters'); process.exit(1); }
if (!['owner', 'admin', 'support'].includes(role)) { console.error('role must be owner|admin|support'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });
const hash = await bcrypt.hash(password, 10);

const existing = await sql`select id from public.admin_users where username = ${username}`;
if (existing.length) {
  await sql`update public.admin_users set password_hash = ${hash}, active = true, failed_attempts = 0, locked_until = null, updated_at = now() where username = ${username}`;
  console.log(`Rotated password for admin "${username}" (role unchanged).`);
} else {
  await sql`insert into public.admin_users (username, password_hash, role) values (${username}, ${hash}, ${role})`;
  console.log(`Created admin "${username}" with role ${role}.`);
}
await sql.end();
console.log('Next: sign in at /admin — you will be forced to enroll TOTP on first login.');
