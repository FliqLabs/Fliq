ALTER TABLE "core"."vault_deposits" ADD COLUMN "bank_order_id" TEXT;
ALTER TABLE "core"."vault_deposits" ADD COLUMN "bank_status" TEXT;
ALTER TABLE "core"."vault_deposits" ADD COLUMN "bank_status_at" TIMESTAMPTZ(6);
ALTER TABLE "core"."vault_deposits" ADD COLUMN "bank_hook_token" TEXT;
ALTER TABLE "core"."vault_deposits" ADD COLUMN "bank_sent_at" TIMESTAMPTZ(6);
ALTER TABLE "core"."vault_deposits" ADD COLUMN "bank_alerted_at" TIMESTAMPTZ(6);
CREATE INDEX "vault_deposits_bank_order_id_idx" ON "core"."vault_deposits"("bank_order_id");
