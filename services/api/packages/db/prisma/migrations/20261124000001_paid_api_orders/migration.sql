CREATE TABLE "core"."paid_api_orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "payer" TEXT NOT NULL,
    "pay_to_address" TEXT NOT NULL,
    "amount_units" BIGINT NOT NULL,
    "expires_at_ns" BIGINT NOT NULL,
    "tx_hash" TEXT,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paid_api_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paid_api_orders_order_id_key" UNIQUE ("order_id")
);

CREATE INDEX "paid_api_orders_user_id_created_at_idx"
    ON "core"."paid_api_orders"("user_id", "created_at");
CREATE INDEX "paid_api_orders_tx_hash_idx"
    ON "core"."paid_api_orders"("tx_hash");

CREATE TABLE "core"."paid_api_calls" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "amount_units" BIGINT NOT NULL,
    "tx_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paid_api_calls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paid_api_calls_order_id_key" UNIQUE ("order_id")
);

ALTER TABLE "core"."paid_api_calls"
    ADD CONSTRAINT "paid_api_calls_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "core"."paid_api_orders"("order_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "paid_api_calls_user_id_created_at_idx"
    ON "core"."paid_api_calls"("user_id", "created_at");
