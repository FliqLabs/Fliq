CREATE TABLE "core"."rate_samples" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "rate_before_fees" DECIMAL(24,10) NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "receive_minor" BIGINT NOT NULL,
    "eta_seconds" INTEGER NOT NULL,
    "on_time_percent" INTEGER NOT NULL,
    "sampled_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rate_samples_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rate_samples_token_currency_sampled_at_idx" ON "core"."rate_samples"("token", "currency", "sampled_at");
CREATE INDEX "rate_samples_token_currency_provider_sampled_at_idx" ON "core"."rate_samples"("token", "currency", "provider", "sampled_at");
CREATE INDEX "rate_samples_sampled_at_idx" ON "core"."rate_samples"("sampled_at");

-- The analytics work reads the rate history; it holds only public prices.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fliq_analytics') THEN
    GRANT USAGE ON SCHEMA core TO fliq_analytics;
    GRANT SELECT ON core.rate_samples TO fliq_analytics;
  END IF;
END;
$$;
