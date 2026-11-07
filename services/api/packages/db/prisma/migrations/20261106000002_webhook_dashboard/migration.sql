-- Expand only. An empty events list means every event type.
ALTER TABLE "developer"."webhook_endpoints" ADD COLUMN "events" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "developer"."webhook_endpoints" ADD COLUMN "description" TEXT;
ALTER TABLE "developer"."webhook_endpoints" ADD COLUMN "previous_secret_cipher" BYTEA;
ALTER TABLE "developer"."webhook_endpoints" ADD COLUMN "previous_secret_expires_at" TIMESTAMPTZ(6);
ALTER TABLE "developer"."webhook_endpoints" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Deliveries reference endpoints, so a deleted endpoint is kept and hidden.
ALTER TABLE "developer"."webhook_endpoints" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

-- A test event belongs to no payout.
ALTER TABLE "developer"."webhook_deliveries" ALTER COLUMN "payout_id" DROP NOT NULL;
CREATE INDEX "webhook_deliveries_payout_id_idx" ON "developer"."webhook_deliveries"("payout_id");

-- One row per HTTP attempt, so the dashboard can show the whole retry history.
CREATE TABLE "developer"."webhook_attempts" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "response_status" INTEGER,
    "error_kind" TEXT,
    CONSTRAINT "webhook_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webhook_attempts_delivery_id_idx" ON "developer"."webhook_attempts"("delivery_id");
ALTER TABLE "developer"."webhook_attempts" ADD CONSTRAINT "webhook_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "developer"."webhook_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The fan-out reads recent payout events in order.
CREATE INDEX "payout_events_created_at_idx" ON "core"."payout_events"("created_at");
