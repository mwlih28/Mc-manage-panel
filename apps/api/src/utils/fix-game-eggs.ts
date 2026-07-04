// One-off, targeted data fix for installs that were seeded before the
// non-Minecraft game eggs (Rust, Garry's Mod, CS2, ARK, TShock) were
// corrected in seed.ts. Unlike re-running the full seed.ts, this script
// touches ONLY those 5 already-existing Egg rows (by their fixed uuids) and
// their EggVariable rows — it never creates users, nodes, or any other demo
// data, so it's safe to run against a live production database.
//
// Usage (from apps/api):
//   npx ts-node src/utils/fix-game-eggs.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STEAM_INSTALLER = 'ghcr.io/parkervcp/installers:debian';

// Runtime images — see the matching comment in seed.ts. The generic
// ghcr.io/pterodactyl/games:source tag was used for every non-Minecraft
// game (including ARK, which isn't Source engine, and CS2, which needs the
// newer SteamRT3 "sniper" runtime, not the classic "source" one), so these
// containers were missing game-specific shared libraries and would fail or
// hang even after the install step succeeded.
const RUST_IMAGE = 'ghcr.io/parkervcp/games:rust';
const SOURCE_IMAGE = 'ghcr.io/parkervcp/games:source';
const CS2_IMAGE = 'ghcr.io/parkervcp/steamcmd:sniper';
const ARK_IMAGE = 'ghcr.io/parkervcp/steamcmd:debian';

const GMOD_STARTUP = './srcds_run -game garrysmod -console -port {{SERVER_PORT}} +ip 0.0.0.0 +maxplayers {{MAX_PLAYERS}} +map {{DEFAULT_MAP}} -strictportbind -norestart +sv_setsteamaccount {{STEAM_ACC}}';
const CS2_STARTUP = 'LD_LIBRARY_PATH=$HOME/game/bin/linuxsteamrt64:$LD_LIBRARY_PATH ./game/bin/linuxsteamrt64/cs2 -dedicated -port {{SERVER_PORT}} +map {{DEFAULT_MAP}} -maxplayers {{MAX_PLAYERS}} +sv_setsteamaccount {{STEAM_ACC}}';

const RUST_INSTALL = `#!/bin/bash
set -e
cd /mnt/server
echo "Installing Rust via SteamCMD..."
steamcmd +force_install_dir /mnt/server +login anonymous +app_update 258550 validate +quit
echo "Rust server installed."`;

const GMOD_INSTALL = `#!/bin/bash
set -e
cd /mnt/server
echo "Installing Garry's Mod via SteamCMD..."
steamcmd +force_install_dir /mnt/server +login anonymous +app_update 4020 validate +quit
echo "Garry's Mod installed."`;

const CS2_INSTALL = `#!/bin/bash
set -e
cd /mnt/server
echo "Installing CS2 via SteamCMD..."
steamcmd +force_install_dir /mnt/server +login anonymous +app_update 730 validate +quit
echo "CS2 dedicated server installed."`;

const ARK_INSTALL = `#!/bin/bash
set -e
cd /mnt/server
echo "Installing ARK via SteamCMD..."
steamcmd +force_install_dir /mnt/server +login anonymous +app_update 376030 validate +quit
echo "ARK server installed."`;

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

async function upsertEggVariable(id: string, eggId: string, name: string, envVariable: string, defaultValue: string, description: string, userEditable = true) {
  await prisma.eggVariable.upsert({
    where: { id },
    update: { defaultValue },
    create: { id, eggId, name, envVariable, defaultValue, description, userViewable: true, userEditable },
  });
}

async function fixEgg(uuid: string, label: string, scriptInstall: string, scriptContainer: string, dockerImage?: string, startup?: string) {
  const egg = await prisma.egg.findUnique({ where: { uuid } });
  if (!egg) {
    console.log(`SKIP: ${label} egg (uuid ${uuid}) not found on this install — nothing to fix.`);
    return null;
  }
  await prisma.egg.update({
    where: { uuid },
    data: { scriptInstall, scriptContainer, author: 'support@kretase.com', ...(dockerImage ? { dockerImage } : {}), ...(startup ? { startup } : {}) },
  });
  console.log(`Fixed: ${label} egg -> scriptContainer=${scriptContainer}${dockerImage ? `, dockerImage=${dockerImage}` : ''}`);
  return egg;
}

