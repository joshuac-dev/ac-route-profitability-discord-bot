import { loadState, saveState } from '../stateStore.js';
import { getAirportByIata } from '../airlineClient.js';

export const subcommands = (builder) =>
    builder.addSubcommand(sub => sub
        .setName('baselist_add')
        .setDescription('Add a base airport by its IATA code')
        .addStringOption(opt => opt.setName('account').setDescription('The name of the account').setRequired(true))
        .addStringOption(opt => opt.setName('iata').setDescription('The 3-letter IATA code (e.g., IST)').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('baselist_delete')
        .setDescription('Remove a base airport by its IATA code')
        .addStringOption(opt => opt.setName('account').setDescription('The name of the account').setRequired(true))
        .addStringOption(opt => opt.setName('iata').setDescription('The 3-letter IATA code (e.g., IST)').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('baselist_view')
        .setDescription('View all airports currently in your baselist')
        .addStringOption(opt => opt.setName('account').setDescription('The name of the account').setRequired(true)));

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const accountName = interaction.options.getString('account');
    const state = await loadState();

    // Validate account exists
    if (!state.accounts[accountName]) {
        return interaction.reply({ 
            content: `Error: Account "${accountName}" not found in \`bot_state.json\`.`, 
            flags: 64 
        });
    }

    const baseAirports = state.accounts[accountName].baseAirports;

    if (subcommand === 'baselist_view') {
        const iatas = Object.keys(baseAirports);
        if (iatas.length === 0) {
            // --- (FIX) Using flags: 64 instead of ephemeral: true ---
            return interaction.reply({ content: `The baselist for account "${accountName}" is currently empty.`, flags: 64 });
        }
        
        const baseListString = iatas.map(iata => {
            const base = baseAirports[iata];
            const baseId = typeof base === 'object' ? base.id : base;
            return `• ${iata} (ID: ${baseId})`;
        }).join('\n');
        
        // --- (FIX) Using flags: 64 instead of ephemeral: true ---
        return interaction.reply({ content: `**Baselist for account "${accountName}":**\n${baseListString}`, flags: 64 });
    
    } else if (subcommand === 'baselist_add') {
        // --- (FIX) Using flags: 64 instead of ephemeral: true ---
        await interaction.deferReply({ flags: 64 });
        const iata = interaction.options.getString('iata').toUpperCase();
        
        if (baseAirports[iata]) {
            return interaction.editReply(`Airport ${iata} is already in the baselist for account "${accountName}".`);
        }

        try {
            const airport = await getAirportByIata(iata);
            if (!airport) {
                return interaction.editReply(`Could not find an airport with IATA code ${iata}.`);
            }
            
            state.accounts[accountName].baseAirports = {
                ...baseAirports,
                [iata]: {
                    id: airport.id,
                    excludeAirports: {}
                }
            };
            await saveState(state);
            
            return interaction.editReply(`Added ${iata} (${airport.name}, ${airport.city}) to the baselist for account "${accountName}".`);

        } catch (error) {
            console.error('Error in baselist add:', error);
            return interaction.editReply('An error occurred while trying to find that airport.');
        }

    } else if (subcommand === 'baselist_delete') {
        const iata = interaction.options.getString('iata').toUpperCase();

        if (!baseAirports[iata]) {
            // --- (FIX) Using flags: 64 instead of ephemeral: true ---
            return interaction.reply({ content: `Airport ${iata} is not in the baselist for account "${accountName}".`, flags: 64 });
        }
        
        const { [iata]: _, ...remainingAirports } = baseAirports;
        state.accounts[accountName].baseAirports = remainingAirports;
        await saveState(state);
        
        // --- (FIX) Using flags: 64 instead of ephemeral: true ---
        return interaction.reply({ content: `Removed ${iata} from the baselist for account "${accountName}".`, flags: 64 });
    }
}
