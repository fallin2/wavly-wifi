# Wavly WiFi — Testing Checklist & Rollout Plan (Phase 8)

Preconditions: Phases 1–7 deployed (`main`), Supabase migrated, admin TOTP enrolled, router synced (`hotspot_outbox` drains), Arkesel + Paystack keys set.

## Automated checks (run on every release)

```bash
npm test                      # vitest — Paystack webhook signature, phone, voucher, wire format
npx tsc --noEmit && npm run build
psql "$DATABASE_URL" -f scripts/test-activation.sql   # embedded-PG audit: replay idempotency, renewal stacking
```

## Manual smoke matrix (staging first, then production gate)

| # | Flow | Pass criteria |
|---|---|---|
| 1 | `GET /api/health` | `{"ok":true,"db_time":…,"outbox_pending":0}` |
| 2 | OTP login (any number, dev echo or real SMS) | session cookie set; redirected to `/account` |
| 3 | Buy Day Pass (₵5) with Paystack **test** MoMo | prompt on test phone → webhook fires → `/account` shows active plan |
| 4 | Webhook replay (Paystack dashboard "resend") | subscription count unchanged; `payment_events` shows second row |
| 5 | Router pulls `/api/router/sync` ≤ 60 s later | outbox row `sent`; device can log in on hotspot (PAP creds) |
| 6 | Data cap (2 GB plan) exhausts | `/api/router/usage` crosses cap → `kick` op enqueued → device dropped |
| 7 | Expiry cron (`/api/cron/expire`) | past-expiry sub marked `expired`, router `disable`+`kick`, SMS sent **once** (re-run sends none) |
| 8 | Refund from `/admin/payments` | Paystack refund → sub `suspended` → router access cut |
| 9 | Voucher batch → redeem | one-time CSV downloaded; redeem activates; batch expiry blocks expired codes |
| 10 | Admin suspend → reinstate | router kick/re-push; audit_log entries exist |
| 11 | Wrong password ×5 on /admin/login | account locked 15 min (`locked_until` set); TOTP required after correct login |
| 12 | `/privacy` renders; data-controller line accurate | DPC status text truthful |

## Pilot rollout (do not skip)

1. **Week 0 — staging**: full smoke matrix green; fix anything red. Keep `SMS_DEV_LOG` on staging only.
2. **Week 1 — soft launch**: one hotspot site, attendant-only signups, plans Day Pass + 2 GB only. Watch daily: `hotspot_outbox` pending KPI, `sms_log` failures, `payment_events` vs `payments` counts, support complaints.
3. **Week 2 — paid vouchers**: enable the voucher kiosk flow; reconcile ₵ via nightly `/admin/reports` CSV vs Paystack dashboard settlement.
4. **Week 3 — open**: remaining plans, public launch. Announce in-site + local radio/group chats.
5. **Rollback triggers**: webhook signature mismatches, activation double-grants, router outbox not draining, double-charging reports. Rollback = Vercel dashboard → instant revert to previous deployment; Supabase → PITR/restore from daily backup (points in time, last 7 days on free plan); router → disable voucher sales, attendants collect cash payments manually until restored.

## Standing ops

- **Daily**: outbox KPI; `payment_events` signature_mismatch count; SMS failed rate.
- **Weekly**: `v_revenue_daily` vs Paystack settlement report; expiring-48h list (`/admin` overview); failed refunds review.
- **Monthly**: Supabase backup restore drill (into a scratch project); dependency `npm audit`; rotate `ROUTER_SYNC_KEY` if shared beyond the site.
- **On breach report**: DPA Act 843 notification within 72 h to DPC + affected users; erase flow via `/admin/users` (suspend → Erase PII) for approved erasure requests.

## Known limitations at launch

- Free Supabase: 7-day backup retention, project pauses when idle long-term; upgrade before real volume.
- Cron cadence daily on Vercel Hobby — expiry enforcement lags up to 24 h; upgrade to Pro or wire the pg_net 5-minute dispatcher (see `docs/backend.md`).
- MoMo activation is near-instant but not guaranteed < 3 s (network + telco prompt) — portal copy already sets that expectation.
- FreeRADIUS Option A untested in production (Option B sync is the shipping path).
