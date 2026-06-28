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
      author: 'support@pterodactyl.io',
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

  // Create Egg
  const paperEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000002' },
    update: {
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: AIKAR_STARTUP,
    },
    create: {
      uuid: '00000000-0000-0000-0000-000000000002',
      nestId: minecraftNest.id,
      author: 'support@pterodactyl.io',
      name: 'Paper',
      description: 'High performance Minecraft server based on Spigot',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: AIKAR_STARTUP,
      configStop: '^C',
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

  // Vanilla Minecraft
  await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000004' },
    update: { startup: 'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui' },
    create: {
      uuid: '00000000-0000-0000-0000-000000000004',
      nestId: minecraftNest.id,
      author: 'support@pterodactyl.io',
      name: 'Vanilla Minecraft',
      description: 'Standard Mojang vanilla server',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: 'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui',
      configStop: 'stop',
      scriptInstall: `#!/bin/bash
cd /mnt/server
VERSION="\${MC_VERSION:-latest}"
if [ "$VERSION" = "latest" ]; then
  VERSION=$(curl -sS https://launchermeta.mojang.com/mc/game/version_manifest.json | python3 -c "import sys,json;print(json.load(sys.stdin)['latest']['release'])")
fi
MANIFEST_URL=$(curl -sS https://launchermeta.mojang.com/mc/game/version_manifest.json | python3 -c "import sys,json;d=json.load(sys.stdin);v=[x for x in d['versions'] if x['id']==\"$VERSION\"];print(v[0]['url'] if v else '')")
[ -z "$MANIFEST_URL" ] && { echo "Version $VERSION not found"; exit 1; }
JAR_URL=$(curl -sS "$MANIFEST_URL" | python3 -c "import sys,json;print(json.load(sys.stdin)['downloads']['server']['url'])")
curl -sSL -o server.jar "$JAR_URL"
echo "eula=true" > eula.txt
echo "Vanilla $VERSION installed."`,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  // BungeeCord
  await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000005' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0000-000000000005',
      nestId: minecraftNest.id,
      author: 'support@pterodactyl.io',
      name: 'BungeeCord',
      description: 'Minecraft proxy server by md-5',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: 'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}',
      configStop: 'end',
      scriptInstall: `#!/bin/bash
cd /mnt/server
curl -sSL -o bungeecord.jar "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar"
echo "BungeeCord installed."`,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  // Velocity
  await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000006' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0000-000000000006',
      nestId: minecraftNest.id,
      author: 'support@pterodactyl.io',
      name: 'Velocity',
      description: 'High performance Minecraft proxy by PaperMC',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_21',
      startup: 'java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -XX:+UseG1GC -XX:G1HeapRegionSize=4M -XX:+UnlockExperimentalVMOptions -XX:+ParallelRefProcEnabled -XX:+AlwaysPreTouch -jar {{SERVER_JARFILE}}',
      configStop: 'shutdown',
      scriptInstall: `#!/bin/bash
cd /mnt/server
VELOCITY_VERSION=$(curl -sSL https://api.papermc.io/v2/projects/velocity | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['versions'][-1])")
VELOCITY_BUILD=$(curl -sSL "https://api.papermc.io/v2/projects/velocity/versions/$VELOCITY_VERSION" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['builds'][-1])")
JAR="velocity-$VELOCITY_VERSION-$VELOCITY_BUILD.jar"
curl -sSL -o velocity.jar "https://api.papermc.io/v2/projects/velocity/versions/$VELOCITY_VERSION/builds/$VELOCITY_BUILD/downloads/$JAR"
echo "Velocity $VELOCITY_VERSION-$VELOCITY_BUILD installed."`,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  const BEDROCK_INSTALL_SCRIPT = `#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq curl unzip 2>/dev/null
cd /mnt/server
VERSION="\${BDS_VERSION:-LATEST}"
echo "Fetching Bedrock Dedicated Server version info..."
if [ "$VERSION" = "LATEST" ]; then
  LATEST_PAGE=$(curl -sSL -A "Mozilla/5.0" "https://www.minecraft.net/en-us/download/server/bedrock" 2>/dev/null || echo "")
  VERSION=$(echo "$LATEST_PAGE" | grep -oP 'bin-linux/bedrock-server-\\K[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+(?=\\.zip)' | head -1 || echo "1.21.51.02")
fi
DOWNLOAD_URL="https://minecraft.azureedge.net/bin-linux/bedrock-server-\${VERSION}.zip"
echo "Downloading Bedrock Server \${VERSION} from Mojang..."
curl -sSL -o bedrock-server.zip "\$DOWNLOAD_URL" -A "Mozilla/5.0" || {
  echo "Primary URL failed, trying preview URL..."
  curl -sSL -o bedrock-server.zip "https://minecraft.azureedge.net/bin-linux-preview/bedrock-server-\${VERSION}.zip" -A "Mozilla/5.0"
}
unzip -o bedrock-server.zip
rm -f bedrock-server.zip
chmod +x bedrock_server
echo "Bedrock Server \${VERSION} installed."`;

  // Minecraft Bedrock
  const bedrockEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000008' },
    update: {
      scriptInstall: BEDROCK_INSTALL_SCRIPT,
      scriptContainer: 'debian:bookworm-slim',
    },
    create: {
      uuid: '00000000-0000-0000-0000-000000000008',
      nestId: minecraftNest.id,
      author: 'support@pterodactyl.io',
      name: 'Minecraft Bedrock',
      description: 'Minecraft Bedrock Edition Dedicated Server (BDS)',
      dockerImage: 'debian:bookworm-slim',
      startup: 'LD_LIBRARY_PATH=. ./bedrock_server',
      configStop: 'stop',
      scriptInstall: BEDROCK_INSTALL_SCRIPT,
      scriptContainer: 'debian:bookworm-slim',
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

  // Create Games nest
  const gamesNest = await prisma.nest.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000001' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0001-000000000001',
      author: 'support@pterodactyl.io',
      name: 'Game Servers',
      description: 'Non-Minecraft game servers',
    },
  });

  // Rust
  await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000001' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0001-000000000001',
      nestId: gamesNest.id,
      author: 'support@pterodactyl.io',
      name: 'Rust',
      description: 'Rust survival game server (requires SteamCMD)',
      dockerImage: 'ghcr.io/pterodactyl/games:rust',
      startup: './RustDedicated -batchmode +server.ip 0.0.0.0 +server.port {{SERVER_PORT}} +server.queryport {{QUERY_PORT}} +rcon.ip 0.0.0.0 +rcon.port {{RCON_PORT}} +rcon.password "{{RCON_PASSWORD}}" +server.maxplayers {{MAX_PLAYERS}} +server.hostname "{{SERVER_NAME}}" +server.identity "{{SERVER_IDENT}}" +server.seed {{SERVER_SEED}} +server.worldsize {{WORLD_SIZE}} -logfile /dev/stdout',
      configStop: 'quit',
      scriptInstall: `#!/bin/bash
cd /mnt/server
steamcmd +force_install_dir /mnt/server +login anonymous +app_update 258550 validate +quit
echo "Rust server installed."`,
      scriptContainer: 'ghcr.io/pterodactyl/installers:steam',
    },
  });

  // Garry's Mod
  await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000002' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0001-000000000002',
      nestId: gamesNest.id,
      author: 'support@pterodactyl.io',
      name: "Garry's Mod",
      description: 'Source Engine sandbox game',
      dockerImage: 'ghcr.io/pterodactyl/games:source',
      startup: './srcds_run -game garrysmod -console -port {{SERVER_PORT}} +maxplayers {{MAX_PLAYERS}} +map {{DEFAULT_MAP}} -strictportbind -norestart',
      configStop: 'quit',
      scriptInstall: `#!/bin/bash
cd /mnt/server
steamcmd +force_install_dir /mnt/server +login anonymous +app_update 4020 validate +quit
echo "Garry's Mod installed."`,
      scriptContainer: 'ghcr.io/pterodactyl/installers:steam',
    },
  });

  // CS2
  await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000003' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0001-000000000003',
      nestId: gamesNest.id,
      author: 'support@pterodactyl.io',
      name: 'Counter-Strike 2',
      description: 'CS2 dedicated server',
      dockerImage: 'ghcr.io/pterodactyl/games:source',
      startup: './game/bin/linuxsteamrt64/cs2 -dedicated -console -port {{SERVER_PORT}} +map {{DEFAULT_MAP}} +maxplayers_override {{MAX_PLAYERS}} +sv_setsteamaccount {{STEAM_ACC}}',
      configStop: 'quit',
      scriptInstall: `#!/bin/bash
cd /mnt/server
steamcmd +force_install_dir /mnt/server +login anonymous +app_update 730 validate +quit
echo "CS2 dedicated server installed."`,
      scriptContainer: 'ghcr.io/pterodactyl/installers:steam',
    },
  });

  // ARK: Survival Evolved
  await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000004' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0001-000000000004',
      nestId: gamesNest.id,
      author: 'support@pterodactyl.io',
      name: 'ARK: Survival Evolved',
      description: 'ARK dedicated server',
      dockerImage: 'ghcr.io/pterodactyl/games:source',
      startup: './ShooterGame/Binaries/Linux/ShooterGameServer {{MAP}}?listen?ServerPassword={{SERVER_PASSWORD}}?ServerAdminPassword={{ADMIN_PASSWORD}}?RCONEnabled=True?RCONPort={{RCON_PORT}} -port={{SERVER_PORT}} -queryport={{QUERY_PORT}} -NoBattlEye',
      configStop: 'DoExit',
      scriptInstall: `#!/bin/bash
cd /mnt/server
steamcmd +force_install_dir /mnt/server +login anonymous +app_update 376030 validate +quit
echo "ARK server installed."`,
      scriptContainer: 'ghcr.io/pterodactyl/installers:steam',
    },
  });

  // Terraria / TShock
  await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0001-000000000005' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0001-000000000005',
      nestId: gamesNest.id,
      author: 'support@pterodactyl.io',
      name: 'Terraria (TShock)',
      description: 'Terraria server with TShock plugin API',
      dockerImage: 'ghcr.io/pterodactyl/yolks:dotnet_6',
      startup: './TShock.Server -port {{SERVER_PORT}} -maxplayers {{MAX_PLAYERS}} -world {{WORLD_NAME}}.wld -autocreate {{WORLD_SIZE}} -worldname {{WORLD_NAME}}',
      configStop: 'exit',
      scriptInstall: `#!/bin/bash
cd /mnt/server
TSHOCK=$(curl -sS https://api.github.com/repos/Pryaxis/TShock/releases/latest | python3 -c "import sys,json;d=json.load(sys.stdin);[print(a['browser_download_url']) for a in d['assets'] if 'TShock-' in a['name'] and a['name'].endswith('.zip')]" | head -1)
curl -sSL -o tshock.zip "$TSHOCK"
unzip -o tshock.zip
rm tshock.zip
chmod +x TShock.Server
echo "TShock installed."`,
      scriptContainer: 'ghcr.io/pterodactyl/installers:alpine',
    },
  });

  console.log('Eggs created/updated');

  // Create settings
  const settings = [
    { key: 'app:name', value: 'MC Manage Panel' },
    { key: 'app:url', value: 'http://localhost:3001' },
    { key: 'app:version', value: '1.0.0' },
    { key: 'recaptcha:enabled', value: 'false' },
    { key: 'mail:driver', value: 'smtp' },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
  console.log('Settings created');

  console.log('\nSeed complete!');
  console.log('Admin login: admin@example.com / Admin123!');
  console.log('User login: user@example.com / User123!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
