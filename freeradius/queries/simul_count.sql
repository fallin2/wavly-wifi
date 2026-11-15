-- Simultaneous-Use check (rlm_sql session phase): how many open sessions does this user have?
-- FreeRADIUS rejects the login when the count >= the Simultaneous-Use check value.
SELECT COUNT(DISTINCT acctsessionid)
  FROM public.radacct
 WHERE acctstoptime IS NULL
   AND username = '%{SQL-User-Name}';
