import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { bestThumbnail, fmt, loopEmoji, progressBar } from './player.js';
import { players } from './queue.js';

// Swap ACCENT to YT_DARK if the red reads too aggressively in your server's theme.
const YT_RED = 0xff0000;
const YT_DARK = 0x212121;
const ACCENT = YT_RED;

export const VOLUME_STEP = 10;

/** Panel edits die once the message is deleted or the token ages out. */
const GONE = new Set([
  10008, // Unknown Message — someone deleted the panel by hand
  10062, // Unknown Interaction
  50027, // Invalid Webhook Token — the 15-minute expiry
]);
const isGone = (err) => GONE.has(err?.code);

const icon = (id, emoji, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setEmoji(emoji).setStyle(style);

/**
 * One vertical column, not a field grid: author, hyperlinked title, artist,
 * artwork, playhead, then a footer strip. Embed fields would render as boxes
 * and read like a dashboard rather than a player.
 */
export function buildPanel(player) {
  const track = player.current;
  const elapsed = (player.player.state.resource?.playbackDuration ?? 0) / 1000;
  const total = track?.duration ?? 0;
  const position = player.history.length + 1;
  const ofTotal = position + player.queue.length;
  const volume = player.muted ? '🔇 muted' : `🔊 ${player.volume}%`;
  const loopText = { off: 'Loop off', track: 'Repeat one', queue: 'Repeat queue' };

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setAuthor({ name: player.paused ? '🎵 Paused' : '🎵 Now playing' })
    .setTitle(track?.title ?? 'Nothing playing')
    .setURL(track?.url ?? null)
    .setDescription(
      [
        track?.channel ?? 'Unknown artist',
        '',
        `\`${progressBar(elapsed, total)}\``,
        `\`${fmt(elapsed)} / ${total > 0 ? fmt(total) : 'LIVE'}\``,
      ].join('\n'),
    )
    .setFooter({
      text: [
        `Track ${position} of ${ofTotal}`,
        volume,
        loopText[player.loop] ?? loopText.off,
      ].join(' · '),
    });

  const art = bestThumbnail(track);
  if (art) embed.setImage(art);

  // Ordered like a transport bar, not grouped by function. Everything neutral
  // except Stop, so the strip reads as dark controls rather than a traffic light.
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        icon('symus:prev', '⏮️'),
        icon('symus:playpause', player.paused ? '▶️' : '⏸️'),
        icon('symus:next', '⏭️'),
        icon('symus:loop', loopEmoji(player.loop)),
        icon('symus:stop', '⏹️', ButtonStyle.Danger),
      ),
      new ActionRowBuilder().addComponents(
        icon('symus:vol:down', '🔉'),
        icon('symus:mute', player.muted ? '🔈' : '🔇'),
        icon('symus:vol:up', '🔊'),
      ),
    ],
  };
}

const canPost = (channel, client) => {
  const perms = channel?.permissionsFor?.(client.user);
  return Boolean(
    perms?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]),
  );
};

/**
 * Bring the guild's single panel up to date, creating it the first time playback
 * starts. Serialized per guild: a progress tick, a button press and a track change
 * can all land at once, and two concurrent creates would post two panels.
 */
export function syncPanel(player) {
  player.panelLock = player.panelLock
    .then(() => render(player))
    .catch((err) => console.error('[panel]', err?.message ?? err));
  return player.panelLock;
}

async function render(player) {
  if (player.dead || !player.current) return;
  const payload = buildPanel(player);

  if (player.panel) {
    try {
      await player.panel.edit(payload);
      return;
    } catch (err) {
      if (!isGone(err)) throw err;
      player.panel = null; // deleted out from under us — fall through and repost
    }
  }

  const channel = player.text;
  if (!canPost(channel, player.guild.client)) return;
  player.panel = await channel.send(payload);
}

/** Handles every symus:* button, then re-renders so the panel shows real state. */
export async function handleButton(interaction) {
  const player = players.get(interaction.guildId);
  if (!player?.current) {
    return interaction
      .update({ content: '⏹️ Nothing is playing any more.', embeds: [], components: [] })
      .catch(() => {});
  }

  // Each case is the same call the equivalent slash command makes.
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
      // destroy() deletes the panel, so answer the interaction rather than edit it.
      player.destroy();
      return interaction
        .reply({ content: '⏹️ Stopped, queue cleared, left the channel.' })
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
    player.panel = interaction.message; // keep the one reference pointing at the live message
  } catch (err) {
    if (!isGone(err)) throw err;
    player.panel = null;
    syncPanel(player); // repost, since the old panel is unreachable
  }
}
