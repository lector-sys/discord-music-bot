import { GuildPlayer } from './player.js';

/** guildId -> GuildPlayer. One player per guild, created on demand. */
export const players = new Map();

export function getPlayer(interaction) {
  let player = players.get(interaction.guildId);
  if (!player) {
    player = new GuildPlayer(interaction.guild, interaction.channel);
    player.onDestroy = () => players.delete(interaction.guildId);
    players.set(interaction.guildId, player);
  }
  player.text = interaction.channel; // announce where the user is talking now
  return player;
}

/** The player for a guild that is actually playing, or a user-facing error. */
export function activePlayer(interaction) {
  const player = players.get(interaction.guildId);
  if (!player?.current) throw new Error('Nothing is playing right now.');
  return player;
}
