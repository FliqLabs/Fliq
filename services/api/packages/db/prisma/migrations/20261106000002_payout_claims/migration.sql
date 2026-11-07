CREATE TYPE "core"."ClaimState" AS ENUM ('open', 'resolved');

CREATE TABLE "core"."payout_claims" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "state" "core"."ClaimState" NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    CONSTRAINT "payout_claims_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payout_claims_payout_id_opened_at_idx" ON "core"."payout_claims"("payout_id", "opened_at");
CREATE UNIQUE INDEX "payout_claims_one_open_per_payout" ON "core"."payout_claims"("payout_id") WHERE "state" = 'open';
ALTER TABLE "core"."payout_claims" ADD CONSTRAINT "payout_claims_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "core"."payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
