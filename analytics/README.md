# analytics

Rollups, status page data and the submission chart. Owner: Sejiro.

Events are emitted by `services/api` only, against the schemas in `spec/events/`. This folder holds the SQL or jobs that turn them into:

- dashboard tiles: settled today, median seconds to bank, refused by caps, best rate now
- status page: 60 day bars per service and provider, incidents
- rate history for the corridor charts (10 second snapshots, kept 90 days)
- the submission chart: median seconds to bank per provider over the build window

See diagram 12 on the architecture board.
