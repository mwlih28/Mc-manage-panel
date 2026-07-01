-- EULA is now accepted per-server by the server's owner at first start,
-- not by the admin at creation time.
ALTER TABLE "Server" ADD COLUMN "eulaAccepted" BOOLEAN NOT NULL DEFAULT false;
