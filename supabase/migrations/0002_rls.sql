-- Wavly WiFi — 0002_rls.sql
-- Row Level Security: deny-by-default. The browser never talks to Postgres —
-- all access flows through the Next.js API using the service-role key, which bypasses RLS.
-- Supabase's anon/authenticated roles get NO policies, i.e. zero access, by construction.

alter table public.settings            enable row level security;
alter table public.admin_users         enable row level security;
alter table public.agents              enable row level security;
alter table public.customers           enable row level security;
alter table public.hotspot_credentials enable row level security;
alter table public.plans               enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_events      enable row level security;
alter table public.voucher_batches     enable row level security;
alter table public.vouchers            enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.sessions            enable row level security;
alter table public.otps                enable row level security;
alter table public.rate_limits         enable row level security;
alter table public.hotspot_outbox      enable row level security;
alter table public.usage_records       enable row level security;
alter table public.refunds             enable row level security;
alter table public.reminder_log        enable row level security;
alter table public.sms_log             enable row level security;
alter table public.devices             enable row level security;
alter table public.audit_log           enable row level security;

-- Intentionally no CREATE POLICY statements. If a future feature needs the anon role
-- (e.g. a public, read-only plans endpoint via PostgREST), add a narrowly-scoped policy
-- such as:  create policy plans_public_read on public.plans for select using (active = true);
-- Never add permissive policies on customers / payments / otps / hotspot_outbox.

-- Belt and braces: even if a policy is added later, these guard rails must hold.
-- 1) Service role bypass is automatic (BYPASSRLS) — do not "fix" that.
-- 2) Rotating the service-role key is the kill switch; store it only in Vercel env vars.
