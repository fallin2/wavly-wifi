-- Authorize (check): identity verification material + simultaneous-use limit.
-- '%{SQL-User-Name}' is substituted by FreeRADIUS at runtime.
-- Returns rows only when the customer is active AND has a live entitlement — else no rows => reject.
SELECT hc.username, 'Cleartext-Password', ':=', hc.secret
  FROM public.hotspot_credentials hc
  JOIN public.customers c ON c.id = hc.customer_id
 WHERE hc.username = '%{SQL-User-Name}'
   AND c.account_status = 'active'
   AND c.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.subscriptions s
      WHERE s.customer_id = c.id
        AND s.status = 'active'
        AND (s.expires_at IS NULL OR s.expires_at > now())
        AND (s.data_bytes_cap IS NULL OR s.data_bytes_used < s.data_bytes_cap)
   )
UNION ALL
SELECT hc.username, 'Simultaneous-Use', ':=', sub.device_limit::text
  FROM public.hotspot_credentials hc
  JOIN public.customers c ON c.id = hc.customer_id
  JOIN LATERAL (
        SELECT s.device_limit
          FROM public.subscriptions s
         WHERE s.customer_id = c.id
           AND s.status = 'active'
           AND (s.expires_at IS NULL OR s.expires_at > now())
           AND (s.data_bytes_cap IS NULL OR s.data_bytes_used < s.data_bytes_cap)
         ORDER BY s.expires_at DESC NULLS LAST
         LIMIT 1
       ) sub ON true
 WHERE hc.username = '%{SQL-User-Name}'
   AND c.account_status = 'active'
   AND c.deleted_at IS NULL;
