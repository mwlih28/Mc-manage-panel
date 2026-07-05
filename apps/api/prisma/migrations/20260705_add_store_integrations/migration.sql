-- Tebex/CraftingStore purchase-webhook -> in-game console command mapping.
CREATE TABLE "StoreIntegration" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "commandMappings" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreIntegration_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StoreIntegration" ADD CONSTRAINT "StoreIntegration_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
