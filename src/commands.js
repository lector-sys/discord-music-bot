import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildPanel, retirePanel } from './panel.js';
import { fmt, resolve } from './player.js';
import { activePlayer, getPlayer } from './queue.js';

const ephemeral = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral });

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Queue a YouTube video, playlist, or search')
      .addStringOption((o) =>
        o
          .setName('query')
          .setDescription('YouTube URL, playlist link, or search terms')
          .setRequired(true),
      ),
    async execute(interaction) {
      const channel = interaction.member.voice.channel;
      if (!channel) return ephemeral(interaction, '❌ Join a voice channel first.');

      const perms = channel.permissionsFor(interaction.client.user);
      if (!perms?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
        return ephemeral(interaction, `❌ I need **Connect** and **Speak** in **${channel.name}**.`);
      }

      await interaction.deferReply();
      const { name, tracks, searched } = await resolve(interaction.options.getString('query'));

      const player = getPlayer(interaction);
      await player.connect(channel);
      const wasIdle = !player.current;
      await player.add(tracks);

      // A search picked this track, not the user — show enough to spot a wrong grab and /skip.
      const [track] = tracks;
      const detail = searched
        ? ` — ${[track.channel, fmt(track.duration)].filter(Boolean).join(' · ')}`
        : '';

      await interaction.editReply(
        name
          ? `📃 Queued **${tracks.length}** track(s) from **${name}**.`
          : wasIdle
            ? `✅ Queued **${track.title}**${detail}.`
            : `➕ Added **${track.title}**${detail} to the queue (position ${player.queue.length}).`,
      );
    },
  },

  {
    // Lowercase because Discord rejects mixed-case command names; the bot's
    // display name SYmuS is unaffected.
    data: new SlashCommandBuilder()
      .setName('symus')
      .setDescription('Open the SYmuS playback controls.'),
    async execute(interaction) {
      const player = activePlayer(interaction); // throws if nothing is playing
      await retirePanel(player); // grey out the last panel so two cannot fight
      await interaction.reply(buildPanel(player)); // public: anyone in voice can drive it
      player.panel = await interaction.fetchReply();
    },
  },

  {
    data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track'),
    async execute(interaction) {
      const player = activePlayer(interaction);
      const title = player.current.title;
      player.skip();
      await interaction.reply(`⏭️ Skipped **${title}**.`);
    },
  },

  {
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
    async execute(interaction) {
      const ok = activePlayer(interaction).pause();
      await interaction.reply(ok ? '⏸️ Paused.' : '❌ Could not pause.');
    },
  },

  {
    data: new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
    async execute(interaction) {
      const ok = activePlayer(interaction).resume();
      await interaction.reply(ok ? '▶️ Resumed.' : '❌ Nothing is paused.');
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Clear the queue and leave the voice channel'),
    async execute(interaction) {
      activePlayer(interaction).destroy();
      await interaction.reply('⏹️ Stopped, queue cleared, left the channel.');
    },
  },

  {
    data: new SlashCommandBuilder().setName('queue').setDescription('Show the queue'),
    async execute(interaction) {
      const player = activePlayer(interaction);
      const shown = player.queue
        .slice(0, 10)
        .map((t, i) => `\`${i + 1}.\` ${t.title} \`${fmt(t.duration)}\``);
      const rest = player.queue.length - shown.length;
      await interaction.reply(
        [
          `**Now playing:** ${player.current.title}`,
          shown.length ? shown.join('\n') : '_Queue is empty._',
          rest > 0 ? `_…and ${rest} more._` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    },
  },

  {
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current track'),
    async execute(interaction) {
      const player = activePlayer(interaction);
      const played = (player.player.state.resource?.playbackDuration ?? 0) / 1000;
      await interaction.reply(
        `🎵 **${player.current.title}** \`${fmt(played)} / ${fmt(player.current.duration)}\`\n${player.current.url}`,
      );
    },
  },
];
