-- Expand step: nullable-safe default so existing rows stay valid.
ALTER TABLE "developer"."api_keys" ADD COLUMN "prefix" TEXT NOT NULL DEFAULT '';
ALTER TABLE "developer"."api_keys" ALTER COLUMN "prefix" DROP DEFAULT;
