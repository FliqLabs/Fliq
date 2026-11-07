-- Expand only: keys made before this keep working and get the default name.
ALTER TABLE "developer"."api_keys" ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Sandbox key';
ALTER TABLE "developer"."api_keys" ADD COLUMN "last_used_at" TIMESTAMPTZ(6);

-- ARCH §16.4: one row per privileged action. No foreign keys, so the trail outlives what it describes.
CREATE TABLE "developer"."audit_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "developer"."audit_events"("workspace_id", "created_at");

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON developer.audit_events
FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
