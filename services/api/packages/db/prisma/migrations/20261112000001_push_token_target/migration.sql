ALTER TABLE "auth"."push_tokens" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production';
ALTER TABLE "auth"."push_tokens" ADD COLUMN "bundle_id" TEXT;
