CREATE TABLE "core"."transfers" (
    "id" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "from_account" TEXT NOT NULL,
    "to_account" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transfers_tx_hash_key" ON "core"."transfers"("tx_hash");
CREATE INDEX "transfers_from_user_id_created_at_idx" ON "core"."transfers"("from_user_id", "created_at");
CREATE INDEX "transfers_to_user_id_created_at_idx" ON "core"."transfers"("to_user_id", "created_at");
ALTER TABLE "core"."transfers" ADD CONSTRAINT "transfers_amount_positive" CHECK ("amount" > 0);
