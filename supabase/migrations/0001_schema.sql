-- Wavly WiFi — 0001_schema.sql
-- Core billing + hotspot schema (PostgreSQL 15+, Supabase).
-- All money is integer pesewas (1 GH¢ = 100 pesewas). Phone numbers are E.164 (+233…).
-- Option B (RouterOS outbound sync) is the primary enforcement path; RADIUS tables land in Phase 4 if Option A/C is chosen.

-- gen_random_uuid() is built-in since PostgreSQL 13 (Supabase runs PG15+); no extensions required.

-- ─── helper: updated_at auto-touch ──────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
comment on function public.touch_updated_at() is 'Sets updated_at = now() on UPDATE.';

-- ─── settings (singleton row, id = 1) ────────────────────────────────────────
create table if not exists public.settings (
  id                     smallint primary key default 1 check (id = 1),
  business_name          text not null default 'Wavly WiFi',
  currency               char(3) not null default 'GHS',
  support_phone          text,
  support_whatsapp       text,
  timezone               text not null default 'Africa/Accra',
  max_devices_default    integer not null default 1 check (max_devices_default between 1 and 8),
  mac_binding_enabled    boolean not null default false,
  voucher_requires_login boolean not null default true,
  receipt_prefix         text not null default 'WVL',
  sync_interval_seconds  integer not null default 45 check (sync_interval_seconds between 15 and 300),
  otp_ttl_seconds        integer not null default 600 check (otp_ttl_seconds between 60 and 1800),
  otp_max_attempts       integer not null default 5 check (otp_max_attempts between 1 and 10),
  privacy_notice         text not null default 'We collect only your phone number, plan and usage data to provide this service. Data is kept for 24 months and never sold. Contact us to request a copy or erasure.',
  retention_months       integer not null default 24 check (retention_months between 1 and 120),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
comment on table public.settings is 'Singleton business/config row (id must be 1).';

-- ─── admin_users ─────────────────────────────────────────────────────────────
create table if not exists public.admin_users (
  id                uuid primary key default gen_random_uuid(),
  username          text not null unique check (username ~ '^[a-z0-9_.-]{3,32}$'),
  password_hash     text not null,                     -- bcrypt, cost ≥ 10
  totp_secret       text,                              -- base32; NULL until 2FA enrolled
  totp_enrolled_at  timestamptz,
  role              text not null default 'support' check (role in ('owner','admin','support')),
  active            boolean not null default true,
  failed_attempts   integer not null default 0,
  locked_until      timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.admin_users is 'Admin dashboard logins. 2FA via TOTP; brute-force lockout via failed_attempts/locked_until.';

-- ─── agents (phase 2 feature — commission voucher resellers) ─────────────────
create table if not exists public.agents (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  phone_e164          text not null unique check (phone_e164 ~ '^\+233[0-9]{9}$'),
  commission_pesewas   integer not null default 0 check (commission_pesewas >= 0),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.agents is 'Voucher resellers earning commission per voucher sold. Phase 2 feature; inert until wired to UI.';

-- ─── customers ───────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id                uuid primary key default gen_random_uuid(),
  phone_e164        text not null unique check (phone_e164 ~ '^\+233[0-9]{9}$'),
  display_name      text,
  email             text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  account_status    text not null default 'active' check (account_status in ('active','suspended','banned')),
  mac_binding       boolean not null default false,    -- per-customer override of settings.mac_binding_enabled
  bound_mac         text check (bound_mac is null or bound_mac ~ '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$'),
  consent_at        timestamptz,                       -- when privacy notice was accepted
  consent_text_hash text,                              -- sha256 of notice text shown, for DPA audit
  notes             text,                              -- internal admin notes
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz,
  deleted_at        timestamptz,                       -- soft delete (DPA erasure request)
  updated_at        timestamptz not null default now()
);
comment on table public.customers is 'One row per phone number. Soft-delete via deleted_at; banned numbers cannot OTP in.';

-- ─── hotspot_credentials (router-side login; treat secret as sensitive) ───────
create table if not exists public.hotspot_credentials (
  customer_id  uuid primary key references public.customers(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9]{6,32}$'),
  secret       text not null,               -- plaintext required by RouterOS PAP; never expose via API/UI
  created_at   timestamptz not null default now()
);
comment on table public.hotspot_credentials is 'Opaque hotspot username + secret pushed to the router via sync. PAP requires retrievable secrets.';

-- ─── plans ───────────────────────────────────────────────────────────────────
create table if not exists public.plans (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  slug                 text not null unique check (slug ~ '^[a-z0-9-]{2,48}$'),
  description          text,
  price_pesewas        integer not null check (price_pesewas >= 0),
  duration_hours       integer check (duration_hours is null or duration_hours > 0),
  data_bytes           bigint check (data_bytes is null or data_bytes > 0),
  rate_limit_down_kbps integer check (rate_limit_down_kbps is null or rate_limit_down_kbps > 0),
  rate_limit_up_kbps   integer check (rate_limit_up_kbps is null or rate_limit_up_kbps > 0),
  mikrotik_profile     text not null,        -- /ip/hotspot/user profile name, e.g. wavly-std-5m
  max_devices          integer not null default 1 check (max_devices between 1 and 8),
  active               boolean not null default true,
  featured             boolean not null default false,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (duration_hours is not null or data_bytes is not null)   -- a plan must limit something
);
comment on table public.plans is 'Admin-configurable catalog. Time- and/or data-capped; speed via mikrotik_profile.';

-- ─── payments (money movement: Paystack charges only) ────────────────────────
create table if not exists public.payments (
  id                      uuid primary key default gen_random_uuid(),
  customer_id             uuid not null references public.customers(id),
  plan_id                 uuid not null references public.plans(id),
  amount_pesewas          integer not null check (amount_pesewas >= 0),
  currency                char(3) not null default 'GHS',
  provider                text not null default 'paystack' check (provider in ('paystack')),
  provider_reference      text not null unique,      -- wavly-<ulid>; Paystack echoes it back
  channel                 text not null default 'mobile_money' check (channel in ('mobile_money','card')),
  momo_provider           text check (momo_provider is null or momo_provider in ('mtn','vod','atl')),
  momo_phone              text,
  status                  text not null default 'pending'
                          check (status in ('pending','success','failed','abandoned','refunded','partial_refund')),
  failure_reason          text,
  provider_payload        jsonb,                        -- last provider response (no PAN data; Paystack never sends PANs)
  paid_at                 timestamptz,
  refunded_amount_pesewas integer not null default 0 check (refunded_amount_pesewas >= 0),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.payments is 'One row per charge attempt. Success is written ONLY from verified webhook/server-side verify.';
create index payments_customer_idx on public.payments (customer_id, created_at desc);
create index payments_pending_idx  on public.payments (created_at) where status = 'pending';

-- ─── payment_events (append-only webhook/verify audit) ───────────────────────
create table if not exists public.payment_events (
  id           bigint generated always as identity primary key,
  payment_id   uuid references public.payments(id) on delete set null,
  event_type   text not null,      -- 'webhook.charge_success' | 'verify.sync' | 'signature_mismatch' | …
  signature_ok boolean,
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);
create index payment_events_payment_idx on public.payment_events (payment_id);
create index payment_events_created_idx on public.payment_events (created_at);

-- ─── voucher_batches ─────────────────────────────────────────────────────────
create table if not exists public.voucher_batches (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  plan_id            uuid not null references public.plans(id),
  quantity           integer not null check (quantity between 1 and 5000),
  face_value_pesewas integer not null check (face_value_pesewas >= 0),
  agent_id           uuid references public.agents(id),   -- reseller commission hook (phase 2)
  created_by         uuid references public.admin_users(id),
  expires_at         timestamptz,                          -- unused vouchers die after this date
  created_at         timestamptz not null default now()
);
comment on table public.voucher_batches is 'Bulk generation units. Code CSVs are exportable once, at creation; we store hashes, not codes.';

-- ─── vouchers ────────────────────────────────────────────────────────────────
create table if not exists public.vouchers (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.voucher_batches(id) on delete cascade,
  code_hash    text not null unique,     -- sha256 hex of normalized (uppercase, no dashes) code
  code_last4   char(4) not null,
  status       text not null default 'unused' check (status in ('unused','redeemed','disabled','expired')),
  redeemed_by  uuid references public.customers(id),
  redeemed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index vouchers_batch_idx  on public.vouchers (batch_id);
create index vouchers_unused_idx on public.vouchers (created_at) where status = 'unused';

-- ─── subscriptions (an entitlement: what the customer may use) ───────────────
create table if not exists public.subscriptions (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers(id) on delete cascade,
  plan_id        uuid not null references public.plans(id),
  status         text not null default 'active' check (status in ('active','expired','suspended','cancelled')),
  source         text not null check (source in ('payment','voucher','admin_grant')),
  payment_id     uuid references public.payments(id),
  voucher_id     uuid references public.vouchers(id),
  started_at     timestamptz not null default now(),
  expires_at     timestamptz,                          -- NULL only for data-cap-only plans
  data_bytes_cap bigint,                               -- snapshot of plan cap at purchase time
  data_bytes_used bigint not null default 0 check (data_bytes_used >= 0),
  device_limit   integer not null default 1 check (device_limit between 1 and 8),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (source = 'admin_grant' or payment_id is not null or voucher_id is not null),
  check (expires_at is not null or data_bytes_cap is not null)
);
comment on table public.subscriptions is 'Source of truth for entitlement. Activated ONLY by verified payment or voucher redemption.';
create unique index subscriptions_payment_uidx on public.subscriptions (payment_id) where payment_id is not null;
create unique index subscriptions_voucher_uidx on public.subscriptions (voucher_id) where voucher_id is not null;
create index subscriptions_customer_status_idx on public.subscriptions (customer_id, status);
create index subscriptions_active_expiry_idx   on public.subscriptions (expires_at) where status = 'active';

-- ─── sessions (opaque token, sha256 at rest) ─────────────────────────────────
create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('customer','admin')),
  customer_id  uuid references public.customers(id) on delete cascade,
  admin_id     uuid references public.admin_users(id) on delete cascade,
  token_hash   text not null unique,
  ip           inet,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  check (
    (kind = 'customer' and customer_id is not null and admin_id is null) or
    (kind = 'admin'    and admin_id    is not null and customer_id is null)
  )
);
create index sessions_customer_idx on public.sessions (customer_id);
create index sessions_expiry_idx   on public.sessions (expires_at);

-- ─── otps (one-time passcodes; only hashes stored) ───────────────────────────
create table if not exists public.otps (
  id           bigint generated always as identity primary key,
  phone_e164   text not null check (phone_e164 ~ '^\+233[0-9]{9}$'),
  code_hash    text not null,              -- sha256 hex
  purpose      text not null default 'login' check (purpose in ('login','stepup')),
  attempts     integer not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_ip   inet,
  created_at   timestamptz not null default now()
);
create index otps_phone_created_idx on public.otps (phone_e164, created_at desc);
create index otps_expiry_idx        on public.otps (expires_at);

-- ─── rate_limits (fixed-window buckets keyed by app-supplied bucket key) ─────
create table if not exists public.rate_limits (
  bucket_key text primary key,             -- e.g. 'otp:phone:+233241234567:2026-11-15T08'
  count      integer not null default 1,
  created_at timestamptz not null default now()
);
create index rate_limits_created_idx on public.rate_limits (created_at);

-- ─── hotspot_outbox (Option B sync queue: router pulls via /api/router/sync) ──
create table if not exists public.hotspot_outbox (
  id          bigint generated always as identity primary key,
  op          text not null check (op in ('upsert','enable','disable','kick')),
  username    text not null,
  payload     jsonb not null default '{}'::jsonb,   -- upsert: {secret, profile, limit_uptime, limit_bytes_total, mac, comment}
  status      text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
comment on table public.hotspot_outbox is 'Append → router claims atomically (FOR UPDATE SKIP LOCKED) → applies → drops. Retry = re-enqueue via admin Re-sync.';
create index outbox_pending_idx on public.hotspot_outbox (id) where status = 'pending';

-- ─── usage_records (router byte counters, append-only) ───────────────────────
create table if not exists public.usage_records (
  id          bigint generated always as identity primary key,
  username    text not null,
  customer_id uuid references public.customers(id) on delete set null,
  bytes_in    bigint not null default 0 check (bytes_in >= 0),
  bytes_out   bigint not null default 0 check (bytes_out >= 0),
  source      text not null default 'router_sync',
  recorded_at timestamptz not null default now()
);
create index usage_records_user_time_idx on public.usage_records (username, recorded_at desc);
create index usage_records_time_idx      on public.usage_records (recorded_at desc);

-- ─── refunds ─────────────────────────────────────────────────────────────────
create table if not exists public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references public.payments(id) on delete cascade,
  amount_pesewas     integer not null check (amount_pesewas > 0),
  reason             text not null,
  provider_refund_id text,
  status             text not null default 'pending' check (status in ('pending','success','failed')),
  created_by         uuid references public.admin_users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index refunds_payment_idx on public.refunds (payment_id);

-- ─── reminder_log (exactly-once SMS reminders) ───────────────────────────────
create table if not exists public.reminder_log (
  id              bigint generated always as identity primary key,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  kind            text not null check (kind in ('t_minus_2d','expiry_day','expired_final')),
  created_at      timestamptz not null default now(),
  unique (subscription_id, kind)
);

-- ─── sms_log (delivery audit; bodies stored without OTP codes) ───────────────
create table if not exists public.sms_log (
  id                  bigint generated always as identity primary key,
  phone_e164          text not null,
  purpose             text not null check (purpose in ('otp','receipt','expiry_reminder','expired_notice','voucher','admin_test')),
  body_preview        text,
  provider            text not null default 'arkesel',
  provider_message_id text,
  status              text not null default 'queued' check (status in ('queued','sent','failed','skipped_dev')),
  created_at          timestamptz not null default now()
);
create index sms_log_phone_idx on public.sms_log (phone_e164, created_at desc);
create index sms_log_time_idx  on public.sms_log (created_at desc);

-- ─── devices (seen/bound MACs per customer) ──────────────────────────────────
create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  mac           text not null check (mac ~ '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$'),
  label         text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  blocked       boolean not null default false,
  unique (customer_id, mac)
);
create index devices_customer_idx on public.devices (customer_id);

-- ─── audit_log (append-only admin/system trail) ───────────────────────────────
create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  actor_kind   text not null check (actor_kind in ('admin','customer','system')),
  actor_id     text,
  action       text not null,             -- e.g. 'subscription.suspend', 'payment.refund', 'voucher.batch_create'
  target_table text,
  target_id    text,
  before_data  jsonb,
  after_data   jsonb,
  ip           inet,
  created_at   timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_target_idx  on public.audit_log (target_table, target_id);

-- ─── updated_at triggers ─────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['settings','admin_users','agents','customers','plans','payments','refunds','subscriptions'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ─── reporting views (dashboards) ────────────────────────────────────────────
create or replace view public.v_revenue_daily as
  select (paid_at at time zone 'Africa/Accra')::date as day,
         currency,
         count(*)                          as payment_count,
         sum(amount_pesewas)               as gross_pesewas,
         sum(refunded_amount_pesewas)      as refunded_pesewas
  from public.payments
  where status in ('success','partial_refund','refunded')
  group by 1, 2
  order by 1 desc;
comment on view public.v_revenue_daily is 'Daily gross revenue in pesewas (Africa/Accra). Filter status in dashboard queries as needed.';

create or replace view public.v_active_subscriptions as
  select s.id, c.phone_e164, c.display_name,
         p.name as plan_name, p.slug as plan_slug,
         s.started_at, s.expires_at, s.data_bytes_cap, s.data_bytes_used,
         s.source, s.device_limit
  from public.subscriptions s
  join public.customers c on c.id = s.customer_id
  join public.plans p     on p.id = s.plan_id
  where s.status = 'active' and (s.expires_at is null or s.expires_at > now());

create or replace view public.v_expiring_subscriptions as
  select s.id, c.phone_e164, c.display_name, p.name as plan_name,
         s.expires_at,
         round(extract(epoch from (s.expires_at - now())) / 3600.0, 1) as hours_left
  from public.subscriptions s
  join public.customers c on c.id = s.customer_id
  join public.plans p     on p.id = s.plan_id
  where s.status = 'active'
    and s.expires_at is not null
    and s.expires_at > now()
    and s.expires_at < now() + interval '48 hours';

create or replace view public.v_top_customers_30d as
  select c.id, c.phone_e164, c.display_name,
         coalesce(sum(s.data_bytes_used), 0) as bytes_used_30d
  from public.customers c
  join public.subscriptions s on s.customer_id = c.id
  where s.created_at > now() - interval '30 days'
  group by c.id, c.phone_e164, c.display_name
  order by bytes_used_30d desc;
