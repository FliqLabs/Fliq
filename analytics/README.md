# analytics

Rollups, status page data and the submission chart. Owner: Sejiro.

Events are emitted by `services/api` only, against the schemas in `spec/events/`. This folder holds the SQL or jobs that turn them into:

- dashboard tiles: settled today, median seconds to bank, refused by caps, best rate now
- status page: 60 day bars per service and provider, incidents
- rate history for the corridor charts (1 minute snapshots, kept 90 days)
- the submission chart: median seconds to bank per provider over the build window

See diagram 12 on the architecture board.

## Payout queries

The files in `queries/` are parameterized PostgreSQL SELECT statements. Load the SQL and bind the
parameters through your database client's prepared-query API; do not interpolate values into SQL.
Every query requires a nonempty `workspace_id`, local ISO dates (`YYYY-MM-DD`), and an IANA timezone
such as `Africa/Lagos` or `America/New_York`. Callers should validate these inputs before execution.
There is no default or all-workspaces mode; a null workspace matches no payouts.

| Query | Parameters in order | Result |
| --- | --- | --- |
| `settled_count.sql` | workspace_id, local_date, timezone | One row: `settled_count` |
| `median_seconds_to_bank.sql` | workspace_id, local_date, timezone | One row: `median_seconds_to_bank` |
| `cap_refusals.sql` | workspace_id, local_date, timezone | One row: `cap_refusal_count` |
| `provider_medians.sql` | workspace_id, start_date, end_date_exclusive, timezone | Rows ordered by `provider`: `median_seconds_to_bank`, `sample_count` |

For example, daily parameters `['ws_2b7e41c0', '2026-10-29', 'Africa/Lagos']` select
`[2026-10-28T23:00:00Z, 2026-10-29T23:00:00Z)`. Provider parameters
`['ws_2b7e41c0', '2026-10-29', '2026-10-31', 'Africa/Lagos']` select two settlement dates.
Each local midnight is converted separately, so daylight-saving days can span 23 or 25 hours.
The database session's timezone does not affect the boundaries.

Settlement metrics require `status = 'settled'`, filter by `settled_at`, and use
`percentile_cont(0.5)::float8` for medians. Null durations are excluded from medians;
`sample_count` counts only non-null durations. A provider with settlements but no durations has
a null median and zero samples. A range without settlements returns no provider rows.
The daily empty count is zero and the daily empty median is null.

Cap refusals count distinct payout IDs whose `failed` event occurred within the window and whose
`failure_reason` is exactly `vault_daily_cap` or `vault_per_payout_cap`. Payout creation time and
other vault refusal reasons do not affect this count. All queries read only `analytics.payouts`
and `analytics.payout_events`; they create no database objects.

## Tests

From the repository root, with Python 3.11+ and PostgreSQL's `initdb`, `pg_ctl`, and `psql` on `PATH`:

```sh
python3 -B -m unittest discover -s analytics/tests -v
```

The dependency-free tests create and remove a disposable PostgreSQL cluster under `/tmp`, listening
only on its own Unix socket. They ignore `PG*` environment settings and never use `DATABASE_URL`.
Test views expose the documented columns; the metric statements run in read-only transactions.
The baseline payout and workspace come from `spec/fixtures/payout.settled.json` and
`spec/fixtures/workspace.current.json`. Edge cases vary timestamps, durations, documented providers
and failure reasons; extra test identities are generated at runtime rather than adding canonical fixtures.
Coverage includes local midnight edges, both DST transitions, workspace isolation, empty/null samples,
missing parameters, duplicate refusal events, and provider settlement ranges.

## Manual database check

```sh
~/projects/cashout-router-analytics/.venv/bin/python /Users/USER/projects/Fliq/analytics/check_payout_metrics.py
```

The runner prompts privately for `DATABASE_URL`, then for a workspace ID. A blank workspace lists
available IDs and requires selecting one. It executes the existing SQL files in a read-only transaction,
with a 10-second connection timeout and a 15-second statement timeout. Daily metrics use 5 November
2026 in `Africa/Lagos`; provider medians cover local dates `[2026-11-03, 2026-11-06)`.
Output contains query results; database errors show only their exception type and SQLSTATE.

## Libraries

- `psycopg` 3.3.6, already installed in the environment above: `RawCursor` binds the SQL files'
  numbered PostgreSQL parameters directly, without rewriting queries or interpolating values.

## Provider delivery-time chart

From the repository root:

```sh
~/projects/cashout-router-analytics/.venv/bin/python -B analytics/export_provider_chart.py \
  --workspace-id ws_2b7e41c0 \
  --start-date 2026-11-03 --end-date-exclusive 2026-11-06 \
  --timezone Africa/Lagos --data-label test \
  --output analytics/exports/provider-delivery-time.svg
```

All flags are required. Replace the workspace with your selected workspace. Choose `test` or `live`
explicitly based on the source data; the exporter never infers the label from workspace names.
Test exports visibly say **TEST DATA — not real payout performance**. Dates are local settlement
dates, with an inclusive start and exclusive end, converted by the existing `provider_medians.sql`.

The runner prompts privately for `DATABASE_URL` and uses the checker's read-only transaction,
10-second connection timeout, 15-second statement timeout, and native numbered parameter binding.
Credentials are never printed or saved; errors show only exception type and SQLSTATE.
Exports are standalone SVGs in the ignored `analytics/exports/` directory; existing files are never
overwritten. Rendering uses the Python standard library and adds no dependencies.

Bars start at zero and show median seconds from **deposit_seen to settled**, with sample counts
for non-null durations. Empty results have no bars; null medians say “Median unavailable” rather
than zero. Provider medians alone do not establish provider quality or comparable routes; these
aggregates do not control for route, corridor, currency, or sample composition.

Run only the chart rendering tests (no database required):

```sh
python3 -B -m unittest discover -s analytics/tests -p test_provider_chart.py -v
```
