ALTER TABLE "auth"."users" ADD COLUMN "daily_limit_units" BIGINT;
ALTER TABLE "auth"."users" ADD COLUMN "pending_daily_limit_units" BIGINT;
ALTER TABLE "auth"."users" ADD COLUMN "pending_daily_limit_at" TIMESTAMPTZ(6);

CREATE TABLE "core"."spend_holds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "units" BIGINT NOT NULL,
    "released" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spend_holds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "spend_holds_ref_key" ON "core"."spend_holds"("ref");
CREATE INDEX "spend_holds_user_id_created_at_idx" ON "core"."spend_holds"("user_id", "created_at");

CREATE TABLE "auth"."limit_changes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "to_units" BIGINT,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "limit_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "limit_changes_created_at_idx" ON "auth"."limit_changes"("created_at");
