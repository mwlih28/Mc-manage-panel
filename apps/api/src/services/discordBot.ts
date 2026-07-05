import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, Events, ChatInputCommandInteraction,
} from 'discord.js';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { consumeBindCode } from './discordBindCodes';
import { performPowerAction } from './powerActionService';
import { getLiveServerStatus } from './serverStatus';

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('bind')
    .setDescription('Link this channel to a Kretase server using a code generated in the panel')
    .addStringOption((opt) => opt.setName('code').setDescription('Code from the server page in Kretase').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('unbind')
    .setDescription('Unlink this channel from its Kretase server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('status').setDescription("Show this channel's server status"),
  new SlashCommandBuilder().setName('start').setDescription("Start this channel's server"),
  new SlashCommandBuilder().setName('stop').setDescription("Stop this channel's server"),
  new SlashCommandBuilder().setName('restart').setDescription("Restart this channel's server"),
].map((c) => c.toJSON());

let client: Client | null = null;

async function getBoundServer(channelId: string) {
  const binding = await prisma.discordBinding.findUnique({ where: { channelId } });
  if (!binding) return null;
  return prisma.server.findUnique({
    where: { id: binding.serverId },
    include: { node: true, egg: { include: { nest: true } }, allocation: true },
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
  const server = await getBoundServer(interaction.channelId);
  if (!server) return interaction.reply({ content: 'This channel isn’t bound to a server yet — use `/bind <code>`.', ephemeral: true });
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
  const server = await getBoundServer(interaction.channelId);
  if (!server) return interaction.reply({ content: 'This channel isn’t bound to a server yet — use `/bind <code>`.', ephemeral: true });
  await interaction.deferReply();
  const result = await performPowerAction(server, action, { label: 'discord', ip: undefined });
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
    if (!interaction.isChatInputCommand()) return;
    try {
      switch (interaction.commandName) {
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
