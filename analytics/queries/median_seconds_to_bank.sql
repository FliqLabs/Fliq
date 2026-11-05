WITH bounds AS (
  SELECT
    $2::date::timestamp AT TIME ZONE $3::text AS start_at,
    ($2::date + 1)::timestamp AT TIME ZONE $3::text AS end_at
)
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds_to_bank)::float8 AS median_seconds_to_bank
FROM analytics.payouts, bounds
WHERE workspace_id = $1::text
  AND status = 'settled'
  AND settled_at >= start_at
  AND settled_at < end_at;
