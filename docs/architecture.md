# Wavly WiFi — Architecture & Tech Stack (Phase 1)

**Business:** Wavly WiFi (working title), Nkawie, Ghana — prepaid public Wi‑Fi resold over a Starlink Mini uplink.
**Scale target:** < 100 concurrent users at launch; design headroom to ~1,000+ without re-architecture.
**Hosting preference (from owner):** Vercel + Supabase. **Payments:** Paystack. **SMS:** Arkesel. **RouterOS:** v7.
**Currency:** GHS (GH¢). Prices stored in **pesewas** (integer minor units) everywhere.

---

## 1. The one hard constraint, and how the design deals with it

Starlink (and Starlink Mini) puts you behind **Carrier-Grade NAT (CGNAT)**: your site has **no routable public IP**, so **nobody on the internet — not Vercel, not Paystack, not you — can initiate a connection to the router**. A classic "hotspot + cloud RADIUS on a public IP" design works (router dials *out* over UDP 1812), but a serverless portal cannot listen on UDP 1812 at all, and Vercel/Supabase cannot reach into the LAN.

Everything that needs to cross the "site ↔ internet" boundary must therefore be **outbound from the site**:

| Flow | Direction | Works through CGNAT? |
|---|---|---|
| Browser → portal (HTTPS) | outbound | ✅ |
| Paystack → portal webhook (HTTPS) | inbound to Vercel | ✅ (Vercel has a public IP; no path to the *router* needed) |
| Portal → Supabase Postgres | outbound (TLS 6543) | ✅ |
| Router → portal sync API (HTTPS) | outbound | ✅ |
| Router → on-prem FreeRADIUS (UDP 1812/1813) | LAN | ✅ (never leaves the LAN) |

Because of this, the **enforcement layer** (what actually connects/disconnects users and enforces speed limits) has two viable shapes on our hosting choice. This is the single decision you need to confirm at the end of this phase (see §7).

---

## 2. Architecture diagram

```
                          ┌──────────────────────────── INTERNET ────────────────────────────┐
                          │                                                                   │
   ┌──────────┐   WiFi    │   ┌─────────────┐   DNS/HTTPS    ┌──────────────────────────┐   │
   │ Customer │◄──────────┼─► │  Starlink   │◄───────────────►│  PORTAL (Vercel)         │   │
   │ phone    │           │   │  Mini       │  (NAT out)     │  Next.js: portal + admin │   │
   └────┬─────┘           │   └──────┬──────┘                │  + /api (webhooks, cron) │   │
        │                 │          │                       └───────┬─────────────┬───┘   │
        │ captive portal  │   ┌──────┴──────┐                          │ SQL/TLS     │     │
        │ redirect        │   │ MIKROTIK    │   outbound HTTPS          ▼             │     │
        ▼                 │   │ Hotspot GW  │────────────────────►  ┌─────────────┐  │     │
   (login page)           │   │ RouterOS v7 │  every 30–60 s        │  SUPABASE   │  │     │
        │                 │   │             │  /api/router/sync     │  Postgres   │  │     │
        │ POST /login     │   │  local      │                       │  (+RLS,     │  │     │
        └────────────────►│   │  hotspot DB │                       │  backups)   │  │     │
                          │   └─────────────┘                        └──────▲──────┘  │     │
                          │                                                  │        │     │
                          │   Paystack ──webhook(HMAC)──► portal /api/webhooks/paystack ◄──┘     │
                          │   Arkesel  ◄── portal (OTP / receipts / reminders)          │
                          └───────────────────────────────────────────────────
```

**Option A — add an on-prem RADIUS box (upgrade path):**

```
  MIKROTIK  ── UDP 1812/1813 (LAN) ──►  FreeRADIUS (Pi/PC on LAN)  ── TLS/SQL 6543 ──►  SUPABASE
```

**Login sequence (Option B — zero extra hardware):**
1. Phone joins SSID `WavlyWiFi`; RouterOS hotspot intercepts HTTP, serves custom `login.html` (or walled-garden-redirects to `https://<portal>/login` carrying `mac/ip/link-login-only`).
2. Portal: sign in with phone + SMS OTP, redeem voucher, or pick a plan. **MoMo:** portal calls Paystack `transaction/charge` (mobile_money) → customer gets USSD prompt → approves → **Paystack webhook** hits Vercel `api/webhooks/paystack` → signature + amount verified → idempotent `activate_subscription()` in Postgres → plan row + outbox row.
3. Router's 30–60 s scheduler script pulls pending ops from `/api/router/sync` (newline-less flat payload, shared-secret auth): e.g. `add,user,pass,profile,limituptime;dis,user;kick,user`. It upserts `/ip/hotspot/user`, sets rate-limit profile, and removes active sessions of expired/suspended accounts.
4. Portal's post-payment page auto-submits the hotspot `link-login` form to the router; internet starts. Account page shows plan, expiry, data used (router byte counters via sync), receipt, renew button.
5. Expiry: reservation on payment sets `expires_at`; `pg_cron`/Supabase job marks expired subscriptions and enqueues `kick,<user>` ops; reminders fire SMS at T‑2 days and on expiry day (Ghana time).

