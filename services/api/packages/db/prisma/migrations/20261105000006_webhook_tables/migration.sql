CREATE SCHEMA IF NOT EXISTS "integration";

CREATE TYPE "developer"."WebhookEndpointStatus" AS ENUM ('active', 'failing', 'disabled');
CREATE TYPE "developer"."WebhookDeliveryStatus" AS ENUM ('pending', 'delivered', 'failed');

CREATE TABLE "developer"."webhook_endpoints" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "environment" "developer"."KeyEnvironment" NOT NULL,
    "url" TEXT NOT NULL,
    "secret_cipher" BYTEA NOT NULL,
    "status" "developer"."WebhookEndpointStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failing_since" TIMESTAMPTZ(6),
    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "developer"."webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "developer"."WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "last_response_status" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(6),
    "replay_of_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration"."inbound_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "body_cipher" BYTEA NOT NULL,
    "provider_order_id" TEXT,
    "payout_id" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_endpoints_workspace_id_idx" ON "developer"."webhook_endpoints"("workspace_id");
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "developer"."webhook_deliveries"("endpoint_id", "created_at");
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "developer"."webhook_deliveries"("status", "next_attempt_at");
CREATE INDEX "webhook_deliveries_event_id_idx" ON "developer"."webhook_deliveries"("event_id");
CREATE INDEX "inbound_events_payout_id_idx" ON "integration"."inbound_events"("payout_id");
CREATE INDEX "inbound_events_received_at_idx" ON "integration"."inbound_events"("received_at");
CREATE UNIQUE INDEX "inbound_events_provider_provider_event_id_key" ON "integration"."inbound_events"("provider", "provider_event_id");

ALTER TABLE "developer"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "developer"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "developer"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "developer"."webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "developer"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_replay_of_id_fkey" FOREIGN KEY ("replay_of_id") REFERENCES "developer"."webhook_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
