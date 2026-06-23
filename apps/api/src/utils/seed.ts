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
