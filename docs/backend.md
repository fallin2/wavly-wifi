# Wavly WiFi — Backend (Phase 5)

Next.js (App Router, TypeScript) on Vercel; Supabase Postgres. Mobile-first JSON API for the portal (Phase 6), admin (Phase 6), the MikroTik (Option B sync), Paystack webhooks, and Supabase pg_net / Vercel Cron.

## API surface

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | — | DB ping + outbox depth (503 on DB failure) |
| `GET /api/plans` | — | Active plans for the buy screen |
| `POST /api/auth/otp/request` | rate-limited | Create 6-digit OTP (3/10min/phone, 20/h/IP), SMS via Arkesel |
| `POST /api/auth/otp/verify` | rate-limited | Verify OTP → find-or-create customer → session cookie (30 d, httpOnly, SameSite=Lax) |
| `POST /api/auth/logout` | — | Destroy session |
| `GET /api/me` | customer | Customer + subscriptions + hotspot username |
| `POST /api/payments/charge` | customer | Initiate MoMo charge (or card via hosted checkout). Amount from DB plan — never the client |
| `GET /api/payments/verify` | customer | Poll Paystack server-to-server → same idempotent activation (fallback if a webhook is missed) |
| `POST /api/webhooks/paystack` | HMAC-SHA512 | Raw-body signature verify; `charge.success` → idempotent activation; `charge.failed` → mark failed; always 200 post-signature |
| `POST /api/vouchers/redeem` | customer | Hash-check code, lock row, burn it, activate voucher subscription |
| `POST /api/admin/auth/login` | rate-limited | Password → `totp_required` (or forced TOTP enrollment on first login) |
| `POST /api/admin/auth/confirm` | pending token | Complete 2FA (or enrollment) → 12 h admin cookie |
| `POST /api/admin/auth/logout` | — | Destroy admin session |
| `POST /api/admin/vouchers/batch` | owner/admin | Generate ≤5000 codes (WAV-XXXX-XXXX-XXXX), store sha256 + last4, **one-time CSV response**, audit-logged |
| `GET /api/admin/vouchers` | admin+support | List vouchers (filters) + batch stats |
| `POST /api/admin/vouchers/[id]/disable` | owner/admin | Disable an unused voucher |
| `POST /api/admin/plans` | owner/admin | Create a plan, or update it when `id` is passed (audit-logged) |
| `POST /api/admin/users/set-status` | owner/admin | `active` / `suspended` / `banned` + router kick/disable via outbox; reinstate re-pushes creds |
| `POST /api/admin/users/extend` | owner/admin | Add N hours to the current active subscription (never moves money) |
| `POST /api/admin/users/resync` | admin+support | Re-push hotspot credentials for the active subscription (support tool) |
| `POST /api/admin/payments/refund` | owner/admin | Two-phase: Tx A locks the payment row, inserts a `pending` refund row and reserves the amount; Paystack is called outside any DB transaction; Tx B marks the refund `success` (+ suspends the entitlement on full refund) or rolls the reservation back exactly on failure |
| `GET /api/admin/reports/export` | admin+support | CSV exports: `kind=revenue_daily\|payments\|customers\|vouchers` (capped at 10–20k rows) |
| `GET /api/me/hotspot` | customer | Hotspot username/secret for the authenticated device (feeds the auto-connect form) |
| `GET /api/router/sync` | `X-Router-Key` | **Wire Format v1** claim+encode of ≤60 pending outbox ops (`FOR UPDATE SKIP LOCKED`) |
| `POST /api/router/usage` | `X-Router-Key` | Per-session byte counters → deltas → `usage_records`, `data_bytes_used`, devices upsert, cap-crossing → `kick` |
| `GET /api/cron/expire` | `CRON_SECRET` | Mark due subs expired, enqueue disable+kick, exactly-once "expired" SMS, hygiene deletes |
| `GET /api/cron/reminders` | `CRON_SECRET` | T‑48 h + day-of expiry SMS, exactly-once via `reminder_log` |

## Router entitlement semantics

`enqueueHotspotUpsert` sends `limit-uptime = 0` (no limit). RouterOS counts limit-uptime **cumulatively across all sessions** for the user, so sending hours-remaining at purchase/renewal would wrongly cut a multi-session customer off mid-plan. Time expiry is enforced instead by:

- `GET /api/cron/expire` marking subscriptions `expired` and enqueuing disable+kick, and
- RADIUS `Session-Timeout`/`WISPr-Max-Session-Time` on Option A deployments.

Data caps are enforced by the `/api/router/usage` byte-counter pipeline (cap crossed → `kick` enqueued) and by RADIUS Acct on Option A.

## Environment variables

See [`.env.example`](../.env.example) — `DATABASE_URL`, `ROUTER_SYNC_KEY`, `PAYSTACK_SECRET_KEY`, `ARKESEL_API_KEY`, `CRON_SECRET`, `AUTH_SECRET` (plus `SMS_DEV_LOG=true` in dev → OTP echoed in the response and SMS logged, not sent).

## Money-path invariants (enforced + tested)

1. **Activation only from verified server-side signals** (webhook HMAC or `verify` poll) — never from a browser claim.
2. **Idempotency at the DB**: `subscriptions_payment_uidx` / `subscriptions_voucher_uidx` partial unique indexes. The activation transaction takes the payment row `FOR UPDATE`, flips `pending→success`, inserts the subscription with `ON CONFLICT … DO NOTHING`. Replay ⇒ 0 rows inserted ⇒ exactly one entitlement. Verified by `scripts/test-activation.sql` (1 subscription after replay; renewals stack from current expiry: 15→22→29 Nov test).
3. **Amount is checked against our own `payments` row** inside the activation transaction — a mismatch logs `amount_mismatch` and never activates.
4. **Refunded payments can never re-activate** (refund check precedes activation).
5. **Paystack webhook amount** is sanity-checked the same way (`checkout total == price`, both from us).

## Known bugs found & fixed during Phase 5 testing

- `ON CONFLICT (payment_id) DO NOTHING` does **not** infer from a partial unique index — production activation would have deadlocked every webhook retry. Fixed to `ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING` (proven on embedded PG; captured in `scripts/test-activation.sql`).
- otplib v12 export shape (`authenticator`) and `postgres.js` parameter typing for template fragments (client parameterized as `Record<string, any>`).
- One incorrect test expectation in the wire-format suite (token index of `mac`).

## Running

```bash
npm install
cp .env.example .env.local   # fill in; SMS_DEV_LOG=true echoes OTP
npm run dev                  # http://localhost:3000
npm test                     # 19 unit tests
npx tsc --noEmit && npm run build
```

Provisioning against a live Supabase project (not yet run): create project → apply `supabase/migrations/0001…0004` + `0002_rls.sql` → `seed.sql` → `create-admin.mjs` → set env vars → deploy (Phase 7).

## Cron cadence

`vercel.json` ships **daily** cron entries (Hobby-plan legal) hitting both routes at 09:00 GMT. For 5-minute expiry precision, call `/api/cron/expire` from Supabase `pg_cron + pg_net` every 5 minutes with `Authorization: Bearer $CRON_SECRET` (exact SQL in the Phase 7 deployment guide). Exactly-once semantics make double-firing harmless.