**Login sequence (Option A — on-prem RADIUS):** same 1–2; step 3 replaced by FreeRADIUS `rlm_sql_postgresql` querying the same Supabase DB at Access-Request time; expiry enforced *in-session* via `Session-Timeout`; rate limit via `MikroTik-Rate-Limit` reply attribute. No polling delay.

---

## 3. Final tech stack & why

| Layer | Choice | Why (short version) |
|---|---|---|
| Portal + admin + API | **Next.js (App Router, TypeScript) on Vercel** | You asked for Vercel; serverless functions fit bursty hotspot traffic; RSC/minimal JS keeps pages tiny for slow 2G/3G links; one language front-to-back. |
| Alternative considered | Django + templates | Stronger batterings-included admin, but weaker serverless story on Vercel, heavier to scale cold, second language stack. Next.js wins on your hosting constraint. |
| Database | **Supabase Postgres (managed)** | You asked for Supabase; Postgres is battle-tested; gives us backups, pooler (port 6543) for serverless, RLS, and `pg_cron`/`pg_net` for background jobs without extra infra. |
| Payments | **Paystack** (MoMo + card fallback) | Best-documented GH provider, GHS currency, MTN/Telecel/AT MoMo charge API + signed webhooks (`x-paystack-signature`, HMAC‑SHA512) + test mode. Amounts in pesewas; activation only on webhook/verify, never from client claims. |
| SMS | **Arkesel** | Ghana-local, simple REST, sender-ID support; used via a tiny `lib/sms` adapter so swapping provider later is a 1-file change. Dev mode logs OTP to console instead of sending. |
| AuthN (customers) | Phone + OTP, no passwords | No passwords to breach/phish; Ghana DPA data-minimalism; SMS OTP is the local norm. `jose` HS256 session cookies, httpOnly, SameSite=Lax, 30-day sliding. |
| AuthN (admin) | Username+password (bcrypt) + **TOTP 2FA** (`otplib`) | Meets the "password-protected with 2FA" requirement; TOTP works offline. |
| Rate limiting | Postgres-backed token buckets | Serverless has no durable memory; DB counters work across instances; router/sync endpoint additionally keyed by router secret + IP. |
| Background jobs | **Supabase `pg_cron` + `pg_net`** → calls Vercel cron routes with a secret header | Vercel Hobby crons run only daily; pg_net can fire every 5 min for the expiry-kicker and reminders. Vercel Cron daily remains as a fallback. |
| E2E plumbing | `pg` (node-postgres), `postgres` SSL, raw SQL + migrations in repo (`supabase/migrations/`) | No ORM magic over a schema this size; migrations are reviewable SQL. |
| Admin UI | Same Next.js app under `/admin`, role-gated | No second deployable; shared components, separate session cookie + 2FA gate. |
| Secrets | Vercel env vars (encrypted), Supabase Vault for DB-side secrets | Nothing secret in git; `.env.example` documents required keys. |
| Source control | This repo (`arena/d5158735-wavly-wifi`) | CI via GitHub Actions later: lint + typecheck + test on push. |

**What we deliberately did NOT choose:** Stripe (no GHS MoMo), Firebase (locks you into Google, worse Postgres), a monolithic VPS (your constraint), SQLite (not serverless-safe), client-side payment confirmation (insecure), Supabase Auth phone OTP (Twilio-class carriers only; Arkesel is Ghana-native).

**Sizes (estimate):** portal landing ~35–45 KB gzipped, zero client framework for content pages; admin loads more but is admin-only.

---

## 4. Enforcement options compared (router ↔ portal link)

