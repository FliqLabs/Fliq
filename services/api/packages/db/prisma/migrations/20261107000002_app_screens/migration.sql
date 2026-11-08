ALTER TABLE "auth"."users" ADD COLUMN "home_currency" TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE "auth"."users" ADD COLUMN "notification_settings" JSONB;
ALTER TABLE "core"."recipients" ADD COLUMN "own" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "core"."recipients" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "recipients_one_default_per_user" ON "core"."recipients"("user_id") WHERE "is_default" AND "deleted_at" IS NULL;
ALTER TABLE "core"."vault_deposits" ADD COLUMN "request_id" TEXT;
CREATE INDEX "vault_deposits_request_id_idx" ON "core"."vault_deposits"("request_id");

CREATE TABLE "auth"."session_devices" (
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_devices_pkey" PRIMARY KEY ("family_id")
);
CREATE INDEX "session_devices_user_id_idx" ON "auth"."session_devices"("user_id");

CREATE TABLE "auth"."push_tokens" (
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("token")
);
CREATE INDEX "push_tokens_user_id_idx" ON "auth"."push_tokens"("user_id");

CREATE TYPE "core"."RequestState" AS ENUM ('open', 'paid', 'cancelled');
CREATE TABLE "core"."payment_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount_units" BIGINT NOT NULL,
    "note" TEXT NOT NULL,
    "state" "core"."RequestState" NOT NULL DEFAULT 'open',
    "cash_out_on_arrival" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),
    "deposit_id" TEXT,
    "payer" TEXT,
    "paid_token" TEXT,
    "paid_chain" TEXT,
    "paid_amount" TEXT,
    "fee_micro_usd" BIGINT,
    "landed_units" BIGINT,
    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_requests_amount_positive" CHECK ("amount_units" > 0)
);
CREATE UNIQUE INDEX "payment_requests_user_id_code_key" ON "core"."payment_requests"("user_id", "code");
CREATE INDEX "payment_requests_user_id_created_at_idx" ON "core"."payment_requests"("user_id", "created_at");

CREATE TYPE "core"."AgentState" AS ENUM ('pending', 'active', 'revoked');
CREATE TABLE "core"."agents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "state" "core"."AgentState" NOT NULL DEFAULT 'pending',
    "cap_currency" TEXT NOT NULL,
    "daily_cap_minor" BIGINT NOT NULL,
    "per_payout_cap_minor" BIGINT NOT NULL,
    "currencies" TEXT[],
    "saved_accounts_only" BOOLEAN NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "agents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agents_caps_positive" CHECK ("daily_cap_minor" > 0 AND "per_payout_cap_minor" > 0 AND "per_payout_cap_minor" <= "daily_cap_minor")
);
CREATE INDEX "agents_user_id_created_at_idx" ON "core"."agents"("user_id", "created_at");

CREATE TABLE "core"."agent_refusals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" TEXT,
    "order_id" TEXT,
    "tx_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_refusals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_refusals_user_id_created_at_idx" ON "core"."agent_refusals"("user_id", "created_at");
