import 'dotenv/config';
import {Client, GatewayIntentBits, Collection, REST, Routes} from 'discord.js';
import {buildCommands, handleInteraction} from './commands/routefinder.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleInteraction(interaction);
  } catch (err) {
    console.error(err);
    const msg = 'Something went sideways. (Turbulence!)';
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: msg });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
});

async function register() {
  const commands = buildCommands().map(c => c.toJSON());
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationCommands((await client.login(process.env.DISCORD_TOKEN), client.user.id)),
    { body: commands }
  );
  console.log('Slash commands registered.');
  process.exit(0);
}

if (process.argv.includes('--register')) {
  await register();
} else {
  client.login(process.env.DISCORD_TOKEN);
}
