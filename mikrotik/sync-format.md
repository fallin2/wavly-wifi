# Wavly WiFi — Sync Wire Format v1 (portal ↔ router)

The router pulls pending work from the portal; nothing connects inbound to the site.
This is the **contract** the Phase 5 backend (`/api/router/sync`) must implement exactly.

## Endpoint

```
GET https://<portal-host>/api/router/sync
Headers:
  X-Router-Key: <shared secret>        # constant-time compared; else HTTP 401
  X-Router-Name: mikrotik-nkawie-1     # free-form node id, appears in logs
  Accept: text/plain
Response (200, text/plain, max 16 KB):
  the token stream described below — and nothing else.
Errors:
  401 bad key | 429 rate-limited | 5xx transient (router keeps last good state)
```

## Token stream

Single line, no whitespace or newlines. Fixed **6-token records**, comma-separated.
`-` encodes an "empty" field. A field never contains a comma.

```
<op>,<f1>,<f2>,<f3>,<f4>,<f5>[,<op>,...]
 op   = 1 upsert | 2 enable | 3 disable | 4 kick
```

| op | f1 | f2 | f3 | f4 | f5 | meaning |
|----|----|----|----|----|----|---------|
| 1 | username | secret | profile | limit_uptime_min | mac_or_dash | create/update hotspot user. `limit_uptime_min` = minutes from first login (`0` = no limit). `mac_or_dash` = pinned `aa:bb:cc:dd:ee:ff` or `-`. |
| 2 | username | – | – | – | – | enable user |
| 3 | username | – | – | – | – | disable user |
| 4 | username | – | – | – | – | drop active sessions (implies nothing else) |

Example stream: `1,wlx7kq2ab9,mnkdslqxbcaf7gyehz2w,wavly-std-5m,10080,-,3,wlx1p0qa42,,,,,4,wlx8h2m4n7,,,,`

## Field constraints (enforced by the portal generator)

- `username`: `^[a-z0-9]{6,32}$` (portal generates `wl` + base32)
- `secret`: `^[a-z2-7]{20}$` (zero-entropy-looking, commas impossible)
- `profile`: `^wavly-[a-z0-9-]{1,40}$`
- `mac_or_dash`: lowercase hex with colons, or `-`
- `limit_uptime_min`: integer ≥ 0

## Claiming semantics

`/api/router/sync` selects pending outbox rows (oldest first, max 60 records),
**atomically** marks them `sent` (`UPDATE ... SET status='sent', attempts=attempts+1, sent_at=now() WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`)
and emits them. The router applies best-effort; permanent failures are visible via
`/api/router/sync?check=1` (Phase 5: returns last-seen-op-id) and by the account page
"still preparing your connection? refresh" hint. Admin "Re-sync" re-enqueues an `upsert`.

## Usage reporting (router → portal)

```
POST https://<portal-host>/api/router/usage
Headers: X-Router-Key, X-Router-Name
Body (text/plain): per line — <mac>,<username>,<bytes_in>,<bytes_out>,<uptime_s>
Router-side counters are cumulative; portal computes deltas and feeds usage_records / subscriptions.data_bytes_used.
```

## Self-test

Phase 5 ships `GET /api/router/sync?selftest=1` (same key) returning a canned stream
(one upsert of user `selftest01`). `mikrotik/sync-scheduler.rsc` logs what it would do
when `selftest=yes` is set in the script config — dry-run mode for lab verification.
