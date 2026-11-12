ALTER TABLE "core"."payouts" ADD COLUMN "float_target" TEXT;
ALTER TABLE "core"."payouts" ADD COLUMN "float_units" BIGINT;
ALTER TABLE "core"."payouts" ADD COLUMN "float_claimed_at" TIMESTAMPTZ(6);
ALTER TABLE "core"."payouts" ADD COLUMN "float_tx_hash" TEXT;
