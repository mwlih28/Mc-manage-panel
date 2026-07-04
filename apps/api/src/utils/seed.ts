import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user — skip gracefully if username or email already taken
  const hashedPassword = await bcrypt.hash('Admin123!', 12);
  let admin = await prisma.user.findFirst({ where: { OR: [{ email: 'admin@example.com' }, { username: 'admin' }] } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: 'admin@example.com',
        username: 'admin',
        password: hashedPassword,
        firstName: 'Panel',
        lastName: 'Admin',
        role: 'ADMIN',
        rootAdmin: true,
      },
    });
    console.log('Admin user created:', admin.email);
  } else {
    console.log('Admin user already exists, skipping');
  }

  // Create a demo user — skip gracefully if username or email already taken
  const userPassword = await bcrypt.hash('User123!', 12);
  let user = await prisma.user.findFirst({ where: { OR: [{ email: 'user@example.com' }, { username: 'demouser' }] } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'user@example.com',
        username: 'demouser',
        password: userPassword,
        firstName: 'Demo',
        lastName: 'User',
        role: 'USER',
      },
    });
    console.log('Demo user created:', user.email);
  } else {
    console.log('Demo user already exists, skipping');
  }

  // Create demo node
  const nodeToken = uuidv4().replace(/-/g, '');
  const node = await prisma.node.upsert({
    where: { name: 'Node 01' },
    update: {},
    create: {
      name: 'Node 01',
      description: 'Primary game server node',
      fqdn: 'node1.example.com',
      scheme: 'https',
      port: 8080,
      daemonPort: 2022,
      memory: 8192,
      memoryOverallocate: 0,
      disk: 51200,
      diskOverallocate: 0,
      token: nodeToken,
      status: 'ONLINE',
    },
  });
  console.log('Node created:', node.name);

  // Create allocations for the node
  const allocations = [];
  for (let port = 25565; port <= 25570; port++) {
    const alloc = await prisma.allocation.upsert({
      where: {
        id: `alloc-${port}`,
      },
      update: {},
      create: {
        id: `alloc-${port}`,
        nodeId: node.id,
        ip: '0.0.0.0',
        port,
        notes: `Port ${port}`,
        assigned: port === 25565,
      },
    });
    allocations.push(alloc);
  }
  console.log('Allocations created');

  // Create Nest
  const minecraftNest = await prisma.nest.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0000-000000000001',
      author: 'support@kretase.com',
      name: 'Minecraft',
      description: 'Minecraft - the classical game',
    },
  });

  // Aikar's optimized JVM flags for Paper/Spigot servers.
  // G1GC with tuned region sizes eliminates the stop-the-world GC pauses
  // that cause multi-second ping spikes. Xms=Xmx prevents heap resize GC.
  const AIKAR_STARTUP =
    'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M' +
    ' -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200' +
    ' -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch' +
    ' -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M' +
    ' -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4' +
    ' -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90' +
    ' -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32' +
    ' -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1' +
    ' -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true' +
    ' -jar {{SERVER_JARFILE}} nogui';

  // PaperMC's old api.papermc.io/v2 was sunset (HTTP 410) — the new API lives
  // at fill.papermc.io/v3 and requires a real User-Agent. No python3/jq
  // dependency (the alpine installer image doesn't reliably have either),
  // so version/build/URL are pulled out of the single-line JSON with grep.
  const PAPER_INSTALL_SCRIPT = `#!/bin/bash
set -e
cd /mnt/server
UA="Kretase-Installer/1.0 (+https://kretase.com)"
MC_VER="\${MC_VERSION:-latest}"
if [ "$MC_VER" = "latest" ]; then
  echo "Resolving latest Paper version..."
  VJSON=$(curl -sSL -H "User-Agent: $UA" "https://fill.papermc.io/v3/projects/paper")
  MC_VER=$(echo "$VJSON" | grep -o '"[0-9][0-9A-Za-z.\\-]*"' | head -1 | tr -d '"')
  MC_VER="\${MC_VER:-1.21.4}"
fi
echo "Fetching latest Paper build for $MC_VER..."
BJSON=$(curl -sSL -H "User-Agent: $UA" "https://fill.papermc.io/v3/projects/paper/versions/$MC_VER/builds/latest")
DOWNLOAD_URL=$(echo "$BJSON" | grep -o '"url":"[^"]*"' | head -1 | sed 's/"url":"//;s/"$//')
if [ -z "$DOWNLOAD_URL" ]; then
  echo "ERROR: Could not resolve a Paper download URL for $MC_VER — check MC_VERSION." >&2
  exit 1
fi
echo "Downloading: $DOWNLOAD_URL"
curl -sSL -H "User-Agent: $UA" -o server.jar "$DOWNLOAD_URL"
echo "Paper $MC_VER installed."`;

  // Create Egg
  const paperEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000002' },
    update: {
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: AIKAR_STARTUP,
      scriptInstall: PAPER_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
    create: {
      uuid: '00000000-0000-0000-0000-000000000002',
      nestId: minecraftNest.id,
      author: 'support@kretase.com',
      name: 'Paper',
      description: 'High performance Minecraft server based on Spigot',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: AIKAR_STARTUP,
      configStop: '^C',
      scriptInstall: PAPER_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  // Migrate any existing servers still using an older Java image to java_21
  await prisma.server.updateMany({
    where: {
      image: { in: ['ghcr.io/pterodactyl/yolks:java_17', 'ghcr.io/pterodactyl/yolks:java_11', 'ghcr.io/pterodactyl/yolks:java_8'] },
    },
    data: { image: 'ghcr.io/pterodactyl/yolks:java_21' },
  });
  console.log('Migrated servers to java_21 image');

  // Migrate existing servers using the old -Xms128M startup to Aikar's flags
  const migratedStartup = await prisma.server.updateMany({
    where: { startup: { contains: '-Xms128M' } },
    data: { startup: AIKAR_STARTUP },
  });
  console.log(`Migrated ${migratedStartup.count} server(s) to Aikar JVM flags`);

  // Ensure every server has SERVER_MEMORY and SERVER_JARFILE in its env JSON.
  // Older servers may be missing these because the create form didn't include them.
  const allServers = await prisma.server.findMany({ select: { id: true, memory: true, env: true } });
  let envFixed = 0;
  for (const srv of allServers) {
    let env: Record<string, string> = {};
    try { env = JSON.parse(srv.env as string) || {}; } catch { /* start fresh */ }
    const changed = !env.SERVER_MEMORY || !env.SERVER_JARFILE;
    if (!env.SERVER_MEMORY) env.SERVER_MEMORY = String(srv.memory);
    if (!env.SERVER_JARFILE) env.SERVER_JARFILE = 'server.jar';
    if (changed) {
      await prisma.server.update({ where: { id: srv.id }, data: { env: JSON.stringify(env) } });
      envFixed++;
    }
  }
  console.log(`Fixed SERVER_MEMORY/SERVER_JARFILE in env for ${envFixed} server(s)`);

  // Unlock CPU for existing servers — cpu=100 (1 core) causes severe TPS lag on Paper.
  // Set to 0 (unlimited) so all host cores are available to Paper's thread pool.
  const cpuUnlocked = await prisma.server.updateMany({
    where: { cpu: 100 },
    data: { cpu: 0 },
  });
  console.log(`Unlocked CPU for ${cpuUnlocked.count} server(s) (was 100 → 0/unlimited)`);

  // Create demo server
  const shortUuid = uuidv4().replace(/-/g, '').slice(0, 8);
  await prisma.server.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0000-000000000003',
      uuidShort: shortUuid,
      userId: user.id,
      nodeId: node.id,
      eggId: paperEgg.id,
      allocationId: allocations[0].id,
      name: 'My Minecraft Server',
      description: 'Demo Minecraft Paper server',
      status: 'OFFLINE',
      memory: 1024,
      disk: 5120,
      cpu: 100,
      startup: AIKAR_STARTUP.replace('{{SERVER_MEMORY}}', '1024').replace('{{SERVER_JARFILE}}', 'server.jar'),
      image: 'ghcr.io/pterodactyl/yolks:java_21',
      env: JSON.stringify({ SERVER_MEMORY: '1024', SERVER_JARFILE: 'server.jar' }),
      backupLimit: 3,
    },
  });
  console.log('Demo server created');

  // No python3/jq dependency — same reasoning as the Paper script above.
  // Mojang's manifest JSON is NOT minified (spaces after colons), so every
  // grep pattern below tolerates optional whitespace around ":".
  const VANILLA_INSTALL_SCRIPT = `#!/bin/bash
set -e
cd /mnt/server
VERSION="\${MC_VERSION:-latest}"
MANIFEST_BASE="https://launchermeta.mojang.com/mc/game/version_manifest.json"
MANIFEST_JSON=$(curl -sSL "$MANIFEST_BASE")
if [ "$VERSION" = "latest" ]; then
  VERSION=$(echo "$MANIFEST_JSON" | grep -oE '"release"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | cut -d'"' -f4)
fi
echo "Downloading Vanilla $VERSION..."
MANIFEST_URL=$(echo "$MANIFEST_JSON" | grep -oE "\\"id\\"[[:space:]]*:[[:space:]]*\\"$VERSION\\"[^}]*" | grep -oE '"url"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$MANIFEST_URL" ] && { echo "Version $VERSION not found"; exit 1; }
JAR_URL=$(curl -sSL "$MANIFEST_URL" | grep -oE '"server"[[:space:]]*:[[:space:]]*\\{[^}]*\\}' | grep -oE '"url"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$JAR_URL" ] && { echo "Could not resolve server jar URL for $VERSION"; exit 1; }
curl -sSL -o server.jar "$JAR_URL"
echo "Vanilla $VERSION installed."`;

  const BUNGEECORD_INSTALL_SCRIPT = `#!/bin/bash
set -e
cd /mnt/server
echo "Downloading BungeeCord..."
curl -sSL -o bungeecord.jar "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar" || {
  echo "Primary URL failed, trying fallback..."
  curl -sSL -o bungeecord.jar "https://github.com/SpigotMC/BungeeCord/releases/latest/download/BungeeCord.jar"
}
echo "BungeeCord installed."`;

  // Same fill.papermc.io/v3 migration as the Paper egg above — the old
  // api.papermc.io/v2 endpoint Velocity used is sunset (HTTP 410), and the
  // python3-based JSON parsing silently fell back to a hardcoded stale
  // version on the (python3-less) alpine installer image.
  const VELOCITY_INSTALL_SCRIPT = `#!/bin/bash
set -e
cd /mnt/server
UA="Kretase-Installer/1.0 (+https://kretase.com)"
VELOCITY_VER="\${VELOCITY_VERSION:-latest}"
if [ "$VELOCITY_VER" = "latest" ]; then
  echo "Resolving latest Velocity version..."
  VJSON=$(curl -sSL -H "User-Agent: $UA" "https://fill.papermc.io/v3/projects/velocity")
  VELOCITY_VER=$(echo "$VJSON" | grep -o '"[0-9][0-9A-Za-z.\\-]*"' | head -1 | tr -d '"')
  VELOCITY_VER="\${VELOCITY_VER:-3.4.0}"
fi
echo "Fetching latest Velocity build for $VELOCITY_VER..."
BJSON=$(curl -sSL -H "User-Agent: $UA" "https://fill.papermc.io/v3/projects/velocity/versions/$VELOCITY_VER/builds/latest")
DOWNLOAD_URL=$(echo "$BJSON" | grep -o '"url":"[^"]*"' | head -1 | sed 's/"url":"//;s/"$//')
if [ -z "$DOWNLOAD_URL" ]; then
  echo "ERROR: Could not resolve a Velocity download URL for $VELOCITY_VER — check VELOCITY_VERSION." >&2
  exit 1
fi
echo "Downloading: $DOWNLOAD_URL"
curl -sSL -H "User-Agent: $UA" -o velocity.jar "$DOWNLOAD_URL"
echo "Velocity $VELOCITY_VER installed."`;

  // Vanilla Minecraft
  await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000004' },
    update: {
      startup: 'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui',
      scriptInstall: VANILLA_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
    create: {
      uuid: '00000000-0000-0000-0000-000000000004',
      nestId: minecraftNest.id,
      author: 'support@kretase.com',
      name: 'Vanilla Minecraft',
      description: 'Standard Mojang vanilla server',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: 'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui',
      configStop: 'stop',
      scriptInstall: VANILLA_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  // BungeeCord
  const bungeeEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000005' },
    update: {
      scriptInstall: BUNGEECORD_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
    create: {
      uuid: '00000000-0000-0000-0000-000000000005',
      nestId: minecraftNest.id,
      author: 'support@kretase.com',
      name: 'BungeeCord',
      description: 'Minecraft proxy server by md-5',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: 'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}',
      configStop: 'end',
      scriptInstall: BUNGEECORD_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  // The install script downloads bungeecord.jar, not the generic server.jar
  // that the server-creation route defaults SERVER_JARFILE to — without this
  // override the startup command points at a file that doesn't exist.
  await prisma.eggVariable.upsert({
    where: { id: 'bungeecord-jarfile-var' },
    update: { defaultValue: 'bungeecord.jar' },
    create: {
      id: 'bungeecord-jarfile-var',
      eggId: bungeeEgg.id,
      name: 'Server Jar File',
      description: 'The jar file to run',
      envVariable: 'SERVER_JARFILE',
      defaultValue: 'bungeecord.jar',
      userViewable: true,
      userEditable: false,
    },
  });

  // Velocity
  const velocityEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000006' },
    update: {
      scriptInstall: VELOCITY_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
    create: {
      uuid: '00000000-0000-0000-0000-000000000006',
      nestId: minecraftNest.id,
      author: 'support@kretase.com',
      name: 'Velocity',
      description: 'High performance Minecraft proxy by PaperMC',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: 'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -XX:+UseG1GC -XX:G1HeapRegionSize=4M -XX:+UnlockExperimentalVMOptions -XX:+ParallelRefProcEnabled -XX:+AlwaysPreTouch -jar {{SERVER_JARFILE}}',
      configStop: 'shutdown',
      scriptInstall: VELOCITY_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  // Same SERVER_JARFILE mismatch as BungeeCord above — the script downloads
  // velocity.jar.
  await prisma.eggVariable.upsert({
    where: { id: 'velocity-jarfile-var' },
    update: { defaultValue: 'velocity.jar' },
    create: {
      id: 'velocity-jarfile-var',
      eggId: velocityEgg.id,
      name: 'Server Jar File',
      description: 'The jar file to run',
      envVariable: 'SERVER_JARFILE',
      defaultValue: 'velocity.jar',
      userViewable: true,
      userEditable: false,
    },
  });

  await prisma.eggVariable.upsert({
    where: { id: 'velocity-version-var' },
    update: {},
    create: {
      id: 'velocity-version-var',
      eggId: velocityEgg.id,
      name: 'Velocity Version',
      description: 'Velocity version to install, or "latest"',
      envVariable: 'VELOCITY_VERSION',
      defaultValue: 'latest',
      userViewable: true,
      userEditable: true,
    },
  });

  // Existing BungeeCord/Velocity servers created before the fix above still
  // carry the wrong SERVER_JARFILE=server.jar default — correct them so
  // their startup command points at the jar the install script actually
  // downloaded.
  for (const [eggId, jarfile] of [[bungeeEgg.id, 'bungeecord.jar'], [velocityEgg.id, 'velocity.jar']] as const) {
    const affected = await prisma.server.findMany({ where: { eggId }, select: { id: true, env: true } });
    for (const srv of affected) {
      let env: Record<string, string> = {};
      try { env = JSON.parse(srv.env as string) || {}; } catch { /* start fresh */ }
      if (env.SERVER_JARFILE !== jarfile) {
        env.SERVER_JARFILE = jarfile;
        await prisma.server.update({ where: { id: srv.id }, data: { env: JSON.stringify(env) } });
      }
    }
  }

  // Bedrock install script runs in ghcr.io/pterodactyl/installers:alpine
  // which has bash, curl, unzip — no Python3 dependency.
  // Server runs in debian:bookworm-slim (has glibc required by BDS binary).
  const BEDROCK_INSTALL_SCRIPT = `#!/bin/bash
set -e
cd /mnt/server

BDS_VER="\${BDS_VERSION:-LATEST}"

if [ "\$BDS_VER" = "LATEST" ]; then
  echo "Auto-detecting latest BDS version from Minecraft website..."
  BDS_VER=\$(curl -fsSL \
    -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
    -H "Accept: text/html" \
    --max-time 20 \
    'https://www.minecraft.net/en-us/download/server/bedrock' 2>/dev/null | \
    grep -oE 'bin-linux/bedrock-server-[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+\\.zip' | \
    head -1 | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+' || echo "")
fi

# If detection failed, try known recent stable versions in order
if [ -z "\$BDS_VER" ]; then
  echo "Web detection failed. Probing known versions..."
  for TRY_VER in 1.21.62.01 1.21.61.01 1.21.60.01 1.21.51.02 1.21.50.07 1.21.50.02 1.21.44.01 1.21.43.01 1.21.41.01 1.21.30.03 1.21.2.02 1.21.1.02; do
    CHECK_URL="https://minecraft.azureedge.net/bin-linux/bedrock-server-\${TRY_VER}.zip"
    if curl -fsSL -r 0-1 -o /dev/null "\$CHECK_URL" -A "Mozilla/5.0" --max-time 10 2>/dev/null; then
      BDS_VER="\$TRY_VER"
      echo "Found working version: \$BDS_VER"
      break
    fi
  done
fi

[ -z "\$BDS_VER" ] && { echo "ERROR: Could not determine BDS version. Set BDS_VERSION variable manually (e.g. 1.21.51.02)."; exit 1; }

echo "Downloading Bedrock Dedicated Server \${BDS_VER}..."
PRIMARY="https://minecraft.azureedge.net/bin-linux/bedrock-server-\${BDS_VER}.zip"
PREVIEW="https://minecraft.azureedge.net/bin-linux-preview/bedrock-server-\${BDS_VER}.zip"

curl -fsSL -o bedrock-server.zip "\$PRIMARY" -A "Mozilla/5.0" 2>/dev/null || \
curl -fsSL -o bedrock-server.zip "\$PREVIEW"  -A "Mozilla/5.0" 2>/dev/null || {
  echo "ERROR: Download failed for BDS \${BDS_VER}. Check BDS_VERSION variable."
  exit 1
}

unzip -o bedrock-server.zip
rm -f bedrock-server.zip
chmod +x bedrock_server
echo "Bedrock Server \${BDS_VER} installed successfully."`;

  // Minecraft Bedrock
  const bedrockEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000008' },
    update: {
      scriptInstall: BEDROCK_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
    create: {
      uuid: '00000000-0000-0000-0000-000000000008',
      nestId: minecraftNest.id,
      author: 'support@kretase.com',
      name: 'Minecraft Bedrock',
      description: 'Minecraft Bedrock Edition Dedicated Server (BDS)',
      dockerImage: 'debian:bookworm-slim',
      startup: 'LD_LIBRARY_PATH=. ./bedrock_server',
      configStop: 'stop',
      scriptInstall: BEDROCK_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  // SERVER_TYPE env variable for Bedrock egg so Wings can detect the server type
  await prisma.eggVariable.upsert({
    where: { id: 'bedrock-server-type-var' },
    update: {},
    create: {
      id: 'bedrock-server-type-var',
      eggId: bedrockEgg.id,
      name: 'Server Type',
      description: 'Internal marker for Wings to detect Bedrock servers',
      envVariable: 'SERVER_TYPE',
      defaultValue: 'BEDROCK',
      userViewable: false,
      userEditable: false,
    },
  });

  // BDS_VERSION variable — lets users pin a specific Bedrock version
  await prisma.eggVariable.upsert({
    where: { id: 'bedrock-bds-version-var' },
    update: { defaultValue: 'LATEST' },
    create: {
      id: 'bedrock-bds-version-var',
      eggId: bedrockEgg.id,
      name: 'BDS Version',
      description: 'Bedrock Dedicated Server version to install (e.g. 1.21.51.02), or LATEST to auto-detect',
      envVariable: 'BDS_VERSION',
      defaultValue: 'LATEST',
      userViewable: true,
      userEditable: true,
    },
  });

  // Bedrock allocations
  for (let port = 19132; port <= 19135; port++) {
    await prisma.allocation.upsert({
      where: { id: `alloc-bedrock-${port}` },
      update: {},
      create: {
        id: `alloc-bedrock-${port}`,
        nodeId: node.id,
        ip: '0.0.0.0',
        port,
        notes: `Bedrock UDP Port ${port}`,
        assigned: false,
      },
    });
  }
  console.log('Bedrock allocations created');

  // Fabric server installer is much more reliable to automate headlessly than
  // Forge (whose run-script generation has changed shape across MC version
  // eras) — the installer itself resolves "latest" when flags are omitted,
  // so no manual version-detection logic is needed here.
  const FABRIC_INSTALL_SCRIPT = `#!/bin/bash
set -e
cd /mnt/server
UA="Kretase-Installer/1.0 (+https://kretase.com)"
MC_VER="\${MC_VERSION:-latest}"
LOADER_VER="\${FABRIC_LOADER_VERSION:-latest}"

INSTALLER_URL=$(curl -sSL -H "User-Agent: $UA" "https://meta.fabricmc.net/v2/versions/installer" | tr -d '\\n' | grep -oE '\\{[^{}]*\\}' | grep -F '"stable": true' | head -1 | grep -oE '"url"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
[ -z "$INSTALLER_URL" ] && { echo "Could not resolve Fabric installer URL"; exit 1; }

echo "Downloading Fabric installer..."
curl -sSL -H "User-Agent: $UA" -o fabric-installer.jar "$INSTALLER_URL"

ARGS="server -downloadMinecraft"
[ "$MC_VER" != "latest" ] && ARGS="$ARGS -mcversion $MC_VER"
[ "$LOADER_VER" != "latest" ] && ARGS="$ARGS -loader $LOADER_VER"

echo "Installing Fabric (mc=$MC_VER loader=$LOADER_VER)..."
java -jar fabric-installer.jar $ARGS

rm -f fabric-installer.jar
echo "Fabric installed."`;

  const fabricEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000009' },
    update: {
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      scriptInstall: FABRIC_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
    create: {
      uuid: '00000000-0000-0000-0000-000000000009',
      nestId: minecraftNest.id,
      author: 'support@kretase.com',
      name: 'Fabric',
      description: 'Modded Minecraft server using the Fabric mod loader',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: 'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar fabric-server-launch.jar nogui',
      configStop: 'stop',
      scriptInstall: FABRIC_INSTALL_SCRIPT,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  await prisma.eggVariable.upsert({
    where: { id: 'fabric-mc-version-var' },
    update: {},
    create: {
      id: 'fabric-mc-version-var',
      eggId: fabricEgg.id,
      name: 'Minecraft Version',
      description: 'Minecraft version to install, or "latest"',
      envVariable: 'MC_VERSION',
      defaultValue: 'latest',
      userViewable: true,
      userEditable: true,
    },
  });

  await prisma.eggVariable.upsert({
    where: { id: 'fabric-loader-version-var' },
    update: {},
    create: {
      id: 'fabric-loader-version-var',
      eggId: fabricEgg.id,
      name: 'Fabric Loader Version',
      description: 'Fabric loader version to install, or "latest"',
      envVariable: 'FABRIC_LOADER_VERSION',
      defaultValue: 'latest',
      userViewable: true,
      userEditable: true,
    },
  });
  console.log('Fabric egg created');

  // Create Games nest
  const gamesNest = await prisma.nest.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000001' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0001-000000000001',
      author: 'support@kretase.com',
      name: 'Game Servers',
      description: 'Non-Minecraft game servers',
    },
  });

  // ghcr.io/parkervcp/installers:debian does NOT ship a `steamcmd` binary on
  // PATH — every earlier version of these scripts assumed it did and failed
  // with "steamcmd: command not found". Verified against pelican-eggs'
  // actual, currently-working install script: SteamCMD has to be downloaded
  // and extracted by the script itself, then invoked as ./steamcmd.sh. Also
  // stages the 32/64-bit steamclient.so libs some engines need at runtime
  // (harmless — `|| true` — for engines/app IDs that don't ship one).
  function steamCmdInstall(gameLabel: string, appId: number): string {
    return `#!/bin/bash
set -e
cd /tmp
mkdir -p /mnt/server/steamcmd
curl -sSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
tar -xzvf steamcmd.tar.gz -C /mnt/server/steamcmd
mkdir -p /mnt/server/steamapps
cd /mnt/server/steamcmd
chown -R root:root /mnt
export HOME=/mnt/server
echo "Installing ${gameLabel} via SteamCMD..."
./steamcmd.sh +force_install_dir /mnt/server +login anonymous +app_update ${appId} validate +quit
mkdir -p /mnt/server/.steam/sdk32
cp -v linux32/steamclient.so ../.steam/sdk32/steamclient.so 2>/dev/null || true
mkdir -p /mnt/server/.steam/sdk64
cp -v linux64/steamclient.so ../.steam/sdk64/steamclient.so 2>/dev/null || true
echo "${gameLabel} installed."`;
  }

  const RUST_INSTALL = steamCmdInstall('Rust', 258550);
  const GMOD_INSTALL = steamCmdInstall("Garry's Mod", 4020);
  const CS2_INSTALL = steamCmdInstall('CS2', 730);
  const ARK_INSTALL = steamCmdInstall('ARK', 376030);

  // Same class of bug as the Velocity install script fixed earlier this
  // project: shelling out to python3 to parse GitHub's release JSON, which
  // the alpine installer image doesn't reliably have. grep/sed only.
  const TSHOCK_INSTALL = `#!/bin/bash
set -e
cd /mnt/server
command -v unzip >/dev/null 2>&1 || apk add --no-cache unzip >/dev/null 2>&1 || true
echo "Fetching latest TShock release..."
TSHOCK_JSON=$(curl -sSL -H "User-Agent: Kretase-Installer/1.0" https://api.github.com/repos/Pryaxis/TShock/releases/latest)
TSHOCK_URL=$(echo "$TSHOCK_JSON" | grep -o '"browser_download_url": *"[^"]*TShock[^"]*\\.zip"' | head -1 | sed 's/.*"\\(https[^"]*\\)"/\\1/')
[ -z "$TSHOCK_URL" ] && { echo "Could not find TShock download URL"; exit 1; }
echo "Downloading: $TSHOCK_URL"
curl -sSL -o tshock.zip "$TSHOCK_URL"
unzip -o tshock.zip
rm -f tshock.zip
chmod +x TShock.Server 2>/dev/null || true
echo "TShock installed."`;

  // SteamCMD-based installs need a container with steamcmd actually in it —
  // ghcr.io/pterodactyl/installers only ships source/debian/alpine (no
  // "steam" tag exists), so every SteamCMD egg below was failing at the
  // install step with an image-pull error. ghcr.io/parkervcp/installers:debian
  // is the real, community-proven image used for this by the eggs it was
  // adapted from.
  const STEAM_INSTALLER = 'ghcr.io/parkervcp/installers:debian';

  // Runtime images (what the server actually RUNS in, as opposed to the
  // installer above). Cross-checked against pelican-eggs' currently-published
  // egg configs — ghcr.io/pterodactyl/games only ships fivem/source/rust/
  // hytale/conan_exiles, and using the generic "source" tag for every non-
  // Minecraft game (including ARK, which isn't Source engine at all, and
  // CS2, which needs the newer SteamRT3 "sniper" runtime, not the classic
  // "source"/SteamRT1 one) meant these containers were missing the specific
  // shared libraries each game actually needs and would fail or hang on
  // launch even once the install step succeeded.
  const RUST_IMAGE = 'ghcr.io/parkervcp/games:rust';
  const SOURCE_IMAGE = 'ghcr.io/parkervcp/games:source';
  const CS2_IMAGE = 'ghcr.io/parkervcp/steamcmd:sniper';
  const ARK_IMAGE = 'ghcr.io/parkervcp/steamcmd:debian';

  // CS2 requires LD_LIBRARY_PATH pointed at its own bundled steamrt libs —
  // without it the binary fails to find its Source 2 runtime libraries even
  // on the correct "sniper" image. Matches pelican-eggs' verified-working
  // startup command.
  const CS2_STARTUP = 'LD_LIBRARY_PATH=$HOME/game/bin/linuxsteamrt64:$LD_LIBRARY_PATH ./game/bin/linuxsteamrt64/cs2 -dedicated -port {{SERVER_PORT}} +map {{DEFAULT_MAP}} -maxplayers {{MAX_PLAYERS}} +sv_setsteamaccount {{STEAM_ACC}}';

  async function upsertEggVariable(id: string, eggId: string, name: string, envVariable: string, defaultValue: string, description: string, userEditable = true) {
    await prisma.eggVariable.upsert({
      where: { id },
      update: { defaultValue },
      create: { id, eggId, name, envVariable, defaultValue, description, userViewable: true, userEditable },
    });
  }

  // Rust
  const rustEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000001' },
    update: { scriptInstall: RUST_INSTALL, scriptContainer: STEAM_INSTALLER, dockerImage: RUST_IMAGE, author: 'support@kretase.com' },
    create: {
      uuid: '00000000-0000-0000-0001-000000000001',
      nestId: gamesNest.id,
      author: 'support@kretase.com',
      name: 'Rust',
      description: 'Rust survival game server (requires SteamCMD)',
      dockerImage: RUST_IMAGE,
      startup: './RustDedicated -batchmode +server.ip 0.0.0.0 +server.port {{SERVER_PORT}} +server.queryport {{QUERY_PORT}} +rcon.ip 0.0.0.0 +rcon.port {{RCON_PORT}} +rcon.password "{{RCON_PASSWORD}}" +server.maxplayers {{MAX_PLAYERS}} +server.hostname "{{SERVER_NAME}}" +server.identity "{{SERVER_IDENT}}" +server.seed {{SERVER_SEED}} +server.worldsize {{WORLD_SIZE}} -logfile /dev/stdout',
      configStop: 'quit',
      scriptInstall: RUST_INSTALL,
      scriptContainer: STEAM_INSTALLER,
    },
  });
  await upsertEggVariable('rust-rcon-password', rustEgg.id, 'RCON Password', 'RCON_PASSWORD', 'ChangeMe123', 'Password for remote console access — change this before going public.');
  await upsertEggVariable('rust-max-players', rustEgg.id, 'Max Players', 'MAX_PLAYERS', '50', 'Maximum concurrent players.');
  await upsertEggVariable('rust-server-name', rustEgg.id, 'Server Name', 'SERVER_NAME', 'A Kretase-powered Rust Server', 'Name shown in the server browser.');
  await upsertEggVariable('rust-seed', rustEgg.id, 'World Seed', 'SERVER_SEED', '12345', 'Map generation seed.');
  await upsertEggVariable('rust-world-size', rustEgg.id, 'World Size', 'WORLD_SIZE', '3000', 'Map size — 3000-4000 is typical.');

  // Garry's Mod
  const gmodEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000002' },
    update: { scriptInstall: GMOD_INSTALL, scriptContainer: STEAM_INSTALLER, dockerImage: SOURCE_IMAGE, author: 'support@kretase.com' },
    create: {
      uuid: '00000000-0000-0000-0001-000000000002',
      nestId: gamesNest.id,
      author: 'support@kretase.com',
      name: "Garry's Mod",
      description: 'Source Engine sandbox game',
      dockerImage: SOURCE_IMAGE,
      startup: './srcds_run -game garrysmod -console -port {{SERVER_PORT}} +ip 0.0.0.0 +maxplayers {{MAX_PLAYERS}} +map {{DEFAULT_MAP}} -strictportbind -norestart +sv_setsteamaccount {{STEAM_ACC}}',
      configStop: 'quit',
      scriptInstall: GMOD_INSTALL,
      scriptContainer: STEAM_INSTALLER,
    },
  });
  await upsertEggVariable('gmod-max-players', gmodEgg.id, 'Max Players', 'MAX_PLAYERS', '16', 'Maximum concurrent players.');
  await upsertEggVariable('gmod-default-map', gmodEgg.id, 'Default Map', 'DEFAULT_MAP', 'gm_construct', 'Map to load on startup.');
  await upsertEggVariable('gmod-steam-acc', gmodEgg.id, 'Game Server Login Token', 'STEAM_ACC', '', 'Optional GSLT from https://steamcommunity.com/dev/managegameservers — needed for public server-list visibility, not required to run.');

  // CS2
  const cs2Egg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000003' },
    update: { scriptInstall: CS2_INSTALL, scriptContainer: STEAM_INSTALLER, dockerImage: CS2_IMAGE, startup: CS2_STARTUP, author: 'support@kretase.com' },
    create: {
      uuid: '00000000-0000-0000-0001-000000000003',
      nestId: gamesNest.id,
      author: 'support@kretase.com',
      name: 'Counter-Strike 2',
      description: 'CS2 dedicated server',
      dockerImage: CS2_IMAGE,
      startup: CS2_STARTUP,
      configStop: 'quit',
      scriptInstall: CS2_INSTALL,
      scriptContainer: STEAM_INSTALLER,
    },
  });
  await upsertEggVariable('cs2-default-map', cs2Egg.id, 'Default Map', 'DEFAULT_MAP', 'de_dust2', 'Map to load on startup.');
  await upsertEggVariable('cs2-max-players', cs2Egg.id, 'Max Players', 'MAX_PLAYERS', '10', 'Maximum concurrent players.');
  await upsertEggVariable('cs2-steam-acc', cs2Egg.id, 'Game Server Login Token', 'STEAM_ACC', '', 'Optional GSLT from https://steamcommunity.com/dev/managegameservers — needed for public server-list visibility, not required to run.');

  // ARK: Survival Evolved
  const arkEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000004' },
    update: { scriptInstall: ARK_INSTALL, scriptContainer: STEAM_INSTALLER, dockerImage: ARK_IMAGE, author: 'support@kretase.com' },
    create: {
      uuid: '00000000-0000-0000-0001-000000000004',
      nestId: gamesNest.id,
      author: 'support@kretase.com',
      name: 'ARK: Survival Evolved',
      description: 'ARK dedicated server',
      dockerImage: ARK_IMAGE,
      startup: './ShooterGame/Binaries/Linux/ShooterGameServer {{MAP}}?listen?ServerPassword={{SERVER_PASSWORD}}?ServerAdminPassword={{ADMIN_PASSWORD}}?RCONEnabled=True?RCONPort={{RCON_PORT}} -port={{SERVER_PORT}} -queryport={{QUERY_PORT}} -NoBattlEye',
      configStop: 'DoExit',
      scriptInstall: ARK_INSTALL,
      scriptContainer: STEAM_INSTALLER,
    },
  });
  await upsertEggVariable('ark-map', arkEgg.id, 'Map', 'MAP', 'TheIsland', 'Map to load — TheIsland, TheCenter, Ragnarok, ScorchedEarth_P, Aberration_P, Extinction, and more.');
  await upsertEggVariable('ark-server-password', arkEgg.id, 'Server Password', 'SERVER_PASSWORD', '', 'Optional password players must enter to join.');
  await upsertEggVariable('ark-admin-password', arkEgg.id, 'Admin Password', 'ADMIN_PASSWORD', 'PleaseChangeMe', 'Password for in-game admin commands — change this before going public.');

  // Terraria / TShock
  const tshockEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000005' },
    update: { scriptInstall: TSHOCK_INSTALL, scriptContainer: 'ghcr.io/pterodactyl/installers:alpine', author: 'support@kretase.com' },
    create: {
      uuid: '00000000-0000-0000-0001-000000000005',
      nestId: gamesNest.id,
      author: 'support@kretase.com',
      name: 'Terraria (TShock)',
      description: 'Terraria server with TShock plugin API',
      dockerImage: 'ghcr.io/pterodactyl/yolks:dotnet_6',
      startup: './TShock.Server -port {{SERVER_PORT}} -maxplayers {{MAX_PLAYERS}} -world {{WORLD_NAME}}.wld -autocreate {{WORLD_SIZE}} -worldname {{WORLD_NAME}}',
      configStop: 'exit',
      scriptInstall: TSHOCK_INSTALL,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });
  await upsertEggVariable('tshock-max-players', tshockEgg.id, 'Max Players', 'MAX_PLAYERS', '8', 'Maximum concurrent players.');
  await upsertEggVariable('tshock-world-name', tshockEgg.id, 'World Name', 'WORLD_NAME', 'world', 'Name of the world file (without .wld).');
  await upsertEggVariable('tshock-world-size', tshockEgg.id, 'World Size', 'WORLD_SIZE', '1', '1 = small, 2 = medium, 3 = large. Only used the first time the world is created.');

  console.log('Eggs created/updated');

  console.log('\nSeed complete!');
  console.log('Admin login: admin@example.com / Admin123!');
  console.log('User login: user@example.com / User123!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
