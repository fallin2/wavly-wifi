# Wavly WiFi — Database Schema (Phase 2)

Target: Supabase Postgres (PG 15). Files: [`supabase/migrations/0001_schema.sql`](../supabase/migrations/0001_schema.sql), [`0002_rls.sql`](../supabase/migrations/0002_rls.sql), [`supabase/seed.sql`](../supabase/seed.sql).
**Validated** against an embedded PostgreSQL with `ON_ERROR_STOP=1`: migrations + seed apply cleanly, activation-flow smoke test passes, idempotent double-activation is rejected by `subscriptions_payment_uidx`, RLS verified on all 21 tables, and a least-privilege role with `GRANT SELECT` sees **0 rows**.

## ER diagram

```
                        ┌─────────────┐
                        │  settings   │  (singleton)
                        └─────────────┘
 ┌────────────┐   1   ┌─┴──────────────┐   1   ┌──────────────────┐
 │ admin_users│───────┤ audit_log (*)  │       │     agents       │ (phase 2: voucher resellers)
 │   (N)      │       │  append-only   │       └───────┬──────────┘
 └────────────┘       └────────────────┘               │ 1
                                                       │ N
 ┌────────────┐  1  ┌───────────────┐  1  ┌──────────────┴───────┐
 │ customers  │─────│   hotspot_    │     │   voucher_batches    │
 │            │  1  │  credentials  │     └──────────┬───────────┘
 │            │     └───────────────┘                │ 1
 │            │                                      │ N
 │            │     ┌───────────────┐                │
 │            │────►│ subscriptions │◄────── vouchers (N)
 │            │ N   │               │
 │            │     └──────┬────────┘
 │            │ 1          │ N (payment_id, unique)   ▲
 │            │            ▼                           │
 │            │     ┌───────────────┐           subscriptions.voucher_id (unique)
 │            │────►│   payments    │
 │            │ N   │  (source of   │───────► payment_events (N, append-only)
 │            │     │ truth for     │───────► refunds (N)
 │            │     │  activation)  │
 │            │     └───────────────┘
 │            │     ┌───────────────┐      ┌────────────┐
 │            │────►│   devices     │      │ reminder_  │──► subscriptions (exactly-once SMS)
 │            │ N   └───────────────┘      │   log      │
 │            │     ┌───────────────┐      └────────────┘
 │            └────►│   sessions    │  (customer|admin)
 └──────────────────┘               │
                     ┌──────────────┴───────┐
                     │ otps / rate_limits   │  (ephemeral, hashed)
                     ├──────────────────────┤
                     │ hotspot_outbox       │ ──► router pulls (Option B)
                     │ usage_records        │ ◄── router reports bytes
                     │ sms_log              │
                     └──────────────────────┘
```

