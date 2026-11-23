CREATE TABLE "auth"."key_changes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_changes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "key_changes_tx_hash_key" ON "auth"."key_changes"("tx_hash");
CREATE INDEX "key_changes_created_at_idx" ON "auth"."key_changes"("created_at");
CREATE INDEX "key_changes_user_id_created_at_idx" ON "auth"."key_changes"("user_id", "created_at");
