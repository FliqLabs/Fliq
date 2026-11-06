-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "status";

-- CreateEnum
CREATE TYPE "status"."CheckResult" AS ENUM ('ok', 'degraded', 'down');

-- CreateEnum
CREATE TYPE "status"."IncidentImpact" AS ENUM ('degraded', 'outage');

-- CreateEnum
CREATE TYPE "status"."IncidentState" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "status"."health_checks" (
    "id" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "status"."CheckResult" NOT NULL,
    "latency_ms" INTEGER,
    "error_kind" TEXT,

    CONSTRAINT "health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status"."incidents" (
    "id" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "impact" "status"."IncidentImpact" NOT NULL,
    "state" "status"."IncidentState" NOT NULL DEFAULT 'open',
    "summary" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_checks_component_checked_at_idx" ON "status"."health_checks"("component", "checked_at");

-- CreateIndex
CREATE INDEX "health_checks_checked_at_idx" ON "status"."health_checks"("checked_at");

-- CreateIndex
CREATE INDEX "incidents_component_started_at_idx" ON "status"."incidents"("component", "started_at");

-- CreateIndex
CREATE INDEX "incidents_started_at_idx" ON "status"."incidents"("started_at");


-- The status page and the metrics work read these; they hold only component ids, times and results.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fliq_analytics') THEN
    GRANT USAGE ON SCHEMA status TO fliq_analytics;
    GRANT SELECT ON status.health_checks, status.incidents TO fliq_analytics;
  END IF;
END;
$$;
