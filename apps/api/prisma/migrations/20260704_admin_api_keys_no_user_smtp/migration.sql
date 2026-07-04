-- Per-user SMTP was a redundant, non-admin-gated duplicate of the real
-- global panel SMTP config (Setting table, configured in Admin -> Settings).
-- Removing it entirely rather than leaving dead columns around.
ALTER TABLE "User" DROP COLUMN IF EXISTS "smtpHost";
ALTER TABLE "User" DROP COLUMN IF EXISTS "smtpPort";
ALTER TABLE "User" DROP COLUMN IF EXISTS "smtpUser";
ALTER TABLE "User" DROP COLUMN IF EXISTS "smtpPass";
ALTER TABLE "User" DROP COLUMN IF EXISTS "smtpFrom";

-- ApiKey was defined in the schema but never actually implemented — no
-- routes touched it. Adding the real fields needed for admin-only API key
-- management (name, permissions, expiration) and dropping the unused memo
-- column it's replacing.
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "permissions" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" DROP COLUMN IF EXISTS "memo";
