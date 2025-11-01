import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits, Collection } from 'discord.js';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
    console.error('Error: DISCORD_BOT_TOKEN not found in .env file.');
    process.exit(1);
}

const client = new Client({ 
    intents: [ GatewayIntentBits.Guilds ] 
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

// Import the main routefinder command
try {
    const routefinderCommand = await import(path.join(commandsPath, 'routefinder.js'));
    if ('data' in routefinderCommand && 'execute' in routefinderCommand) {
        client.commands.set(routefinderCommand.data.name, routefinderCommand);
    } else {
        console.error('Error loading routefinder command: "data" or "execute" missing.');
    }
} catch (error) {
    console.error('Failed to import routefinder.js:', error);
    process.exit(1);
}

client.once('clientReady', c => {
    console.log(`[INFO] Ready! Logged in as ${c.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    console.log(`[INFO] Received command: /${interaction.commandName} from ${interaction.user.tag}`);

    const command = client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        try {
            if (interaction.replied || interaction.deferred) {
                // Try followUp first, fall back to channel.send if token expired
                try {
                    await interaction.followUp({ content: 'There was an error executing this command!', flags: 64 });
                } catch (followUpError) {
                    // If followUp fails (e.g., token expired), use channel.send
                    if (followUpError.code === 50027) {
                        console.warn('[WARN] Interaction token expired, using channel.send instead');
                        await interaction.channel.send('There was an error executing this command!');
                    } else {
                        throw followUpError;
                    }
                }
            } else {
                // --- (FIX) Using flags: 64 instead of ephemeral: true ---
                await interaction.reply({ content: 'There was an error executing this command!', flags: 64 });
            }
        } catch (err2) {
            console.error('Error while sending error reply:', err2);
        }
    }
});

client.login(token);
