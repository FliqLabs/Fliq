-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "auth";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "developer";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ledger";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "messaging";

-- CreateEnum
CREATE TYPE "core"."PayoutState" AS ENUM ('created', 'provider_timeout', 'awaiting_recon', 'awaiting_deposit', 'deposit_seen', 'routing', 'with_provider', 'paying_out', 'settled', 'refunding', 'refunded', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "core"."RouteKind" AS ENUM ('direct', 'intents', 'vault');

-- CreateEnum
CREATE TYPE "core"."QuoteMode" AS ENUM ('send_exactly', 'receive_exactly');

-- CreateEnum
CREATE TYPE "ledger"."AccountType" AS ENUM ('asset', 'liability', 'revenue', 'expense');

-- CreateEnum
CREATE TYPE "auth"."ChallengePurpose" AS ENUM ('register', 'login');

-- CreateEnum
CREATE TYPE "developer"."WorkspaceUseCase" AS ENUM ('wallet', 'payroll', 'marketplace', 'agent', 'other');

-- CreateEnum
CREATE TYPE "developer"."KeyEnvironment" AS ENUM ('test', 'live');

-- CreateTable
CREATE TABLE "core"."quotes" (
    "id" TEXT NOT NULL,
    "developer_id" TEXT NOT NULL,
    "mode" "core"."QuoteMode" NOT NULL,
    "token_symbol" TEXT NOT NULL,
    "source_chain" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_in" BIGINT NOT NULL,
    "amount_out_minor" BIGINT NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "chosen_route_id" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."quote_routes" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" "core"."RouteKind" NOT NULL,
    "rank" INTEGER NOT NULL,
    "amount_in" BIGINT NOT NULL,
    "amount_out_minor" BIGINT NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "fee_provider" BIGINT NOT NULL,
    "fee_network" BIGINT NOT NULL,
    "fee_intents" BIGINT NOT NULL DEFAULT 0,
    "fee_ours" BIGINT NOT NULL DEFAULT 0,
    "eta_seconds" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "score_breakdown" JSONB NOT NULL,

    CONSTRAINT "quote_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."recipients" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "institution_code" TEXT NOT NULL,
    "logo_key" TEXT,
    "account_cipher" BYTEA NOT NULL,
    "name_cipher" BYTEA NOT NULL,
    "lookup_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."payouts" (
    "id" TEXT NOT NULL,
    "developer_id" TEXT NOT NULL,
    "client_reference" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "route_kind" "core"."RouteKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT,
    "state" "core"."PayoutState" NOT NULL DEFAULT 'created',
    "version" INTEGER NOT NULL DEFAULT 1,
    "amount_in" BIGINT NOT NULL,
    "amount_out_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "retry_of_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."payout_events" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "from_state" "core"."PayoutState",
    "to_state" "core"."PayoutState" NOT NULL,
    "version" INTEGER NOT NULL,
    "cause" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger"."accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ledger"."AccountType" NOT NULL,
    "asset" TEXT NOT NULL,
    "owner_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger"."journal_entries" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT,
    "posting_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "memo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger"."journal_lines" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger"."balances" (
    "account_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "reserved" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balances_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "messaging"."outbox" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "trace_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging"."inbox" (
    "consumer" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_pkey" PRIMARY KEY ("consumer","message_id")
);

-- CreateTable
CREATE TABLE "messaging"."timers" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "fired_at" TIMESTAMPTZ(6),
    "dedupe_key" TEXT,

    CONSTRAINT "timers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging"."dead_letters" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "message_id" TEXT,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "near_account" TEXT,
    "vault_account" TEXT,
    "display_name" TEXT,
    "occupation" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."passkey_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."auth_challenges" (
    "id" TEXT NOT NULL,
    "purpose" "auth"."ChallengePurpose" NOT NULL,
    "challenge" TEXT NOT NULL,
    "user_handle" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."email_links" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer"."workspaces" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "use_case" "developer"."WorkspaceUseCase" NOT NULL,
    "countries" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer"."api_keys" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "environment" "developer"."KeyEnvironment" NOT NULL,
    "key_hash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer"."idempotency_records" (
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("scope","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_chosen_route_id_key" ON "core"."quotes"("chosen_route_id");

-- CreateIndex
CREATE INDEX "quotes_developer_id_created_at_idx" ON "core"."quotes"("developer_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_routes_quote_id_idx" ON "core"."quote_routes"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_routes_quote_id_rank_key" ON "core"."quote_routes"("quote_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "recipients_user_id_lookup_hash_key" ON "core"."recipients"("user_id", "lookup_hash");

-- CreateIndex
CREATE INDEX "payouts_developer_id_created_at_idx" ON "core"."payouts"("developer_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_state_updated_at_idx" ON "core"."payouts"("state", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_developer_id_client_reference_key" ON "core"."payouts"("developer_id", "client_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payout_events_payout_id_version_key" ON "core"."payout_events"("payout_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "ledger"."accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_idempotency_key_key" ON "ledger"."journal_entries"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_payout_id_posting_type_key" ON "ledger"."journal_entries"("payout_id", "posting_type");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "ledger"."journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "ledger"."journal_lines"("account_id");

-- CreateIndex
CREATE INDEX "outbox_unpublished_idx" ON "messaging"."outbox"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "timers_dedupe_key_key" ON "messaging"."timers"("dedupe_key");

-- CreateIndex
CREATE INDEX "timers_due_at_idx" ON "messaging"."timers"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "auth"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_near_account_key" ON "auth"."users"("near_account");

-- CreateIndex
CREATE UNIQUE INDEX "passkey_credentials_credential_id_key" ON "auth"."passkey_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "passkey_credentials_user_id_idx" ON "auth"."passkey_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_hash_key" ON "auth"."sessions"("refresh_hash");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "auth"."sessions"("family_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "auth"."sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_links_token_hash_key" ON "auth"."email_links"("token_hash");

-- CreateIndex
CREATE INDEX "workspaces_owner_id_idx" ON "developer"."workspaces"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "developer"."api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_workspace_id_idx" ON "developer"."api_keys"("workspace_id");

-- CreateIndex
CREATE INDEX "idempotency_records_created_at_idx" ON "developer"."idempotency_records"("created_at");

-- AddForeignKey
ALTER TABLE "core"."quote_routes" ADD CONSTRAINT "quote_routes_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "core"."quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."payouts" ADD CONSTRAINT "payouts_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "core"."quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."payouts" ADD CONSTRAINT "payouts_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "core"."recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."payouts" ADD CONSTRAINT "payouts_retry_of_id_fkey" FOREIGN KEY ("retry_of_id") REFERENCES "core"."payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."payout_events" ADD CONSTRAINT "payout_events_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "core"."payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger"."journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger"."journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger"."balances" ADD CONSTRAINT "balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer"."workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer"."api_keys" ADD CONSTRAINT "api_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "developer"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

