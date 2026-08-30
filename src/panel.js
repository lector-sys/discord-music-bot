import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { fmt, progressBar } from './player.js';
import { players } from './queue.js';

export const VOLUME_STEP = 10;

const LOOP = {
  off: { emoji: '➡️', text: 'off' },
  track: { emoji: '🔂', text: 'this track' },
  queue: { emoji: '🔁', text: 'whole queue' },
};

/** Panel edits die once the message is gone or the interaction token ages out. */
const GONE = new Set([
  10008, // Unknown Message
  10062, // Unknown Interaction
  50027, // Invalid Webhook Token — the 15-minute expiry
]);
const isGone = (err) => GONE.has(err?.code);

const button = (id, label, emoji, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);

/** Everything a /symus message needs: current state as an embed plus two button rows. */
export function buildPanel(player, { disabled = false } = {}) {
  const track = player.current;
  const elapsed = (player.player.state.resource?.playbackDuration ?? 0) / 1000;
  const loop = LOOP[player.loop] ?? LOOP.off;
  const level = player.muted ? `🔇 muted (${player.volume}%)` : `🔊 ${player.volume}%`;

  const embed = new EmbedBuilder()
    .setColor(player.paused ? 0x9b9b9b : 0x5865f2)
    .setTitle(track?.title ?? 'Nothing playing')
    .setURL(track?.url ?? null)
    .setDescription(
      `\`${progressBar(elapsed, track?.duration ?? 0)}\`\n` +
        `\`${fmt(elapsed)} / ${fmt(track?.duration ?? 0)}\``,
    )
    .addFields(
      { name: 'Channel', value: track?.channel ?? '—', inline: true },
      { name: 'Up next', value: `${player.queue.length} track(s)`, inline: true },
      { name: 'Volume', value: level, inline: true },
      { name: 'Loop', value: `${loop.emoji} ${loop.text}`, inline: true },
      { name: 'State', value: player.paused ? '⏸️ paused' : '▶️ playing', inline: true },
    );

  const rows = [
    new ActionRowBuilder().addComponents(
      button('symus:prev', 'Previous', '⏮️'),
      player.paused
        ? button('symus:playpause', 'Resume', '▶️', ButtonStyle.Success)
        : button('symus:playpause', 'Pause', '⏸️', ButtonStyle.Primary),
      button('symus:next', 'Next', '⏭️'),
      button('symus:loop', 'Loop', loop.emoji),
      button('symus:stop', 'Stop', '⏹️', ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      button('symus:vol:down', 'Vol −', '🔉'),
      button('symus:vol:up', 'Vol +', '🔊'),
      player.muted
        ? button('symus:mute', 'Unmute', '🔈')
        : button('symus:mute', 'Mute', '🔇', ButtonStyle.Danger),
    ),
  ];
  if (disabled) for (const row of rows) for (const b of row.components) b.setDisabled(true);

  return { embeds: [embed], components: rows };
}

/**
 * Grey out a panel we are replacing, so two panels can never fight over state.
 * A panel older than the token expiry can no longer be edited — nothing to do
 * about that but forget it, since we are about to post a fresh one anyway.
 */
export async function retirePanel(player) {
  const stale = player.panel;
  player.panel = null;
  if (!stale) return;
  try {
    await stale.edit(buildPanel(player, { disabled: true }));
  } catch (err) {
    if (!isGone(err)) throw err;
  }
}

/** Handles every symus:* button. Re-renders the panel so it always shows real state. */
export async function handleButton(interaction) {
  const player = players.get(interaction.guildId);
  if (!player?.current) {
    return interaction
      .update({ content: '⏹️ Nothing is playing any more.', embeds: [], components: [] })
      .catch(() => {});
  }

  // Every action below is the same call the equivalent slash command makes.
  switch (interaction.customId) {
    case 'symus:prev':
      player.previous();
      break;
    case 'symus:playpause':
      player.paused ? player.resume() : player.pause();
      break;
    case 'symus:next':
      player.skip();
      break;
    case 'symus:loop':
      player.cycleLoop();
      break;
    case 'symus:stop':
      player.destroy();
      return interaction
        .update({ content: '⏹️ Stopped, queue cleared, left the channel.', embeds: [], components: [] })
        .catch(() => {});
    case 'symus:vol:down':
      player.setVolume(player.volume - VOLUME_STEP);
      break;
    case 'symus:vol:up':
      player.setVolume(player.volume + VOLUME_STEP);
      break;
    case 'symus:mute':
      player.toggleMute();
      break;
    default:
      return;
  }

  try {
    await interaction.update(buildPanel(player));
    player.panel = interaction.message;
  } catch (err) {
    if (!isGone(err)) throw err;
    player.panel = null;
    await interaction
      .reply({
        content: '⌛ This panel expired. Run `/symus` for a fresh one.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
}
