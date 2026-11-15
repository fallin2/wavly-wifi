-- Wavly WiFi — seed.sql (safe for production: no secrets, no real customers)
-- Apply with:  psql $DATABASE_URL -f supabase/seed.sql
-- Example plans are STARTING POINTS and become fully editable in the admin UI.

insert into public.settings (id, business_name, support_phone, support_whatsapp)
values (1, 'Wavly WiFi', '+233000000000', '+233000000000')
on conflict (id) do nothing;

-- Speed profiles map to /ip/hotspot/user profiles on the router (see docs/mikrotik.md, Phase 3).
insert into public.plans (name, slug, description, price_pesewas, duration_hours, data_bytes,
                          rate_limit_down_kbps, rate_limit_up_kbps, mikrotik_profile,
                          max_devices, active, featured, sort_order) values
  ('Day Pass',        'day-pass',      '24 hours access, 5 Mbps, any fair use',           500,  24, null,        5120, 1024, 'wavly-std-5m',  1, true, false, 10),
  ('Weekly Pass',     'weekly-pass',   '7 days access, 5 Mbps',                           2500, 168, null,       5120, 1024, 'wavly-std-5m',  2, true, false, 20),
  ('Monthly Basic',   'monthly-basic', '30 days, 3 Mbps — best for chat & browsing',      7000, 720, null,       3072, 1024, 'wavly-basic-3m',2, true, false, 30),
  ('Monthly Standard','monthly-std',   '30 days, 5 Mbps — streaming & video calls',       8000, 720, null,       5120, 1024, 'wavly-std-5m',  3, true, true,  40),
  ('Monthly Premium', 'monthly-prem',  '30 days, 10 Mbps — heavy use',                   10000, 720, null,      10240, 2048, 'wavly-prem-10m',4, true, true,  50),
  ('Daily 2GB',       'daily-2gb',     '2 GB data, valid 24 hours, 5 Mbps',              1000,  24, 2147483648, 5120, 1024, 'wavly-std-5m',  1, true, false, 15)
on conflict (slug) do nothing;

-- No admin user is seeded. Create the first one (Phase 5) with:
--   node scripts/create-admin.mjs --username owner --password '...'   (2FA enrollment forced at first login)
