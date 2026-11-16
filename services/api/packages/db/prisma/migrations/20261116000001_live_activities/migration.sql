CREATE TABLE "auth"."live_activities" (
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "last_sent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "live_activities_pkey" PRIMARY KEY ("token")
);
CREATE INDEX "live_activities_ended_at_created_at_idx" ON "auth"."live_activities"("ended_at", "created_at");
