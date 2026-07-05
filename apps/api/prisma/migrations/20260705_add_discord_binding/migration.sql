-- Discord bot bidirectional control: links one Discord channel to one
-- Kretase server so /start /stop /restart /status commands in that channel
-- act on that server.
CREATE TABLE "DiscordBinding" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscordBinding_channelId_key" ON "DiscordBinding"("channelId");

ALTER TABLE "DiscordBinding" ADD CONSTRAINT "DiscordBinding_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
