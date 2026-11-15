# wavly-wifi

Captive portal and billing system for Wavly WiFi — a prepaid public Wi‑Fi hotspot in Nkawie, Ghana (Starlink Mini uplink, MTN/Telecel/AirtelTigo MoMo via Paystack, MikroTik RouterOS v7 hotspot, Vercel + Supabase).

Built in phases; see [`docs/architecture.md`](docs/architecture.md) for the full plan.

## Documents

| # | Doc | Status |
|---|---|---|
| 1 | [Architecture & tech stack](docs/architecture.md) | ✅ Phase 1 |
| 2 | [Database schema](docs/schema.md) + [`migrations/`](supabase/migrations/) | ✅ Phase 2 |
| 3 | [MikroTik RouterOS v7 config](mikrotik/) + [runbook](docs/mikrotik.md) | ✅ Phase 3 |
| 4 | [FreeRADIUS pack](freeradius/) + [guide](docs/freeradius.md) (optional Option A) | ✅ Phase 4 |
| 5 | [Backend](docs/backend.md) — OTP auth, plans, Paystack webhooks (idempotent), vouchers, router sync, cron | ✅ Phase 5 |
| 6 | Portal + admin dashboard ([`app/`](app/) — buy/account/redeem + `/admin` console) | ✅ Phase 6 |
| 7 | [Deployment](docs/deployment.md) — Supabase live (ref `ddbvjikeujgezrcaorop`, eu-west-1) + Vercel runbook (token-blocked) | 🟡 Phase 7 in progress |
| 8 | [Testing checklist & rollout plan](docs/rollout.md) | ✅ Phase 8 |

## Conventions

- Currency: GHS, stored as integer pesewas.
- RouterOS: v7 scripts; walled garden covers portal domain + Paystack; router never gets an inbound port.
- No secrets in git — see `.env.example` (added in Phase 5).