## Table dictionary

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `settings` | Singleton config (id=1): business info, device limits, MAC-binding toggle, OTP TTL, privacy notice text/hash for DPA audit | `id` CHECK (id=1) |
| `admin_users` | Admin logins; bcrypt hash; TOTP 2FA; lockout after failed attempts | `username` slug-checked; `role` owner/admin/support |
| `agents` | Phase-2 voucher resellers with per-voucher commission (pesewas) | `phone_e164` unique |
| `customers` | One row per phone number (E.164 `+233…`); soft-delete for DPA erasure; `consent_at` + `consent_text_hash` prove notice acceptance | `phone_e164` unique; `account_status` active/suspended/banned |
| `hotspot_credentials` | Opaque hotspot username + secret pushed to router (PAP requires retrievable secret). Never exposed to UI/API | 1:1 with customer |
| `plans` | Admin-editable catalog; time **and/or** data caps (`CHECK` ≥ one of the two); speed via `mikrotik_profile`; `max_devices` snapshot per plan | `slug` unique |
| `payments` | One row per Paystack charge; success written **only** from verified webhook/verify; `provider_reference` unique = idempotency key | `status` pending/success/failed/abandoned/refunded/partial_refund |
| `payment_events` | Append-only raw provider events + signature validity; dispute evidence | `payment_id` nullable FK |
| `voucher_batches` | Bulk generation; `face_value_pesewas` snapshot; optional `agent_id` commission hook; `expires_at` kills unused stock | `quantity` ≤ 5000 |
| `vouchers` | Codes stored as **sha256 hashes only** (`code_last4` for support lookups); CSV shown once at creation | `code_hash` unique |
| `subscriptions` | Entitlement; `payment_id`/`voucher_id` unique ⇒ one entitlement per payment/voucher (double-activation impossible); `expires_at`/`data_bytes_cap` snapshot plan at purchase | partial unique indexes |
| `sessions` | Opaque cookies, sha256 at rest; typed customer/admin with CHECK | `expires_at` indexed |
| `otps` | 6-digit codes, sha256 only; attempts counter; expiry | |
| `rate_limits` | Fixed-window buckets keyed `action:scope:value:window`; serverless-safe | |
| `hotspot_outbox` | Option B command queue (`upsert/enable/disable/kick`). Router claims via `FOR UPDATE SKIP LOCKED`; kept for audit | partial index on pending |
| `usage_records` | Router byte counters, append-only; feeds "top users" + data-cap enforcement | high-volume: see scaling note |
| `refunds` | Partial/full refunds against a payment; `created_by` → admin | |
| `reminder_log` | `unique(subscription_id, kind)` ⇒ exactly-once expiry reminders | |
| `sms_log` | Delivery audit; body previews never contain OTP digits | |
| `devices` | Seen/bound MACs; per-customer MAC binding; `blocked` flag | `unique(customer_id, mac)` |
| `audit_log` | Append-only admin/system actions with before/after JSON | no UPDATE/DELETE in app code |

## Key flows

**Payment activation (idempotent):**
1. `INSERT payments (status='pending', provider_reference='wavly-…')` when charge is initiated.
2. Paystack webhook (`charge.success`) or server-side `verify` → in **one transaction**: verify HMAC → `UPDATE payments … status='success' WHERE provider_reference=$1 AND status='pending'` (0 or 1 row) → `INSERT subscriptions (source='payment', payment_id=…)` — second insert violates `subscriptions_payment_uidx` on replay ⇒ rolled back ⇒ no double activation. Enqueue `hotspot_outbox (op='upsert')` in the same transaction.
3. Every step writes `payment_events`; disputes are replayable evidence.

**Voucher redemption:** `SELECT … FOR UPDATE` on voucher by `code_hash`; must be `unused` (and batch unexpired); `UPDATE vouchers SET status='redeemed'`; `INSERT subscriptions (source='voucher', voucher_id=…)` — `subscriptions_voucher_uidx` blocks twins; enqueue outbox `upsert`.

**Expiry sweep (pg_cron / Vercel Cron):** mark `subscriptions` with `expires_at < now()` as `expired`; enqueue `disable`/`kick` per hotspot username; select `v_expiring_subscriptions` at T‑48h → insert `reminder_log` (unique ⇒ no dup) → SMS.

## RLS posture

All tables have RLS **enabled with zero policies** ⇒ anon/authenticated get nothing. Server uses the **service-role** key (bypasses RLS); never shipped to the browser. Verified in-sandbox with a granted-`SELECT` role seeing 0 rows.

## Notes & trade-offs

- **Hotspot secrets in DB:** RouterOS PAP can't validate bcrypt hashes, so `hotspot_credentials.secret` is plaintext-at-rest (standard for hotspots; protect DB access, rotate on suspicion). RADIUS (Phase 4, Option A/C) can hash instead — documented there.
- **Data-cap enforcement granularity** on Option B ≈ sync interval (bytes reported per poll). On Option A, `MikroTik` reply attrs enforce at the router — better.
- **Device limit on Option B** = hotspot profile `shared-users` (concurrent sessions) + optional MAC pin for 1-device plans. Per-device MAC blocking needs RADIUS (`Calling-Station-Id`) → Phase 4.
- **`usage_records` growth:** ~17k rows/month at 100 users syncing hourly; partition by month or fold into `daily_rollup` when > 1M rows. Bookmarked, not built yet.
- **Timezone:** views use `Africa/Accra`; app code reads `settings.timezone`.
- **RADIUS tables** (`radcheck/radreply/radacct`) are **not** created here; Phase 4 (if Option A/C) adds `0003_radius.sql`.
