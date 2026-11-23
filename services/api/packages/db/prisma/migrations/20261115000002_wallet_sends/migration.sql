CREATE TABLE "core"."wallet_sends" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "amount_units" BIGINT NOT NULL,
    "receives_units" BIGINT NOT NULL,
    "min_receives_units" BIGINT NOT NULL,
    "delivered_units" BIGINT,
    "deposit_address" TEXT NOT NULL,
    "deposit_memo" TEXT,
    "eta_seconds" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'awaiting',
    "origin_tx" TEXT,
    "destination_tx" TEXT,
    "quote" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_sends_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_sends_deposit_address_key" ON "core"."wallet_sends"("deposit_address");
CREATE INDEX "wallet_sends_user_id_created_at_idx" ON "core"."wallet_sends"("user_id", "created_at");
CREATE INDEX "wallet_sends_state_created_at_idx" ON "core"."wallet_sends"("state", "created_at");
