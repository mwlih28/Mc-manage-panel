-- Maps a PayTR merchant_oid (the only identifier PayTR's callback carries)
-- back to which StoreIntegration/mapping a checkout was created for.
CREATE TABLE "PayTrOrder" (
    "id" TEXT NOT NULL,
    "merchantOid" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayTrOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayTrOrder_merchantOid_key" ON "PayTrOrder"("merchantOid");
