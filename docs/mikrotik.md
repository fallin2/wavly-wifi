# Wavly WiFi — MikroTik Runbook (Phase 3)

RouterOS **v7**. Hardware-agnostic (hAP ac², RB951, CCR…). I could not execute these on live hardware in this environment — every step below is paired with the exact verification command to run on-site. Bring a laptop + console cable for the first session; Starlink power cycle order matters (power MikroTik **after** Starlink syncs).

## Files in this folder

| File | Purpose |
|---|---|
| `setup.rsc` | One-shot base config: WAN/DHCP/NAT/firewall, hotspot profiles, hotspot server, walled garden, (disabled) RADIUS client |
| `login.html` | Replacement hotspot login page → instant redirect to the portal |
| `wavly-sync.rsc` | Outbound sync worker (Wire Format v1). Import manually to test; `selftest="yes"` parses without applying |
| `sync-scheduler.rsc` | Creates the 45 s scheduler that runs `wavly-sync.rsc` |
| `usage-report.rsc` | POSTs cumulative byte counters to the portal every 5 min; creates its scheduler |
| `sync-format.md` | **The portal↔router contract.** Phase 5 backend implements this verbatim |

## 0. Before you start

- RouterOS v7 (`/system resource print` → version 7.x). If it reports v6, stop — different hotspot/fetch syntax.
- Default MikroTik config present (bridge, defconf firewall) is fine; the script disables defconf fasttrack (it bypasses queues and breaks speed limits — non-negotiable for this design).
- Starlink Mini ethernet → `ether1`. LAN (wlan + ethers) on bridge `bridge-hotspot`.
- Replace every `portal.REPLACE-ME.example` with your real portal host (both in `setup.rsc` and `login.html`).
- `ROUTER_SYNC_KEY` — generate a 40+ char random string; you'll set the same value as `ROUTER_SYNC_KEY` in Vercel (Phase 5/7). Paste it into `wavly-sync.rsc` / `usage-report.rsc`. Treat it like a password; the router has no read-only API surface for it, and nothing inbound is exposed.

## 1. Upload files

WinBox/WebFig → **Files**, upload: `setup.rsc`, `wavly-sync.rsc`, `sync-scheduler.rsc`, `usage-report.rsc`, `login.html`.
Or SCP: `scp * user@192.168.88.1:` — filenames must match (`/import` is case-insensitive on some builds; keep lowercase).

## 2. Edit config

Open `setup.rsc` in the Files list (or via `/import dry-run`, if your build supports it) and set `wanif`, `lanif`, subnet/pool if 192.168.88.0/24 collides with your LAN, `dnsA/dnsB`, and `portalHost`. Same for the URL/key in `wavly-sync.rsc` / `usage-report.rsc`.

## 3. Import base config

```
/import file-name=setup.rsc
```

Expected output ends with the “base config imported” line. It does **not** create any hotspot users yet (the portal does that).

## 4. Install the hotspot redirect page

Copy `login.html` over the built-in one: **Files → hotspot folder** — replace or, safer, back up the old file first (`/file copy` or rename to `login.html.bak`). The hotspot serves it to every pre-auth HTTP request; it forwards the phone to the portal with `mac/ip/link-login-only` in the query string. HTTPS requests to random sites will show a cert warning before the redirect — that is inherent to captive portals; the portal itself is always HSTS-clean.

## 5. Test the sync path (dry-run)

1. Set `selftest="yes"` in `wavly-sync.rsc`, re-upload.
2. `/import file-name=wavly-sync.rsc` → you should see `selftest would apply: …` lines or a clean “empty response” / “HTTP 401/5xx” (401 = wrong key; 5xx = portal not deployed yet — expected until Phase 7).
3. Set `selftest="no"`, re-upload.

## 6. Schedule it + usage reporting

```
/import file-name=sync-scheduler.rsc
/import file-name=usage-report.rsc
```

## 7. Verification checklist (run these)

