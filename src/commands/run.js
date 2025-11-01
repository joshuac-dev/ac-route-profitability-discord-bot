import { loadState } from '../stateStore.js';
import { runAnalysis } from '../airlineClient.js';
import { EmbedBuilder } from 'discord.js';

export const subcommands = (builder) =>
    builder.addSubcommand(sub => sub
        .setName('run')
        .setDescription('Run the route profitability analysis')
        .addStringOption(opt => opt.setName('account').setDescription('The name of the account to use').setRequired(true)));

export async function execute(interaction) {
    // --- (FIX) Using flags: 64 instead of ephemeral: true ---
    await interaction.reply({ content: 'Starting analysis... This may take a long time. 🚀', flags: 64 });
    
    const accountName = interaction.options.getString('account');
    console.log(`[RUN] Starting analysis for account: ${accountName}`);
    
    const isDebug = process.env.DEBUG_LOGGING === 'true';
    const testLimit = parseInt(process.env.TEST_AIRPORT_LIMIT, 10) || 0;

    if (isDebug) {
        console.log('[RUN] *** DEBUG MODE IS ON ***');
    }
    if (testLimit > 0) {
        console.log(`[RUN] *** TEST LIMIT IS ON: Will only scan ${testLimit} airports. ***`);
    }

    const state = await loadState();

    const account = state.accounts[accountName];
    if (!account) {
        console.error(`[RUN] Error: Account "${accountName}" not found.`);
        // --- (FIX) Using flags: 64 instead of ephemeral: true ---
        return interaction.followUp({ content: `Error: Account "${accountName}" not found in \`bot_state.json\`.`, flags: 64 });
    }
    
    console.log('[RUN] Validating state: Checking for baselist and planelist.');
    if (!account.baseAirports || Object.keys(account.baseAirports).length === 0) {
        console.error('[RUN] Error: Baselist is empty.');
        // --- (FIX) Using flags: 64 instead of ephemeral: true ---
        return interaction.followUp({ content: `Error: The baselist for account "${accountName}" is empty. Add airports with \`/routefinder baselist_add\`.`, flags: 64 });
    }
    
    if (!account.planeList || account.planeList.length === 0) {
        console.error('[RUN] Error: Planelist is empty.');
        // --- (FIX) Using flags: 64 instead of ephemeral: true ---
        return interaction.followUp({ content: `Error: The planelist for account "${accountName}" is empty. Add planes with \`/routefinder planelist_add\`.`, flags: 64 });
    }
    console.log('[RUN] State validated. Starting analysis client.');

    const onProgress = async (message) => {
        console.log(`[RUN] ${message}`);
        try {
            // Use channel.send() to avoid webhook token expiration for long-running operations
            await interaction.channel.send(message);
        } catch (error) {
            console.warn('[WARN] Discord progress update failed (likely editing too fast).');
        }
    };

    try {
        const results = await runAnalysis(
            account.username,
            account.password,
            account.baseAirports,
            account.planeList,
            isDebug,
            testLimit,
            onProgress
        );

        console.log('[RUN] Analysis complete. Posting results to Discord.');
        // Use channel.send() to avoid webhook token expiration for long-running operations
        await interaction.channel.send('✅ Analysis complete! Posting results...');

        for (const [baseIata, routes] of results.entries()) {
            if (routes.length === 0) {
                console.log(`[RUN] No profitable routes found for ${baseIata}.`);
                await interaction.channel.send(`**Top Routes from ${baseIata}**\n\nNo profitable routes found matching your criteria.`);
                continue;
            }

            console.log(`[RUN] Posting top ${routes.length} routes for ${baseIata}.`);
            const formattedResults = routes.map(route => 
                `\`${route.fromIata} (${route.fromCity}) - ${route.toIata} (${route.toCity})\` - **$${route.score.toLocaleString()}**`
            ).join('\n');
            
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`Top ${routes.length} Profitable Routes from ${baseIata}`)
                .setDescription(formattedResults)
                .setTimestamp();
            
            await interaction.channel.send({ embeds: [embed] });
        }

    } catch (error) {
        console.error(`[RUN] Analysis failed: ${error.message}`);
        // Use channel.send() to avoid webhook token expiration for long-running operations
        await interaction.channel.send(`Error during analysis: ${error.message}`);
    }
}
