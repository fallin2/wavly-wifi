-- Wavly WiFi — 0003_radius.sql (OPTIONAL — only for Option A / Option C)
-- Standard FreeRADIUS 3 SQL tables + notes. Our custom authorize queries query the BILLING tables
-- directly (hotspot_credentials / subscriptions / plans) — radcheck/radreply stay EMPTY.
-- Apply only if you deploy FreeRADIUS; Option B does not need this migration.

create table if not exists public.radcheck (
  id serial primary key,
  username text not null,
  attribute text not null,
  op char(2) not null default ':=',
  value text not null
);
create index radcheck_user_idx on public.radcheck (username);

create table if not exists public.radreply (
  id serial primary key,
  username text not null,
  attribute text not null,
  op char(2) not null default ':=',
  value text not null
);
create index radreply_user_idx on public.radreply (username);

create table if not exists public.radgroupcheck (
  id serial primary key,
  groupname text not null,
  attribute text not null,
  op char(2) not null default ':=',
  value text not null
);
create index radgroupcheck_group_idx on public.radgroupcheck (groupname);

create table if not exists public.radgroupreply (
  id serial primary key,
  groupname text not null,
  attribute text not null,
  op char(2) not null default ':=',
  value text not null
);
create index radgroupreply_group_idx on public.radgroupreply (groupname);

create table if not exists public.radusergroup (
  id serial primary key,
  username text not null,
  groupname text not null,
  priority integer not null default 1
);
create index radusergroup_user_idx on public.radusergroup (username);

create table if not exists public.radacct (
  radacctid bigserial primary key,
  acctsessionid text not null,
  acctuniqueid text not null unique,
  username text not null,
  realm text,
  nasipaddress inet not null,
  nasportid text,
  nasporttype text,
  acctstarttime timestamptz,
  acctupdatetime timestamptz,
  acctstoptime timestamptz,
  acctinterval integer,
  acctsessiontime integer,
  acctauthentic text,
  connectinfo_start text,
  connectinfo_stop text,
  acctinputoctets bigint,
  acctoutputoctets bigint,
  calledstationid text,
  callingstationid text,
  acctterminatecause text,
  servicetype text,
  framedprotocol text,
  framedipaddress inet
);
create index radacct_session_idx on public.radacct (acctsessionid);
create index radacct_user_idx on public.radacct (username);
create index radacct_nas_session_idx on public.radacct (nasipaddress, acctsessionid);
create index radacct_open_idx on public.radacct (username) where acctstoptime is null;

create table if not exists public.radpostauth (
  id bigserial primary key,
  username text not null,
  pass text,
  reply text,
  authdate timestamptz not null default now(),
  class text
);
create index radpostauth_user_idx on public.radpostauth (username, authdate desc);

create table if not exists public.radnas (
  id serial primary key,
  nasname text not null unique,
  shortname text,
  type text default 'other',
  ports integer,
  secret text,
  server text,
  community text,
  description text
);

-- RLS: same posture as the rest of the schema (deny anon; service role / RADIUS DB user access).
alter table public.radcheck enable row level security;
alter table public.radreply enable row level security;
alter table public.radgroupcheck enable row level security;
alter table public.radgroupreply enable row level security;
alter table public.radusergroup enable row level security;
alter table public.radacct enable row level security;
alter table public.radpostauth enable row level security;
alter table public.radnas enable row level security;

-- Dedicated least-privilege role for FreeRADIUS (create once; do NOT reuse the service key):
--   create role radius_app login password '...';
--   grant connect on database postgres to radius_app;
--   grant usage on schema public to radius_app;
--   grant select on public.hotspot_credentials, public.customers, public.subscriptions, public.plans to radius_app;
--   grant select, insert, update on public.radacct to radius_app;
--   grant insert on public.radpostauth to radius_app;
--   grant select on public.radcheck, public.radreply, public.radgroupcheck, public.radgroupreply, public.radusergroup, public.radnas to radius_app;
--   grant usage, select on all sequences in schema public to radius_app;
--   Default tables are empty; the grants are here so stock queries can't error.
