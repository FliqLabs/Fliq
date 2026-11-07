CREATE TYPE "core"."DepositState" AS ENUM ('waiting', 'seen', 'underpaid', 'bridging', 'landed', 'refunded', 'expired', 'failed');

CREATE TABLE "core"."vault_deposits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "deposit_address" TEXT NOT NULL,
    "deposit_memo" TEXT,
    "amount_units" BIGINT NOT NULL,
    "minimum_units" BIGINT NOT NULL,
    "fee_micro_usd" BIGINT NOT NULL,
    "lands_units" BIGINT NOT NULL,
    "eta_seconds" INTEGER NOT NULL,
    "reserved_until" TIMESTAMPTZ(6) NOT NULL,
    "state" "core"."DepositState" NOT NULL DEFAULT 'waiting',
    "intents_status" TEXT,
    "received_units" BIGINT,
    "landed_units" BIGINT,
    "refunded_units" BIGINT,
    "refund_reason" TEXT,
    "origin_tx" TEXT,
    "seen_at" TIMESTAMPTZ(6),
    "bridging_at" TIMESTAMPTZ(6),
    "landed_at" TIMESTAMPTZ(6),
    "polled_at" TIMESTAMPTZ(6),
    "quote" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vault_deposits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vault_deposits_deposit_address_key" ON "core"."vault_deposits"("deposit_address");
CREATE INDEX "vault_deposits_user_id_created_at_idx" ON "core"."vault_deposits"("user_id", "created_at");
CREATE INDEX "vault_deposits_state_reserved_until_idx" ON "core"."vault_deposits"("state", "reserved_until");
ALTER TABLE "core"."vault_deposits" ADD CONSTRAINT "vault_deposits_amounts_positive" CHECK ("amount_units" > 0 AND "minimum_units" > 0 AND "lands_units" >= 0 AND "fee_micro_usd" >= 0);
