-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "rootAdmin" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "twoFactor" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLogin" DATETIME
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fqdn" TEXT NOT NULL,
    "scheme" TEXT NOT NULL DEFAULT 'https',
    "port" INTEGER NOT NULL DEFAULT 8080,
    "daemonPort" INTEGER NOT NULL DEFAULT 2022,
    "memory" INTEGER NOT NULL,
    "memoryOverallocate" INTEGER NOT NULL DEFAULT 0,
    "disk" INTEGER NOT NULL,
    "diskOverallocate" INTEGER NOT NULL DEFAULT 0,
    "cpu" INTEGER NOT NULL DEFAULT 0,
    "uploadSize" INTEGER NOT NULL DEFAULT 100,
    "daemonSftp" INTEGER NOT NULL DEFAULT 2022,
    "daemonBase" TEXT NOT NULL DEFAULT '/var/lib/pterodactyl/volumes',
    "behindProxy" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nodeId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "ipAlias" TEXT,
    "port" INTEGER NOT NULL,
    "notes" TEXT,
    "assigned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Allocation_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Egg" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nestId" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dockerImage" TEXT NOT NULL,
    "configFiles" TEXT NOT NULL DEFAULT '[]',
    "configStartup" TEXT NOT NULL DEFAULT '{}',
    "configStop" TEXT NOT NULL DEFAULT '^C',
    "configLogs" TEXT NOT NULL DEFAULT '{}',
    "startup" TEXT NOT NULL,
    "scriptInstall" TEXT,
    "scriptEntry" TEXT NOT NULL DEFAULT 'bash',
    "scriptContainer" TEXT NOT NULL DEFAULT 'alpine:3.4',
    "copyScriptFrom" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Egg_nestId_fkey" FOREIGN KEY ("nestId") REFERENCES "Nest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Nest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uuid" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EggVariable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eggId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "envVariable" TEXT NOT NULL,
    "defaultValue" TEXT NOT NULL DEFAULT '',
    "userViewable" BOOLEAN NOT NULL DEFAULT true,
    "userEditable" BOOLEAN NOT NULL DEFAULT true,
    "rules" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EggVariable_eggId_fkey" FOREIGN KEY ("eggId") REFERENCES "Egg" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "uuid" TEXT NOT NULL,
    "uuidShort" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "eggId" TEXT NOT NULL,
    "allocationId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INSTALLING',
    "skipScripts" BOOLEAN NOT NULL DEFAULT false,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "memory" INTEGER NOT NULL,
    "swap" INTEGER NOT NULL DEFAULT 0,
    "disk" INTEGER NOT NULL,
    "io" INTEGER NOT NULL DEFAULT 500,
    "cpu" INTEGER NOT NULL DEFAULT 0,
    "threads" TEXT,
    "oomDisabled" BOOLEAN NOT NULL DEFAULT false,
    "startup" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "env" TEXT NOT NULL DEFAULT '{}',
    "databaseLimit" INTEGER NOT NULL DEFAULT 0,
    "allocationLimit" INTEGER NOT NULL DEFAULT 0,
    "backupLimit" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Server_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Server_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Server_eggId_fkey" FOREIGN KEY ("eggId") REFERENCES "Egg" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Server_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "uploadId" TEXT,
    "isSuccessful" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "ignoredFiles" TEXT NOT NULL DEFAULT '[]',
    "disk" TEXT NOT NULL DEFAULT 'local',
    "checksum" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Backup_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Database" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "databaseHostId" TEXT NOT NULL,
    "databaseName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "remote" TEXT NOT NULL DEFAULT '%',
    "password" TEXT NOT NULL,
    "maxConnections" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Database_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Database_databaseHostId_fkey" FOREIGN KEY ("databaseHostId") REFERENCES "DatabaseHost" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DatabaseHost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 3306,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "maxDatabases" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "memo" TEXT,
    "allowedIps" TEXT NOT NULL DEFAULT '[]',
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "serverId" TEXT,
    "event" TEXT NOT NULL,
    "properties" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Activity_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Node_name_key" ON "Node"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Node_token_key" ON "Node"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Egg_uuid_key" ON "Egg"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Nest_uuid_key" ON "Nest"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Server_externalId_key" ON "Server"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Server_uuid_key" ON "Server"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Server_uuidShort_key" ON "Server"("uuidShort");

-- CreateIndex
CREATE UNIQUE INDEX "Server_allocationId_key" ON "Server"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Backup_uuid_key" ON "Backup"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_identifier_key" ON "ApiKey"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");
