import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, Events, ChatInputCommandInteraction, AutocompleteInteraction,
  SlashCommandStringOption,
} from 'discord.js';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { consumeBindCode } from './discordBindCodes';
import { performPowerAction } from './powerActionService';
import { getLiveServerStatus } from './serverStatus';

// Servers are addressed two ways, in priority order:
//  1. A `server` option on the command (autocompleted to the caller's own
//     servers, matched to their linked Discord account) — works in any channel
//     or DM, no setup.
//  2. Falling back to a channel that was `/bind`-ed to one server — handy for a
//     shared community/staff channel, but optional.
const SERVER_OPTION = (opt: SlashCommandStringOption) =>
  opt.setName('server').setDescription('Which server (leave empty to use this channel’s bound server)').setAutocomplete(true).setRequired(false);

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('servers')
    .setDescription('List the Kretase servers you can control'),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show a server’s status')
    .addStringOption(SERVER_OPTION),
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Start a server')
    .addStringOption(SERVER_OPTION),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop a server')
    .addStringOption(SERVER_OPTION),
  new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart a server')
    .addStringOption(SERVER_OPTION),
  new SlashCommandBuilder()
    .setName('bind')
    .setDescription('Lock this channel to one Kretase server using a code from the panel (optional)')
    .addStringOption((opt) => opt.setName('code').setDescription('Code from the server page in Kretase').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('unbind')
    .setDescription('Unlink this channel from its Kretase server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

let client: Client | null = null;

const SERVER_INCLUDE = { node: true, egg: { include: { nest: true } }, allocation: true } as const;

// ── Identity: map the Discord user → their Kretase account ───────────────────
async function resolveUser(discordId: string) {
  return prisma.user.findUnique({ where: { discordId } });
}

// Every server the caller may control: admins get all, everyone else gets the
// servers they own plus any they're a sub-user on — the same boundary the panel
// enforces.
async function getControllableServers(user: { id: string; role: string }) {
  if (user.role === 'ADMIN') {
    return prisma.server.findMany({ include: SERVER_INCLUDE, orderBy: { name: 'asc' } });
  }
  return prisma.server.findMany({
    where: { OR: [{ userId: user.id }, { subUsers: { some: { userId: user.id } } }] },
    include: SERVER_INCLUDE,
    orderBy: { name: 'asc' },
  });
}

async function getBoundServer(channelId: string) {
  const binding = await prisma.discordBinding.findUnique({ where: { channelId } });
  if (!binding) return null;
  return prisma.server.findUnique({ where: { id: binding.serverId }, include: SERVER_INCLUDE });
}

type ResolvedTarget =
  | { server: Awaited<ReturnType<typeof getBoundServer>>; error?: undefined }
  | { server?: undefined; error: string };

// Resolve which server a command targets, and authorize it.
async function resolveTarget(interaction: ChatInputCommandInteraction): Promise<ResolvedTarget> {
  const serverId = interaction.options.getString('server');

  if (serverId) {
    const user = await resolveUser(interaction.user.id);
    if (!user) {
      return { error: 'Your Discord account isn’t linked to Kretase yet. Sign in to the panel once with **“Continue with Discord”**, then try again.' };
    }
    // Re-check membership server-side — autocomplete only *suggests* the user's
    // own servers, but a caller could type any id by hand.
    const allowed = await getControllableServers(user);
    const server = allowed.find((s) => s.id === serverId);
    if (!server) return { error: 'That server doesn’t exist or you don’t have access to it.' };
    return { server };
  }

  // No explicit server → fall back to this channel's binding.
  const bound = await getBoundServer(interaction.channelId);
  if (!bound) {
    return { error: 'Pick a server with the `server` option, or `/bind` this channel to one first.' };
  }
  return { server: bound };
}

// ── Autocomplete: offer the caller their own servers ─────────────────────────
async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'server') return interaction.respond([]);

  const user = await resolveUser(interaction.user.id);
  if (!user) return interaction.respond([]);

  const servers = await getControllableServers(user);
  const query = focused.value.toLowerCase();
  const choices = servers
    .filter((s) => !query || s.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map((s) => ({ name: s.name.slice(0, 100), value: s.id }));
  return interaction.respond(choices);
}

// ── Command handlers ─────────────────────────────────────────────────────────
async function handleServers(interaction: ChatInputCommandInteraction) {
  const user = await resolveUser(interaction.user.id);
  if (!user) {
    return interaction.reply({ content: 'Your Discord account isn’t linked to Kretase yet. Sign in to the panel once with **“Continue with Discord”**, then run `/servers` again.', ephemeral: true });
  }
  const servers = await getControllableServers(user);
  if (servers.length === 0) {
    return interaction.reply({ content: 'You don’t have any servers you can control yet.', ephemeral: true });
  }
  const lines = servers.slice(0, 40).map((s) => `• **${s.name}**${s.allocation ? ` — \`${s.allocation.ip}:${s.allocation.port}\`` : ''}`);
  const extra = servers.length > 40 ? `\n…and ${servers.length - 40} more` : '';
  return interaction.reply({
    content: `You can control **${servers.length}** server${servers.length === 1 ? '' : 's'}:\n${lines.join('\n')}${extra}\n\nUse \`/start\`, \`/stop\`, \`/restart\` or \`/status\` and pick one.`,
    ephemeral: true,
  });
}

