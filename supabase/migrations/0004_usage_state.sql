-- Wavly WiFi — 0004_usage_state.sql
-- Cumulative byte counters reported by the router (they only grow). The portal stores
-- last-seen values here and writes deltas into usage_records.
create table if not exists public.router_usage_state (
  username      text primary key,
  last_bytes_in  bigint not null default 0,
  last_bytes_out bigint not null default 0,
  updated_at     timestamptz not null default now()
);
alter table public.router_usage_state enable row level security;
