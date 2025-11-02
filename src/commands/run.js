import { loadState } from '../stateStore.js';
import { runAnalysis } from '../airlineClient.js';
import { EmbedBuilder } from 'discord.js';

export const subcommands = (builder) =>
    builder.addSubcommand(sub => sub
        .setName('run')
        .setDescription('Run the route profitability analysis')
        .addStringOption(opt =>
            opt.setName('account')
               .setDescription('The name of the account to use')
               .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('min_economy')
               .setDescription('Minimum direct economy demand required for a route to be considered')
               .setMinValue(0)
               .setRequired(false)
        )
    );

export async function execute(interaction) {
    await interaction.deferReply({ flags: 64 }); // keep existing behavior

    const accountName = interaction.options.getString('account');
    const minEconomyDemand = interaction.options.getInteger('min_economy') ?? 0;

    const state = await loadState();
    if (!state.accounts[accountName]) {
        return interaction.followUp({ content: `Error: Account "${accountName}" not found in \`bot_state.json\`.`, flags: 64 });
    }

    const account = state.accounts[accountName];

    if (!account.baseAirports || Object.keys(account.baseAirports).length === 0) {
        return interaction.followUp({ content: `Error: The baselist for account "${accountName}" is empty. Add airports with \`/routefinder baselist_add\`.`, flags: 64 });
    }

    if (!account.planeList || account.planeList.length === 0) {
        return interaction.followUp({ content: `Error: The planelist for account "${accountName}" is empty. Add planes with \`/routefinder planelist_add\`.`, flags: 64 });
    }

    const isDebug = String(process.env.DEBUG_LOGGING).toLowerCase() === 'true';
    const testLimit = Number(process.env.TEST_AIRPORT_LIMIT) || 0;

    const onProgress = async (message) => {
        try {
            await interaction.channel.send(message);
        } catch {
            // non-fatal
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
            onProgress,
            { minEconomyDemand } // NEW: pass options object
        );

        await interaction.channel.send('✅ Analysis complete! Posting results...');
        for (const [baseIata, routes] of results.entries()) {
            if (routes.length === 0) {
                await interaction.channel.send(`**Top Routes from ${baseIata}**\n\nNo profitable routes found matching your criteria.`);
                continue;
            }

            const formattedResults = routes.map(route =>
                `\`${route.fromIata} (${route.fromCity}) - ${route.toIata} (${route.toCity})\` - **$${route.score.toLocaleString()}** - **${route.planeName}**`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`Top ${routes.length} Profitable Routes from ${baseIata}`)
                .setDescription(formattedResults)
                .setTimestamp();

            await interaction.channel.send({ embeds: [embed] });
        }

        return interaction.followUp({ content: 'Done.', flags: 64 });
    } catch (error) {
        console.error(error);
        return interaction.followUp({ content: 'There was an error running the analysis.', flags: 64 });
    }
}
