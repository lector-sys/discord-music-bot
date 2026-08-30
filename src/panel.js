import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import { bestThumbnail, fmt, loopEmoji, progressBar } from './player.js';
import { players } from './queue.js';

// Swap ACCENT to YT_DARK if the red reads too aggressively in your server's theme.
const YT_RED = 0xff0000;
const YT_DARK = 0x212121;
const ACCENT = YT_RED;

export const VOLUME_STEP = 10;
export const PAGE_SIZE = 25; // Discord's hard cap on select-menu options

/** Panel edits die once the message is deleted or the token ages out. */
const GONE = new Set([
  10008, // Unknown Message — someone deleted the panel by hand
  10062, // Unknown Interaction
  50027, // Invalid Webhook Token — the 15-minute expiry
]);
const isGone = (err) => GONE.has(err?.code);

// Discord rejects labels and descriptions over 100 characters.
const cut = (text, n = 100) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

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
  const rows = [
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
  ];

  // A select menu with zero options is rejected outright, so an empty queue gets no row.
  const pages = queuePages(player);
  if (pages.slice.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('symus:jump')
          .setPlaceholder(
            pages.count > 1
              ? `Up next — ${player.queue.length} tracks (page ${pages.page + 1}/${pages.count})`
              : `Up next — ${player.queue.length} track(s)`,
          )
          .addOptions(
            pages.slice.map((t, i) => ({
              label: cut(t.title ?? 'Unknown title'),
              description: cut([t.channel, fmt(t.duration)].filter(Boolean).join(' · ')) || undefined,
              value: String(pages.start + i),
              emoji: '🎵',
            })),
          ),
      ),
    );
    if (pages.count > 1) {
      rows.push(
        new ActionRowBuilder().addComponents(
          icon('symus:page:prev', '◀️').setDisabled(pages.page === 0),
          icon('symus:page:next', '▶️').setDisabled(pages.page >= pages.count - 1),
        ),
      );
    }
  }

  return { embeds: [embed], components: rows };
}

/** Which 25-track window of the queue the dropdown is showing. */
export function queuePages(player) {
  const count = Math.max(1, Math.ceil(player.queue.length / PAGE_SIZE));
  const page = Math.min(Math.max(player.panelPage ?? 0, 0), count - 1);
  const start = page * PAGE_SIZE;
  return { page, count, start, slice: player.queue.slice(start, start + PAGE_SIZE) };
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

/** Handles every symus:* component, then re-renders so the panel shows real state. */
export async function handleComponent(interaction) {
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
    // Jumping consumes everything in between, the way clicking down a
    // YouTube Music queue does — the passed tracks land in history.
    case 'symus:jump':
      player.jumpTo(Number(interaction.values?.[0]));
      break;
    case 'symus:page:prev':
      player.panelPage = Math.max(0, (player.panelPage ?? 0) - 1);
      break;
    case 'symus:page:next':
      player.panelPage = Math.min(queuePages(player).count - 1, (player.panelPage ?? 0) + 1);
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
