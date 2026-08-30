import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './src/commands.js';
import { handleComponent } from './src/panel.js';
import { players } from './src/queue.js';

// Every diagnostic in this bot is a sequence question — which guild, how long apart.
for (const level of ['log', 'error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => original(new Date().toISOString().slice(11, 23), ...args);
}

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, async (c) => {
  await c.application.commands.set(commands.map((cmd) => cmd.data));
  const id = process.env.CLIENT_ID ?? c.user.id;
  console.log(`Ready as ${c.user.tag}`);
  console.log(
    `Invite: https://discord.com/api/oauth2/authorize?client_id=${id}&permissions=3165184&scope=bot%20applications.commands`,
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Panel buttons are routed here rather than through a component collector,
  // which would die on restart and leave every posted panel inert.
  const isPanelButton =
    (interaction.isButton() || interaction.isStringSelectMenu()) &&
    interaction.customId.startsWith('symus:');
  if (!isPanelButton && !interaction.isChatInputCommand()) return;

  const command = isPanelButton
    ? null
    : commands.find((c) => c.data.name === interaction.commandName);
  if (!isPanelButton && !command) return;

  try {
    await (isPanelButton ? handleComponent(interaction) : command.execute(interaction));
  } catch (err) {
    console.error(err);
    const body = {
      content: `❌ ${err?.message ?? 'Something went wrong.'}`,
      flags: MessageFlags.Ephemeral,
    };
    const send = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
    await interaction[send](body).catch(() => {});
  }
});

// Leave when the channel empties out (and cancel the timer when someone comes back).
client.on(Events.VoiceStateUpdate, (_old, next) => {
  players.get(next.guild.id)?.checkListeners();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const player of players.values()) player.destroy();
    client.destroy();
    process.exit(0);
  });
}

client.login(process.env.DISCORD_TOKEN);
