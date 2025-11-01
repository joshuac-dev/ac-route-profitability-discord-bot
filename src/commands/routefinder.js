import { SlashCommandBuilder } from '@discordjs/builders';
import * as planelist from './planelist.js';
import * as baselist from './baselist.js';
import * as excludelist from './excludelist.js';
import * as run from './run.js';

// Build the nested command structure
const builder = new SlashCommandBuilder()
    .setName('routefinder')
    .setDescription('Commands for Airline Club route finding');

// Attach subcommands from other files
planelist.subcommands(builder);
baselist.subcommands(builder);
excludelist.subcommands(builder);
run.subcommands(builder);

export const data = builder;

// Map subcommand names to their execute functions
const handlers = {
    'planelist_add': planelist.execute,
    'planelist_delete': planelist.execute,
    'planelist_view': planelist.execute,
    'baselist_add': baselist.execute,
    'baselist_delete': baselist.execute,
    'baselist_view': baselist.execute,
    'excludelist_add': excludelist.execute,
    'excludelist_delete': excludelist.execute,
    'excludelist_view': excludelist.execute,
    'run': run.execute,
};

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    console.log(`[INFO] Handling subcommand: ${subcommand}`);
    const handler = handlers[subcommand];
    
    if (handler) {
        await handler(interaction);
    } else {
        await interaction.reply({ content: 'Unknown subcommand.', flags: 64 });
    }
}
