# Production image for the API and the relayer on Railway. SERVICE_ROLE=relayer starts the relayer; anything else
# applies pending migrations and starts the API. Build from the repo root: docker build -f services/api/infra/Dockerfile .
FROM node:22-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY spec/package.json spec/
COPY services/api/package.json services/api/
COPY apps/web/package.json apps/web/
RUN corepack install && pnpm install --frozen-lockfile --filter @fliq/api...

COPY spec spec
COPY services/api services/api

WORKDIR /app/services/api
RUN pnpm db:generate

CMD ["sh", "-c", "if [ \"$SERVICE_ROLE\" = relayer ]; then exec pnpm start:relayer; else pnpm db:deploy && exec pnpm start; fi"]
