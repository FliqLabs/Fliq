WITH bounds AS (
  SELECT
    $2::date::timestamp AT TIME ZONE $3::text AS start_at,
    ($2::date + 1)::timestamp AT TIME ZONE $3::text AS end_at
)
SELECT count(DISTINCT payout_id)::bigint AS cap_refusal_count
FROM analytics.payout_events, bounds
WHERE workspace_id = $1::text
  AND status = 'failed'
  AND failure_reason IN ('vault_daily_cap', 'vault_per_payout_cap')
  AND occurred_at >= start_at
  AND occurred_at < end_at;
