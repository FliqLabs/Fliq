-- One counter row per key per UTC day, incremented as requests finish. Usage reads these rows, never request logs.
CREATE TABLE "developer"."api_usage_daily" (
    "key_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "rate_limited" INTEGER NOT NULL DEFAULT 0,
    "payouts_created" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "api_usage_daily_pkey" PRIMARY KEY ("key_id", "day")
);

CREATE INDEX "api_usage_daily_workspace_id_day_idx" ON "developer"."api_usage_daily"("workspace_id", "day");
