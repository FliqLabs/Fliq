WITH bounds AS (
  SELECT
    $2::date::timestamp AT TIME ZONE $4::text AS start_at,
    $3::date::timestamp AT TIME ZONE $4::text AS end_at
)
SELECT
  provider,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds_to_bank)::float8 AS median_seconds_to_bank,
  count(seconds_to_bank)::bigint AS sample_count
FROM analytics.payouts, bounds
WHERE workspace_id = $1::text
  AND status = 'settled'
  AND settled_at >= start_at
  AND settled_at < end_at
GROUP BY provider
ORDER BY provider;
