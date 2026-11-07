ALTER TABLE "core"."payouts" ADD COLUMN "agent_id" TEXT;
CREATE INDEX "payouts_agent_id_created_at_idx" ON "core"."payouts"("agent_id", "created_at") WHERE "agent_id" IS NOT NULL;
