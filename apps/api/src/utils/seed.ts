import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const hashedPassword = await bcrypt.hash('Admin123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
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

  // Create a demo user
  const userPassword = await bcrypt.hash('User123!', 12);
  const user = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      email: 'user@example.com',
      username: 'demouser',
      password: userPassword,
      firstName: 'Demo',
      lastName: 'User',
      role: 'USER',
    },
  });
  console.log('Demo user created:', user.email);

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

  // Create Egg
  const paperEgg = await prisma.egg.upsert({
    where: { uuid: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      uuid: '00000000-0000-0000-0000-000000000002',
      nestId: minecraftNest.id,
      author: 'support@pterodactyl.io',
      name: 'Paper',
      description: 'High performance Minecraft server based on Spigot',
      dockerImage: 'ghcr.io/pterodactyl/yolks:java_17',
      startup: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}',
      configStop: '^C',
    },
  });

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
      startup: 'java -Xms128M -Xmx1024M -jar server.jar',
      image: 'ghcr.io/pterodactyl/yolks:java_17',
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
