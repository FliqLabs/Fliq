ALTER TABLE "core"."payouts"
  ADD COLUMN "deposit_chain" TEXT,
  ADD COLUMN "deposit_address" TEXT,
  ADD COLUMN "deposit_units" BIGINT,
  ADD COLUMN "deposit_valid_until" TIMESTAMPTZ(6),
  ADD COLUMN "deposit_memo" TEXT;

ALTER TABLE "core"."quote_routes" ADD COLUMN "provider_quote" JSONB;
