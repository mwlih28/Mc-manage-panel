-- Import-from-another-panel migration tool (Pterodactyl for v1) — tracks
-- one run's progress/log so the admin has an audit trail to poll.
CREATE TABLE "MigrationJob" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'pterodactyl',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "log" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationJob_pkey" PRIMARY KEY ("id")
);
