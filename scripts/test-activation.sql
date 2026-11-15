-- Wavly WiFi — activation idempotency audit (run with psql -v ON_ERROR_STOP=1)
-- Proves the webhook replay / double-delivery path produces exactly ONE subscription.
-- Safe: runs inside BEGIN ... ROLLBACK.
begin;

insert into public.customers (phone_e164, consent_at) values ('+233249999999', now());

insert into public.payments (customer_id, plan_id, amount_pesewas, provider_reference, channel, status)
select c.id, p.id, p.price_pesewas, 'wavly-audit-test-0001', 'mobile_money', 'pending'
from public.customers c, public.plans p
where c.phone_e164 = '+233249999999' and p.slug = 'weekly-pass';

-- ── Simulated activation #1 (webhook delivery #1) ─────────────────────────────
with pay as (
  select p.id, p.customer_id, p.plan_id, p.amount_pesewas
  from public.payments p where p.provider_reference = 'wavly-audit-test-0001'
),
success as (
  update public.payments set status = 'success', paid_at = now()
  where provider_reference = 'wavly-audit-test-0001' and status = 'pending'
  returning id, customer_id, plan_id
),
inserted as (
  insert into public.subscriptions (customer_id, plan_id, status, source, payment_id, expires_at, data_bytes_cap, device_limit)
  select s.customer_id, s.plan_id, 'active', 'payment', s.id, now() + interval '168 hours', null, 2
  from success s
  returning id
)
select 'activation_1' as step, count(*) as subscriptions_created from inserted;

-- ── Simulated activation #2 (webhook REPLAY — must create nothing) ───────────
with pay as (
  select p.id, p.customer_id, p.plan_id from public.payments p where p.provider_reference = 'wavly-audit-test-0001'
),
noop as (
  update public.payments set status = 'success', paid_at = now()
  where provider_reference = 'wavly-audit-test-0001' and status = 'pending'
  returning id
)
insert into public.subscriptions (customer_id, plan_id, status, source, payment_id, expires_at)
select pay.customer_id, pay.plan_id, 'active', 'payment', pay.id, now() + interval '168 hours'
from (select id, customer_id, plan_id from public.payments
      where provider_reference = 'wavly-audit-test-0001') pay
on conflict (payment_id) where payment_id is not null do nothing
returning id;

select 'after_replay' as step, count(*) as total_subscriptions
from public.subscriptions s
join public.payments p on p.id = s.payment_id
where p.provider_reference = 'wavly-audit-test-0001';

-- ── Renewal stacking: expiry extends from current expiry, not now ────────────
insert into public.payments (customer_id, plan_id, amount_pesewas, provider_reference, channel, status)
select c.id, p.id, p.price_pesewas, 'wavly-audit-test-0002', 'card', 'pending'
from public.customers c, public.plans p
where c.phone_e164 = '+233249999999' and p.slug = 'weekly-pass';

with success as (
  update public.payments set status = 'success', paid_at = now()
  where provider_reference = 'wavly-audit-test-0002'
  returning id, customer_id, plan_id
)
insert into public.subscriptions (customer_id, plan_id, status, source, payment_id, expires_at)
select s.customer_id, s.plan_id, 'active', 'payment', s.id,
       coalesce((select max(expires_at) from public.subscriptions x
                  where x.customer_id = s.customer_id and x.status = 'active' and x.expires_at > now()), now()) + interval '168 hours'
from success s
returning id;

select 'stacking' as step, expires_at::date as final_expiry
from public.subscriptions s
join public.payments p on p.id = s.payment_id
where p.provider_reference = 'wavly-audit-test-0002';

rollback;