| # | Command | Expect |
|---|---|---|
| 1 | `/ip hotspot print` | `wavly-hotspot`, interface `bridge-hotspot`, disabled=no |
| 2 | `/ip hotspot user profile print` | `wavly-basic-3m`, `wavly-std-5m`, `wavly-prem-10m` with correct `rate-limit`, `shared-users` |
| 3 | `/ip hotspot walled-garden print` | portal domain + `*.paystack.*` rows present |
| 4 | `/ip firewall filter print stats chain=input` | `wavly-input-drop-rest` counter OK; no unexpected allows |
| 5 | `/ip firewall filter print where comment~"fasttrack"` | disabled=yes |
| 6 | `/system scheduler print` | `wavly-sync` (45 s), `wavly-usage` (5 m) |
| 7 | Join SSID on a phone | Redirect to portal within ~10 s; portal loads **before** any paid access |
| 8 | Create/enable a test user from the DB (Phase 5 admin “Re-sync”), wait ≤ 45 s | `/ip hotspot user print` shows it; login works at the portal auto-connect step |
| 9 | Speed test the three profiles (`speedtest.net` or `fast.com`) | ≈3 / 5 / 10 Mbps down. If a profile is off by 2×, check the rx/tx order and adjust `rate-limit="<up>/<down>"`. |
| 10 | `/ip hotspot active print detail` | Sessions listed with `bytes-in/bytes-out` (else usage reporting is a stub and you lose data-cap enforcement — flag it) |
| 11 | Power-cycle router | Hotspot returns, scheduler restarts (`start-time=startup`), Starlink re-routes |

## 8. Rollback

```
/system scheduler remove [find name~"wavly-"]
/ip hotspot walled-garden remove [find comment="wavly-wg"]
/ip hotspot remove [find name="wavly-hotspot"]
/ip hotspot user profile remove [find name~"wavly-"]
/ip hotspot profile remove [find name="wavly-hs-profile"]
/ip firewall filter remove [find comment~"wavly-"]
/ip firewall nat remove [find comment="wavly-masquerade"]
```
…and restore `login.html.bak`. Existing paying users are unaffected (their sessions drop; they re-login via the stock page flow).

## 9. Troubleshooting

**Portal never loads on connect** → (a) walled garden entry for the portal domain missing/typo; (b) portal host unreachable from router — test `/tool fetch url=https://<portal>/login output=none`; (c) `login.html` not replaced — check `/file print where name~"login"` and the hotspot `html-directory`.

**Users pay but can't get online** → portal can't reach the router by design; the sync only pushes `upsert`. Check: correct `ROUTER_SYNC_KEY` on both sides; `/file print file-name=wavly-sync-last.txt` (or `print` the file contents) shows recent `applied=`; `/log print where message~"wavly-sync"`. If 401: key mismatch. If applied>0 but user still can't log in: confirm the hotspot user exists and is `enabled=yes`, and that the phone finished the auto-connect form (it posts `username/password` to the router over the hotspot LAN address).

**TLS check failures in wavly-sync.rsc** → your RouterOS build lacks ISRG Root X1. Either `/tool fetch url=... check-certificate=yes` (syntax check only) or import the Let’s Encrypt root: `/certificate import` (fetch ISRG Root X1 from letsencrypt.org on a laptop, upload, import). Do **not** ship `check-certificate=no` on a production credential path.

**Speeds don't match plan** → rx/tx order in `rate-limit` (MikroTik: upload first). Also confirm the phone re-logged after plan change (profiles apply at login), and no `fasttrack` rule survives.

**Data caps not enforcing** → on Option B, caps are enforced within ~5 min by the portal kicking the user over the cap (usage-report → `subscriptions.data_bytes_used` → outbox `kick`). For hard real-time caps, that's Option A/RADIUS territory (Phase 4).

**Starlink drops for hours** → users already online stay online until expiry/kick; new logins and payments show “service temporarily unavailable” gracefully (payment fails closed). Router state persists; nothing to resync beyond the outbox queue, which drains automatically.

## 10. Known limitations (honest list)

1. Per-device MAC pinning works for single-device plans via the `mac-address` field on the hotspot user (first-login pinning). Multi-device plans enforce **concurrent session count** (`shared-users`), not per-device identity — per-device identity needs RADIUS (`Calling-Station-Id`), Phase 4.
2. Kick granularity for expiry is ≤ 45 s; data-cap kick ≤ ~5 min.
3. I could not lint these scripts with a RouterOS interpreter — expect one or two version-specific property names to complain on import; each is wrapped in `:do on-error` with a printed hint, and none blocks the rest of the file.
4. `bytes-in/bytes-out` on `/ip hotspot active` vary by build — check verification #10.
