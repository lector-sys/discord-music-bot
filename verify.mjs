import { ChannelType, Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { AudioPlayerStatus, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { GuildPlayer, resolve } from './src/player.js';

const URL = process.argv[2] ?? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once('clientReady', async (c) => {
  const done = (code, msg) => {
    console.log(msg);
    c.destroy();
    process.exit(code);
  };

  const guild = c.guilds.cache.first();
  const channel = guild?.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildVoice &&
      ch.permissionsFor(c.user)?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]),
  );
  if (!channel) return done(1, 'No joinable voice channel.');

  const player = new GuildPlayer(guild, null); // null text channel = no chat spam
  console.log(`joining "${channel.name}"...`);
  await player.connect(channel);
  console.log('connection ready:', player.connection.state.status);

  const { tracks } = await resolve(URL);
  console.log('resolved:', tracks[0].title);
  await player.add(tracks);

  await entersState(player.player, AudioPlayerStatus.Playing, 15_000).catch(() => {});
  console.log('player state:', player.player.state.status);

  // Watch playbackDuration climb — proves opus packets are actually being consumed.
  const sample = () => player.player.state.resource?.playbackDuration ?? 0;
  const t0 = sample();
  await new Promise((r) => setTimeout(r, 6000));
  const t1 = sample();
  console.log(`playbackDuration: ${t0}ms -> ${t1}ms (state ${player.player.state.status})`);

  player.destroy();
  if (t1 - t0 > 4000) done(0, 'AUDIO FLOWING — ~6s of real playback.');
  else done(1, 'STALLED — connected but no audio advanced.');
});

client.login(process.env.DISCORD_TOKEN);
setTimeout(() => {
  console.log('timed out');
  process.exit(1);
}, 90000);