async function handleBind(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString('code', true);
  const serverId = consumeBindCode(code);
  if (!serverId) {
    return interaction.reply({ content: 'That code is invalid or has expired. Generate a new one from the server page in Kretase.', ephemeral: true });
  }
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) {
    return interaction.reply({ content: 'That server no longer exists.', ephemeral: true });
  }
  await prisma.discordBinding.upsert({
    where: { channelId: interaction.channelId },
    update: { guildId: interaction.guildId || '', serverId },
    create: { guildId: interaction.guildId || '', channelId: interaction.channelId, serverId },
  });
  return interaction.reply(`This channel is now bound to **${server.name}**. Try \`/status\`.`);
}

async function handleUnbind(interaction: ChatInputCommandInteraction) {
  await prisma.discordBinding.deleteMany({ where: { channelId: interaction.channelId } });
  return interaction.reply({ content: 'Unbound. This channel no longer controls a Kretase server.', ephemeral: true });
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  const target = await resolveTarget(interaction);
  if (target.error) return interaction.reply({ content: target.error, ephemeral: true });
  const server = target.server!;
  await interaction.deferReply();
  const status = await getLiveServerStatus(server);
  const lines = [
    `**${server.name}** — ${status.online ? '🟢 Online' : '🔴 Offline'}`,
    status.online ? `Players: ${status.playerCount}${status.maxPlayers ? `/${status.maxPlayers}` : ''}` : null,
    status.address ? `Address: \`${status.address}\`` : null,
  ].filter(Boolean);
  return interaction.editReply(lines.join('\n'));
}

async function handlePower(interaction: ChatInputCommandInteraction, action: 'start' | 'stop' | 'restart') {
  const target = await resolveTarget(interaction);
  if (target.error) return interaction.reply({ content: target.error, ephemeral: true });
  const server = target.server!;
  await interaction.deferReply();
  const user = await resolveUser(interaction.user.id);
  const result = await performPowerAction(server, action, { userId: user?.id, label: 'discord', ip: undefined });
  if (!result.ok) {
    const message = result.code === 'EULA_NOT_ACCEPTED'
      ? 'The Minecraft EULA must be accepted in the panel before this server can be started.'
      : result.message;
    return interaction.editReply(`❌ ${message}`);
  }
  return interaction.editReply(`✅ ${result.message}`);
}

export async function startDiscordBot(): Promise<void> {
  const setting = await prisma.setting.findUnique({ where: { key: 'discord.botToken' } });
  const token = setting?.value;
  if (!token) return; // Not configured — no-op, matches every other optional integration in this codebase.

  if (client) {
    await client.destroy().catch(() => {});
    client = null;
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (c) => {
    logger.info(`Discord bot logged in as ${c.user.tag}`);
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      await rest.put(Routes.applicationCommands(c.user.id), { body: COMMANDS });
      logger.info('Discord slash commands registered');
    } catch (err) {
      logger.warn(`Failed to register Discord slash commands: ${(err as Error).message}`);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      try { await handleAutocomplete(interaction); } catch { await interaction.respond([]).catch(() => {}); }
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    try {
      switch (interaction.commandName) {
        case 'servers': return await handleServers(interaction);
        case 'bind': return await handleBind(interaction);
        case 'unbind': return await handleUnbind(interaction);
        case 'status': return await handleStatus(interaction);
        case 'start': return await handlePower(interaction, 'start');
        case 'stop': return await handlePower(interaction, 'stop');
        case 'restart': return await handlePower(interaction, 'restart');
      }
    } catch (err) {
      logger.error(`Discord command "${interaction.commandName}" failed: ${(err as Error).message}`);
      const payload = { content: 'Something went wrong running that command.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  });

  try {
    await client.login(token);
  } catch (err) {
    logger.warn(`Discord bot failed to log in — check discord.botToken: ${(err as Error).message}`);
    client = null;
  }
}

// Called after the admin saves a new/changed bot token so the running bot
// picks it up without a full panel restart.
export async function restartDiscordBot(): Promise<void> {
  await startDiscordBot();
}
