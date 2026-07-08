-- Dedup ledger for store webhook fulfillment — see model comment in schema.prisma.
CREATE TABLE "StoreEventLog" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreEventLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreEventLog_integrationId_eventId_key" ON "StoreEventLog"("integrationId", "eventId");