| | **Option A — on-prem FreeRADIUS** | **Option B — RouterOS outbound sync** | **Option C — cloud FreeRADIUS on tiny VPS** |
|---|---|---|---|
| Extra hardware | Pi/old PC on site (~GH¢0–600) | None | None (US$4–6/mo VPS) |
| Activation latency after payment | Instant (next login/Access-Request) | ≤ one sync interval (30–60 s) for MoMo; **instant** for pre-seeded vouchers | Instant |
| Mid-session expiry | ✅ `Session-Timeout` at login | ⚠️ Kicked by ≤1-min kicker job | ✅ `Session-Timeout` |
| Rate limits / data caps | ✅ RADIUS reply attrs (verify dict on your build) | ✅ Hotspot profiles + `limit-bytes-*` on `/ip hotspot user` | ✅ same as A |
| Complexity | Medium (FR config, but standard) | Low | Medium |
| Honors "Vercel + Supabase only" | Yes (DB only) | Yes (nothing else) | No (one VPS) |
| Best for | Scale-out; best practice | Launch this month; zero cost | If A impossible and sync feels too hacky |

**Recommendation:** **Option B now**, behind an `enforcement` adapter (`lib/enforcement/routerOsSync.ts`) so we can add `radiusSync.ts` (Option A/C) later **without schema changes**. The data model stores entitlements (plan → expiry/bytes/rate); the adapter is a dumb courier. If you have any spare PC/Pi on site, say so at the gate and we'll do **Option A from day one** — it is strictly better.

Voucher trick (both options): vouchers are batch-created **in advance** as hotspot users with `limit-uptime` from first login → redemptions connect instantly even on Option B.

---

## 5. Reliability & offline behavior (Starlink is the bottleneck)

- **Payments fail closed:** no webhook/verify confirmation ⇒ no activation. Ledger (`payments`, `payment_events`) is the source of truth; client never tells us it paid.
- **Portal unreachable:** RouterOS `login.html` ships a static fallback (portal offline banner + still allows already-active users whose session is valid).
- **Sync endpoint unreachable:** router keeps last-known state; users already connected stay up; kicker/reminders queue in Postgres and drain when link returns (pg_net retries). Acceptable & documented.
- **Supabase backups:** daily (Pro plan) or scheduled `pg_dump` to object storage; PITR if you upgrade; quarterly restore drill on the checklist.
- **Starlink CGNAT:** no inbound ports opened; router attack surface unchanged; sync API is authenticated, rate-limited, and read-only-ish (issues commands only to *its own* hotspot table).
- **Degraded MoMo/webhook:** account page polls `api/payments/verify` (which calls Paystack server-side) — same idempotent activation path as the webhook, so a missed webhook never strands a payer.

## 6. Data Protection Act 2012 (Act 843) posture

Collect only: phone number (primary key of identity), optional display name, plan/payment history, MAC addresses (declared in notice). **No** GPS, contacts, browsing content (hotspot sees domains only in logs — we don't log URLs). Portal shows a privacy notice + link; we state retention (24 months), purpose (authentication, billing, fraud/abuse prevention), and how to request erasure/export (admin tool + email). Passwords n/a; secrets hashed; TLS everywhere. Business should register as a data controller with Ghana's Data Protection Commission — flagged for the deployment phase.

## 7. Confirm this at the gate

1. **Enforcement:** Option B (recommended for launch, zero hardware) or is there a spare Pi/PC for Option A now?
2. **Supabase project:** none exists yet — OK to create one (`wavly-wifi`, region closest to Accra — likely `eu-west-1`/`eu-central-1`/`af-south-1`) in Phase 2/5? Free vs Pro plan (Pro = daily backups, no pause-on-idle)?
3. **Domain:** do you own one yet (e.g. `wavly.com.gh`)? Phase 7 needs it for Vercel + walled garden; otherwise I'll use the free `*.vercel.app` for MVP and document the domain step.

## 8. Phasing (what each gate builds)

| Phase | Delivers | Your deliverable # |
|---|---|---|
| 1 ✅ this doc | Architecture + stack decision | 1 |
| 2 | Full DDL + indexes + RLS + `supabase/migrations/` + seed plans + ER notes | 2 |
| 3 | RouterOS v7: hotspot, walled garden, profiles, sync scheduler script, byte-counter reporting, runbook | 3 |
| 4 | FreeRADIUS pack (only if Option A/C): `radiusd.conf`, `clients.conf`, `sites-available/default`, `rlm_sql_postgresql`, schema | 4 |
| 5 | Backend code: OTP auth, sessions, plans CRUD, Paystack charge/webhook/verify + **idempotency tests**, voucher batches, Arkesel adapter, cron (reminders/kicker) | 5 |
| 6 | Portal pages (login/buy/account/renew/expired) + admin dashboard (KPIs, users, plans, vouchers, payments, CSV export, 2FA) | 6 |
| 7 | Deployment guide: Supabase create/migrate, Vercel deploy, domain+SSL, router onboarding, CGNAT notes, backups | 7 |
| 8 | Testing checklist + MVP→full rollout plan | 8 |
