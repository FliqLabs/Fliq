# Payout data for metrics

Read these two views, not the core tables. They hold no recipient data.

## analytics.payouts (one row per payout)

| Column | Meaning |
| --- | --- |
| payout_id | `po_...` |
| workspace_id | The developer workspace that created it |
| provider | `paycrest`, `busha`, `fonbnk`, `bitnob`, `transfi`, or `vault` for a payout refused before a provider was chosen |
| route_kind | `direct`, `intents` or `vault` |
| currency | Payout currency, lower case (`ngn`, `kes`) |
| token_amount | USDC sent, as a decimal |
| local_amount | Local currency paid, in whole units, as a decimal |
| rate | Rate after fees |
| status | Current state, see below |
| created_at | UTC |
| settled_at | UTC time of the `settled` event, empty until settled |
| seconds_to_bank | `settled` event minus `deposit_seen` event, in seconds |
| failure_reason | Why it ended in `failed`, empty otherwise |
| is_refusal | True when `failure_reason` starts with `vault_` |

## analytics.payout_events (one row per state change)

Same payout columns plus `from_status`, `status`, `occurred_at` (UTC), `event_version` (1, 2, 3 per payout) and `cause`.
The table behind it, `core.payout_events`, is append-only: updates and deletes are rejected by the database.

## Statuses

`created`, `awaiting_deposit`, `deposit_seen`, `routing`, `with_provider`, `paying_out`, `settled`,
`refunding`, `refunded`, `failed`, `expired`, plus `provider_timeout` and `awaiting_recon` while an outcome is unknown.

**`settled` means the provider confirmed the payout and the bank credit is recorded (the NIP session reference).**
It does not mean the USDC left the vault and it does not mean the provider accepted the order.
The rule is enforced when the state machine (O09) is built; until then no row reaches `settled`.

## Refusals

A refused attempt is stored as a payout with status `failed` and a `failure_reason` that starts with `vault_`:
`vault_daily_cap`, `vault_per_payout_cap`, `vault_corridor_not_allowed`, `vault_cooldown`.
The API still answers the caller with 422 at creation. Other reasons are not refusals:
`quote_expired`, `provider_unavailable`, `provider_rejected`, `deposit_expired`.

## Time

Every timestamp is stored as UTC (`timestamptz`). "Today" is the calendar day in the viewer's time zone, converted to a UTC range:
`start = midnight in that zone`, `end = start + 1 day`, start inclusive and end exclusive.
In Africa/Lagos (UTC+1) a payout settled at 23:30 UTC on 4 Nov counts as 5 Nov.
The dashboard cards come from `GET /v1/payouts/stats?tz=Africa/Lagos`, which does this for you.

## Sample

analytics.payouts

```
  payout_id  | provider | status  |       created_at       |       settled_at       | seconds_to_bank | failure_reason  | is_refusal
-------------+----------+---------+------------------------+------------------------+-----------------+-----------------+-----------
 po_4b78d010 | vault    | failed  | 2026-10-29 12:41:00+00 |                        |                 | vault_daily_cap | t
 po_9c2f71aa | paycrest | settled | 2026-10-29 13:02:10+00 | 2026-10-29 13:02:32+00 |       21.000000 |                 | f
```

analytics.payout_events

```
  payout_id  | provider |   from_status    |      status      |      occurred_at       | event_version |         cause
-------------+----------+------------------+------------------+------------------------+---------------+------------------------
 po_9c2f71aa | paycrest |                  | awaiting_deposit | 2026-10-29 13:02:10+00 |             1 | created
 po_9c2f71aa | paycrest | awaiting_deposit | deposit_seen     | 2026-10-29 13:02:11+00 |             2 | deposit_confirmed
 po_9c2f71aa | paycrest | deposit_seen     | paying_out       | 2026-10-29 13:02:13+00 |             3 | provider_order_created
 po_9c2f71aa | paycrest | paying_out       | settled          | 2026-10-29 13:02:32+00 |             4 | provider_confirmed
```

## Not there yet

- Nothing writes payouts or events until payout creation and the state machine are built (O10, O09), so the views are empty outside tests.
- The cause names above come from the proposed state machine and may change before then.
- The sample comes from a local test database, not from live data.
