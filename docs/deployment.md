# Wavly WiFi — Deployment (Phase 7)

Status as of commit `5289724` (this branch): **Supabase is live and provisioned; Vercel deploy is blocked on token permissions (see below).** This guide is the runbook for finishing the deployment and for the go-live checklist.

## What is already done

| Item | State |
|---|---|
| Supabase project | `wavly-wifi` — ref `ddbvjikeujgezrcaorop`, region **eu-west-1** (af-south-1 not available on the free plan), org `zdcltwaacpjicgxgtuxl` ("fallin2's Org") |
| Schema | migrations `0001_schema` → `0004_usage_state` applied via connector (incl. reporting views, RLS deny-by-default, updated_at triggers) |
| Seed | 6 example plans (Day Pass ₵5 → Monthly Premium ₵100) + settings singleton row; `support_phone` deliberately **NULL** until you set it |
| Admin user | `owner` (role `owner`) created — **first sign-in forces TOTP enrollment** (Google Authenticator/Authy) |
| Redis/rate limiting | none — Postgres `rate_limits` table (fine at this scale) |
| Secrets | DB password, `AUTH_SECRET`, `CRON_SECRET`, `ROUTER_SYNC_KEY` generated and handed to the owner out-of-band; **never committed to git** |

## Vercel deploy — finishing it (your action)

The connected Vercel token cannot create projects (`Access denied… lacks permission…`, repeated for both team scope `team_jmea…` and personal scope; account is `limited: true`). Two ways forward — pick one:

**Option A — Vercel dashboard (fastest):**

1. vercel.com → **Add New… → Project** → import `fallin2/wavly-wifi` from GitHub.
2. Framework preset: **Next.js** (auto-detected). Root directory: repo root. Build command: default (`next build`).
3. **Production Branch**: `arena/d5158735-wavly-wifi` — `main` contains only the initial README; everything ships on this branch. (Or merge this branch into `main` first and keep the default.)
4. Add the env vars below → **Deploy**.

**Option B — token with project-creation rights:** reconnect Vercel in Arena with a full-scope token, then this exact setup was pre-wired and only `create_project`+`create_deployment` stand between you and a live URL.

### Environment variables (Production + Preview + Development)

| Key | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres.ddbvjikeujgezrcaorop:<DB_PASSWORD>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require` | 6543 pooler, `prepare:false` already handled in `lib/db.ts` |
| `AUTH_SECRET` | provided out-of-band | signs admin pending-login tokens |
| `CRON_SECRET` | provided out-of-band | guards `/api/cron/*` |
| `ROUTER_SYNC_KEY` | provided out-of-band | MikroTik pulls Wire Format v1 ops with this key |
| `SMS_DEV_LOG` | `true` **for staging only** | OTPs are echoed in the API response instead of SMSed — remove (or set to `false`) the moment Arkesel works |
| `ARKESEL_API_KEY` | *not set* | until set, SMS is dev-logged to `sms_log` as `skipped_dev` and no messages are charged |
| `ARKESEL_SENDER` | `WAVLY` | sender ID registered with Arkesel |
| `PAYSTACK_SECRET_KEY` | *not set* | until set, charge/verify/webhook fail closed with a clear server log line — no money can move |

### After the first deploy

1. **Smoke test**: `GET /api/health` → `{"ok":true,...}` (also reports outbox depth).
2. Open the portal → log in with any phone (dev OTP echoed while `SMS_DEV_LOG=true`).
3. `/admin/login` → user `owner` → password from secure handover → **enroll TOTP** on first sign-in (shown once) → you're in the console.
4. Set your real `support_phone`/`support_whatsapp` in the `settings` row (SQL editor: `update public.settings set support_phone = '+233…' where id = 1;`).
5. Point the MikroTik at it (see `docs/mikrotik.md`): walled garden = portal host + `api.paystack.co`; hotspot `link-login-only` = `https://<portal-host>/login`; router scheduler pulls `GET /api/router/sync` every 45 s with header `X-Router-Key`; router posts byte counters to `/api/router/usage`.

## Paystack (you have no keys yet)

1. Register at [Paystack](https://paystack.com) → complete **Ghana business verification** (MoMo acceptance requires it; allow lead time).
2. Settings → API Keys & Webhooks: copy the **test** keys first.
3. Test MoMo charge with Paystack's test phones + test MoMo PIN (see Paystack docs) against the deployed portal.
4. **Webhook**: `https://<portal-host>/api/webhooks/paystack` — subscribe to `charge.success` and `charge.failed`. Our handler verifies `x-paystack-signature` (HMAC-SHA512, raw body) and is idempotent — safe to retry.
5. Go live: swap test keys for live keys in Vercel env → redeploy → re-run smoke tests.

## Arkesel (SMS)

1. Register at [Arkesel](https://app.arkesel.com) → Ghana (`+233`) SMS bundle; register sender ID `WAVLY`.
2. Set `ARKESEL_API_KEY`, set `SMS_DEV_LOG=false` (or delete it) → redeploy → request an OTP and confirm it arrives; check `sms_log`.

## Cron & reminders

`vercel.json` pins both crons to **09:00 UTC daily** (Hobby-plan legal). For production cadence either upgrade to Pro (5-min cron: `*/5 * * * *`) or enable the pg_net 5-minute dispatcher documented in `docs/backend.md` — expiry lag > 24 h means unpaid users keep access until the nightly run.

## Pre-launch checklist (all required before real customers)

- [ ] `SMS_DEV_LOG` removed/`false`; test OTP received by SMS on a real phone
- [ ] Paystack **live** keys; test charge of ₵1 then refunded from `/admin/payments`
- [ ] Webhook receiving (check `payment_events` after a test charge)
- [ ] Router sync pulling every 45 s (`hotspot_outbox` drains; watch `/admin` outbox KPI)
- [ ] Real `support_phone` set; privacy-page "Data controller" line verified
- [ ] **Data Protection Commission registration (Act 843)** — pre-launch legal item; portal privacy notice currently says it's pending, which is the truthful state
- [ ] `owner` TOTP enrolled; second admin created with role `admin`/`support` (never share the owner login)
- [ ] DB password rotated if it was ever shared beyond the owner; Supabase **PITR/backups** decision (free plan = daily backups, 7-day retention — acceptable for launch)
- [ ] Support runbook printed (`docs/llevar.md`/`docs/mikrotik.md` outage section) + escalation contact
