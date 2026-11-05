# Local stack (L03)

One command starts the backend's local dependencies with no external keys. Requires Docker with Compose v2.

```
pnpm --filter @fliq/api stack:up      # build, start and wait until every service is healthy
pnpm --filter @fliq/api stack:down    # stop, keep data
pnpm --filter @fliq/api stack:reset   # stop and delete the Postgres and RabbitMQ volumes
```

`make dev-mock` is unchanged and still needs no Docker.

## What runs

| Service | Image | Host address | Data |
| --- | --- | --- | --- |
| postgres | `postgres:17-alpine` | `postgres://fliq:fliq-local-only@127.0.0.1:5432/fliq` | volume `postgres-data` |
| redis | `redis:7-alpine` | `redis://127.0.0.1:6379` | none (rebuildable caches only) |
| rabbitmq | `rabbitmq:3.13-management-alpine` | `amqp://fliq:fliq-local-only@127.0.0.1:5672`, UI on `127.0.0.1:15672` | volume `rabbitmq-data` |
| mock-api | built from `Dockerfile.dev` | `http://127.0.0.1:4000/v1` | none |

Every port binds to 127.0.0.1 only. The passwords are local-only and never valid anywhere else. RabbitMQ is pinned to 3.13 because Amazon MQ only runs 3.13 on the `mq.t3` brokers the hosted environments use. The `DATABASE_URL`, `REDIS_URL` and `AMQP_URL` defaults in `services/api/.env.example` point at this stack.

## Running the API against the stack

The API process (`apps/api`) runs on the host for now. Because it also listens on port 4000, stop `mock-api` first (`docker compose -f infra/compose.yaml stop mock-api`) or set another `PORT`.

```
cp .env.example .env    # then set FLIQ_ACCESS_SECRET, FLIQ_DATA_KEY and FLIQ_HASH_KEY
pnpm --filter @fliq/api db:generate
pnpm --filter @fliq/api db:deploy
pnpm --filter @fliq/api dev
```

## Not in the stack yet

These are part of the target stack (architecture §17.2) but are not added until they exist, so nothing here pretends to run:

| Missing | Waiting on |
| --- | --- |
| api as a container | an image step that runs `prisma generate`, a one-off `db:deploy` service, and a run under Docker to verify both |
| worker, relayer, mcp, sampler processes | their entrypoints in `apps/` (Oladipo, Collins, Ladipeo) |
| mock provider as a service | runs in-process through Collins's adapter registry |
| mock 1Click | L07 adds it as a service |
| local NEAR sandbox with the vault | vault wasm from the contract team; until then `packages/chains/vault` has an in-memory `MockVault` |
| `make demo` | Oladipo's demo script and a `demo` target in the root Makefile (leads) |

Each new process is added as a service built from `Dockerfile.dev` with its own `command`, depending on the data services with `condition: service_healthy`.
