CREATE TABLE "core"."saved_wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "token" TEXT,
    "address_cipher" BYTEA NOT NULL,
    "lookup_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "saved_wallets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_wallets_user_id_lookup_hash_key" ON "core"."saved_wallets"("user_id", "lookup_hash");
CREATE INDEX "saved_wallets_user_id_created_at_idx" ON "core"."saved_wallets"("user_id", "created_at");
