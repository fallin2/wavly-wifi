# Wavly WiFi — FreeRADIUS Pack (Phase 4, optional Option A path)

Deployment guide for **real-time, in-session enforcement**: FreeRADIUS on a Raspberry Pi 4 / old PC on the LAN, checking entitlements straight from Supabase Postgres. Alternative to the default Option B (router pulls ops every 45 s). Do not deploy both for the same enforcement job — pick one. This pack changes **only** who validates logins; the portal, DB, and billing logic are identical.

**Why you'd want it:** login is instant after payment (no sync delay), expiry/data-cap kills happen at the router (`Session-Timeout`), per-device limits via `Simultaneous-Use`, one fewer moving part on the slow link (RADIUS is LAN-local; only the Pi's SQL query crosses the WAN to Supabase).
**Why you might wait:** extra hardware, one more thing to patch. Option B is fine at <100 users.

## Architecture

```
phone ──HTTP──► MikroTik hotspot ──UDP 1812/1813 (LAN)──► FreeRADIUS (Pi, static IP)
                                                              │ libpq + TLS (5432)
                                                              ▼
                                                     Supabase Postgres
   radacct (session rows) ◄── accounting ── writes by FR      (query-only for auth)
```

## Files

| File | Installs to | Purpose |
|---|---|---|
| `mods-available/sql` | `/etc/freeradius/3.0/mods-available/sql` | rlm_sql_postgresql: custom authorize/reply/simul queries + standard accounting + post-auth audit |
| `sites-available/default` | `/etc/freeradius/3.0/sites-available/default` | auth(1812)/acct(1813); PAP+CHAP+MS-CHAP; `session { sql }` enforces device limits |
| `clients.conf` | `/etc/freeradius/3.0/clients.conf` | MikroTik only + optional localhost for radtest |
| `queries/*.sql` | (test fixtures) | Canonical copies of the custom queries — **validated against the live schema** (see Test results) |
| `supabase/migrations/0003_radius.sql` | apply only for this pack | standard `radcheck…radacct` tables (left empty) + least-privilege `radius_app` role notes |

## Install (Debian 12 on the Pi)

```bash
sudo apt update && sudo apt install -y freeradius freeradius-postgresql freeradius-utils
sudo cp mods-available/sql        /etc/freeradius/3.0/mods-available/sql
sudo cp sites-available/default   /etc/freeradius/3.0/sites-available/default
sudo cp clients.conf              /etc/freeradius/3.0/clients.conf
sudo ln -sf /etc/freeradius/3.0/mods-available/sql      /etc/freeradius/3.0/mods-enabled/sql
sudo ln -sf /etc/freeradius/3.0/sites-available/default /etc/freeradius/3.0/sites-enabled/default
sudo chmod 640 /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/clients.conf
sudo chgrp freerad /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/clients.conf
```

## Configure

1. **Database role** (Supabase SQL editor, from 0003_radius.sql notes):
   ```sql
   create role radius_app login password '<strong-random>';
   grant connect on database postgres to radius_app;
   grant usage on schema public to radius_app;
   grant select on public.hotspot_credentials, public.customers, public.subscriptions, public.plans to radius_app;
   grant select, insert, update on public.radacct to radius_app;
   grant insert on public.radpostauth to radius_app;
   grant usage, select on all sequences in schema public to radius_app;
   ```
   Note: `radius_app` has **SELECT-only** on billing tables and no access to payments/OTP rows.
2. Edit `mods-available/sql`: `server` = your Supabase **direct** host or session-pooler (5432), `login=radius_app`, the password. Keep district `ssl_mode=require`.
3. Edit `clients.conf`: router LAN IP; generate the shared secret (`openssl rand -hex 32`); paste the same secret into the router later.
4. `sudo systemctl restart freeradius`

## Verify (in order)

