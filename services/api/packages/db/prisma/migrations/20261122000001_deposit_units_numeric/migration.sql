-- 18-decimal tokens (USDC and USDT on BNB Chain, ETH, BNB) overflow BIGINT above about 9.2 tokens.
ALTER TABLE "core"."vault_deposits" ALTER COLUMN "amount_units" TYPE DECIMAL(78,0);
ALTER TABLE "core"."vault_deposits" ALTER COLUMN "minimum_units" TYPE DECIMAL(78,0);
ALTER TABLE "core"."vault_deposits" ALTER COLUMN "received_units" TYPE DECIMAL(78,0);
ALTER TABLE "core"."vault_deposits" ALTER COLUMN "refunded_units" TYPE DECIMAL(78,0);
