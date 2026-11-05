WITH bounds AS (
  SELECT
    $2::date::timestamp AT TIME ZONE $3::text AS start_at,
    ($2::date + 1)::timestamp AT TIME ZONE $3::text AS end_at
)
SELECT count(*)::bigint AS settled_count
FROM analytics.payouts, bounds
WHERE workspace_id = $1::text
  AND status = 'settled'
  AND settled_at >= start_at
  AND settled_at < end_at;