```bash
# 1. Config validity (prints loaded modules; exits non-zero on syntax errors):
sudo radiusd -C

# 2. Live debug in the foreground, watch a login attempt end-to-end:
sudo radiusd -X

# 3. From the Pi (uses localhost client):
radtest wltest001 '<hotspot-secret>' 127.0.0.1 0 'PASTE_LOCAL_TEST_SECRET'
# Expect: Access-Accept with MikroTik-Rate-Limit and Session-Timeout.
radtest wltest002 '<hotspot-secret>' 127.0.0.1 0 'PASTE_LOCAL_TEST_SECRET'
# Expect: Access-Reject (expired subscription).

# 4. Accounting (synthetic Start packet):
echo "User-Name=wltest001,Acct-Session-Id=TEST123,Acct-Status-Type=Start,NAS-IP-Address=127.0.0.1" | \
  radclient -x 127.0.0.1:1813 acct PASTE_LOCAL_TEST_SECRET
# Expect: rad_recv: Accounting-Response ... — and a row appears in public.radacct.
```

Then the real cutover (in a quiet window):

```
# On the router (setup.rsc already created this entry, disabled):
/radius enable [find comment="wavly-radius"]
/radius set [find comment="wavly-radius"] address=192.168.88.10 secret="<same secret>"
```

Test with one phone: connect → OTP → buy/plan active → **immediately** (no waiting for sync) the hotspot login works; account page "Connected"; expiry kicks at `Session-Timeout`.

If anything fails, `/radius set ... disabled=yes` reverts to Option B instantly.

## Test results (this repo, embedded PostgreSQL)

Executed against PG16 with the full migration chain + seed fixtures:

| Scenario | authorize_check | authorize_reply | simul_count |
|---|---|---|---|
| Active sub, plan 5/1 Mbps, 3 devices | `Cleartext-Password`, `Simultaneous-Use=3` | `MikroTik-Rate-Limit := 1024k/5120k`, `Session-Timeout := 2591999` (~30d) | 0 |
| Expired subscription | 0 rows → reject | 0 rows | 0 |
| Over data cap | 0 rows → reject | 0 rows | 0 |

The over-cap path initially leaked `Simultaneous-Use`/reply rows; caught by the test and fixed (see git history Phase 4).

## Operations

- **Logs:** `journalctl -u freeradius -f` (or `radiusd -X` on the Pi). `radpostauth` gives you accept/reject history per user — your dispute evidence.
- **radacct growth:** grows with session count (<100 users → trivial). Prune rows older than the `settings.retention_months` with a monthly `DELETE … WHERE acctstoptime < now() - interval '24 months'` (pg_cron/Vercel cron).
- **Orphaned sessions** (Pi reboot mid-session): `accounting_on_query` closes them on NAS-reboot accounting; worst case they linger until then.
- **Failover:** a second Pi (or future small VPS) with its own `clients.conf` + a second `/radius` entry on the router gives active/standby auth. Both query the same DB; no state to sync.
- **Clock:** RADIUS is time-sensitive; the Pi needs NTP (`timedatectl set-ntp true`).
- **Security checklist:** shared secret ≥ 32 random bytes; UDP 1812/1813 only from the router IP (firewalld: `firewall-cmd --add-rich-rule='rule family=ipv4 source address=192.168.88.1/32 port port=1812-1813 protocol=udp accept'`); Pi has no WAN access requirement beyond outbound 5432 to Supabase; DB role is SELECT-mostly as above; `use_tunneled_reply` not used (no EAP) — PAP/CHAP only.
- **What Option A still doesn't do:** it cannot revoke an already-connected user whose *other* device logs in beyond the limit until the second Access-Request arrives (Simultaneous-Use is checked at login), and it cannot distinguish devices behind one MAC — TTL'd hotspot cookies are your friend there.

## Rollback

On the router: `/radius set [find comment="wavly-radius"] disabled=yes` → Option B behavior resumes (portal sync). Nothing else to undo; DB role can stay (unused).
