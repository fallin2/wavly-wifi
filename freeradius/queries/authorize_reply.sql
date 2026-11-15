-- Authorize (reply): what the router must enforce for this session.
-- MikroTik-Rate-Limit order is client-upload/client-download (rx/tx).
SELECT hc.username, 'MikroTik-Rate-Limit', ':=',
       (p.rate_limit_up_kbps || 'k/' || p.rate_limit_down_kbps || 'k')
  FROM public.hotspot_credentials hc
  JOIN public.customers c ON c.id = hc.customer_id
  JOIN public.subscriptions s
    ON s.customer_id = c.id AND s.status = 'active'
   AND (s.expires_at IS NULL OR s.expires_at > now())
   AND (s.data_bytes_cap IS NULL OR s.data_bytes_used < s.data_bytes_cap)
  JOIN public.plans p ON p.id = s.plan_id
 WHERE hc.username = '%{SQL-User-Name}'
   AND c.account_status = 'active'
   AND c.deleted_at IS NULL
   AND p.rate_limit_up_kbps IS NOT NULL
   AND p.rate_limit_down_kbps IS NOT NULL
UNION ALL
SELECT hc.username, 'Session-Timeout', ':=',
       GREATEST(60, LEAST(2147483647, floor(extract(epoch from (s.expires_at - now())))::bigint))::text
  FROM public.hotspot_credentials hc
  JOIN public.customers c ON c.id = hc.customer_id
  JOIN public.subscriptions s
    ON s.customer_id = c.id AND s.status = 'active' AND s.expires_at IS NOT NULL
   AND s.expires_at > now()
   AND (s.data_bytes_cap IS NULL OR s.data_bytes_used < s.data_bytes_cap)
 WHERE hc.username = '%{SQL-User-Name}'
   AND c.account_status = 'active'
   AND c.deleted_at IS NULL;
