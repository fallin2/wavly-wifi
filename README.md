# wavly-wifi

Captive portal and billing system for Wavly WiFi — a prepaid public Wi‑Fi hotspot in Nkawie, Ghana (Starlink Mini uplink, MTN/Telecel/AirtelTigo MoMo via Paystack, MikroTik RouterOS v7 hotspot, Vercel + Supabase).

Built in phases; see [`docs/architecture.md`](docs/architecture.md) for the full plan.

## Documents

| # | Doc | Status |
|---|---|---|
| 1 | [Architecture & tech stack](docs/architecture.md) | ✅ Phase 1 |
| 2 | Database schema (`docs/schema.md` + `supabase/migrations/`) | pending Phase 2 |
| 3 | MikroTik RouterOS v7 configuration | pending Phase 3 |
| 4 | FreeRADIUS pack (if Option A/C chosen) | pending Phase 4 |
| 5 | Backend (auth, plans, payments, vouchers) | pending Phase 5 |
| 6 | Portal + admin dashboard | pending Phase 6 |
| 7 | Deployment guide | pending Phase 7 |
| 8 | Testing checklist & rollout plan | pending Phase 8 |

## Conventions

- Currency: GHS, stored as integer pesewas.
- RouterOS: v7 scripts; walled garden covers portal domain + Paystack; router never gets an inbound port.
- No secrets in git — see `.env.example` (added in Phase 5).
