-- developer_id holds the user's workspace id, or the user's own id when they have no workspace (developerIdFor).
-- user_id resolves both cases, and is empty for a developer_id that is neither.
CREATE OR REPLACE VIEW analytics.payouts AS
SELECT
  p.id AS payout_id,
  p.developer_id AS workspace_id,
  p.provider,
  p.route_kind,
  p.currency,
  p.amount_in::numeric / 1000000 AS token_amount,
  p.amount_out_minor::numeric / 100 AS local_amount,
  p.rate,
  p.state AS status,
  p.created_at,
  settled.created_at AS settled_at,
  extract(epoch FROM settled.created_at - deposit.created_at) AS seconds_to_bank,
  p.failure_reason,
  coalesce(p.failure_reason LIKE 'vault\_%', false) AS is_refusal,
  coalesce(w.owner_id, u.id) AS user_id
FROM core.payouts p
LEFT JOIN developer.workspaces w ON w.id = p.developer_id
LEFT JOIN auth.users u ON u.id = p.developer_id
LEFT JOIN LATERAL (
  SELECT created_at FROM core.payout_events
  WHERE payout_id = p.id AND to_state = 'settled' ORDER BY version LIMIT 1
) settled ON true
LEFT JOIN LATERAL (
  SELECT created_at FROM core.payout_events
  WHERE payout_id = p.id AND to_state = 'deposit_seen' ORDER BY version LIMIT 1
) deposit ON true;

CREATE OR REPLACE VIEW analytics.payout_events AS
SELECT
  e.id AS event_id,
  e.payout_id,
  p.developer_id AS workspace_id,
  p.provider,
  p.route_kind,
  p.currency,
  p.amount_in::numeric / 1000000 AS token_amount,
  p.amount_out_minor::numeric / 100 AS local_amount,
  e.from_state AS from_status,
  e.to_state AS status,
  e.created_at AS occurred_at,
  e.version AS event_version,
  e.cause,
  p.failure_reason,
  coalesce(p.failure_reason LIKE 'vault\_%', false) AS is_refusal,
  coalesce(w.owner_id, u.id) AS user_id
FROM core.payout_events e
JOIN core.payouts p ON p.id = e.payout_id
LEFT JOIN developer.workspaces w ON w.id = p.developer_id
LEFT JOIN auth.users u ON u.id = p.developer_id;
