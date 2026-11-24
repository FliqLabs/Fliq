CREATE TABLE "messaging"."notification_deliveries" (
    "message_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "lease_until" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("message_id", "token")
);