async function main() {
  console.log('Fixing non-Minecraft game eggs (targeted, production-safe)...');

  const rustEgg = await fixEgg('00000000-0000-0000-0001-000000000001', 'Rust', RUST_INSTALL, STEAM_INSTALLER, RUST_IMAGE);
  if (rustEgg) {
    await upsertEggVariable('rust-rcon-password', rustEgg.id, 'RCON Password', 'RCON_PASSWORD', 'ChangeMe123', 'Password for remote console access — change this before going public.');
    await upsertEggVariable('rust-max-players', rustEgg.id, 'Max Players', 'MAX_PLAYERS', '50', 'Maximum concurrent players.');
    await upsertEggVariable('rust-server-name', rustEgg.id, 'Server Name', 'SERVER_NAME', 'A Kretase-powered Rust Server', 'Name shown in the server browser.');
    await upsertEggVariable('rust-seed', rustEgg.id, 'World Seed', 'SERVER_SEED', '12345', 'Map generation seed.');
    await upsertEggVariable('rust-world-size', rustEgg.id, 'World Size', 'WORLD_SIZE', '3000', 'Map size — 3000-4000 is typical.');
  }

  const gmodEgg = await fixEgg('00000000-0000-0000-0001-000000000002', "Garry's Mod", GMOD_INSTALL, STEAM_INSTALLER, SOURCE_IMAGE, GMOD_STARTUP);
  if (gmodEgg) {
    await upsertEggVariable('gmod-max-players', gmodEgg.id, 'Max Players', 'MAX_PLAYERS', '16', 'Maximum concurrent players.');
    await upsertEggVariable('gmod-default-map', gmodEgg.id, 'Default Map', 'DEFAULT_MAP', 'gm_construct', 'Map to load on startup.');
    await upsertEggVariable('gmod-steam-acc', gmodEgg.id, 'Game Server Login Token', 'STEAM_ACC', '', 'Optional GSLT from https://steamcommunity.com/dev/managegameservers — needed for public server-list visibility, not required to run.');
  }

  const cs2Egg = await fixEgg('00000000-0000-0000-0001-000000000003', 'Counter-Strike 2', CS2_INSTALL, STEAM_INSTALLER, CS2_IMAGE, CS2_STARTUP);
  if (cs2Egg) {
    await upsertEggVariable('cs2-default-map', cs2Egg.id, 'Default Map', 'DEFAULT_MAP', 'de_dust2', 'Map to load on startup.');
    await upsertEggVariable('cs2-max-players', cs2Egg.id, 'Max Players', 'MAX_PLAYERS', '10', 'Maximum concurrent players.');
    await upsertEggVariable('cs2-steam-acc', cs2Egg.id, 'Game Server Login Token', 'STEAM_ACC', '', 'Optional GSLT from https://steamcommunity.com/dev/managegameservers — needed for public server-list visibility, not required to run.');
  }

  const arkEgg = await fixEgg('00000000-0000-0000-0001-000000000004', 'ARK: Survival Evolved', ARK_INSTALL, STEAM_INSTALLER, ARK_IMAGE);
  if (arkEgg) {
    await upsertEggVariable('ark-map', arkEgg.id, 'Map', 'MAP', 'TheIsland', 'Map to load — TheIsland, TheCenter, Ragnarok, ScorchedEarth_P, Aberration_P, Extinction, and more.');
    await upsertEggVariable('ark-server-password', arkEgg.id, 'Server Password', 'SERVER_PASSWORD', '', 'Optional password players must enter to join.');
    await upsertEggVariable('ark-admin-password', arkEgg.id, 'Admin Password', 'ADMIN_PASSWORD', 'PleaseChangeMe', 'Password for in-game admin commands — change this before going public.');
  }

  const tshockEgg = await fixEgg('00000000-0000-0000-0001-000000000005', 'Terraria (TShock)', TSHOCK_INSTALL, 'ghcr.io/pterodactyl/installers:alpine');
  if (tshockEgg) {
    await upsertEggVariable('tshock-max-players', tshockEgg.id, 'Max Players', 'MAX_PLAYERS', '8', 'Maximum concurrent players.');
    await upsertEggVariable('tshock-world-name', tshockEgg.id, 'World Name', 'WORLD_NAME', 'world', 'Name of the world file (without .wld).');
    await upsertEggVariable('tshock-world-size', tshockEgg.id, 'World Size', 'WORLD_SIZE', '1', '1 = small, 2 = medium, 3 = large. Only used the first time the world is created.');
  }

  console.log('\nDone. Existing servers using these eggs pick up the fix on their next Reinstall (or next install-from-scratch); already-installed servers are untouched.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
