import { loadState, saveState } from '../stateStore.js';
import { getAirportByIata } from '../airlineClient.js';

export const subcommands = (builder) =>
    builder.addSubcommand(sub => sub
        .setName('excludelist_add')
        .setDescription('Add an airport to exclude from route scans for a specific base')
        .addStringOption(opt => opt.setName('account').setDescription('The name of the account').setRequired(true))
        .addStringOption(opt => opt.setName('base').setDescription('The base airport IATA code (e.g., IST)').setRequired(true))
        .addStringOption(opt => opt.setName('iata').setDescription('The airport IATA code to exclude (e.g., DIY)').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('excludelist_delete')
        .setDescription('Remove an airport from the exclude list for a specific base')
        .addStringOption(opt => opt.setName('account').setDescription('The name of the account').setRequired(true))
        .addStringOption(opt => opt.setName('base').setDescription('The base airport IATA code (e.g., IST)').setRequired(true))
        .addStringOption(opt => opt.setName('iata').setDescription('The airport IATA code to remove (e.g., DIY)').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('excludelist_view')
        .setDescription('View all excluded airports for a specific base')
        .addStringOption(opt => opt.setName('account').setDescription('The name of the account').setRequired(true))
        .addStringOption(opt => opt.setName('base').setDescription('The base airport IATA code (e.g., IST)').setRequired(true)));

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const accountName = interaction.options.getString('account');
    const baseIata = interaction.options.getString('base')?.toUpperCase();
    const state = await loadState();

    // Validate account exists
    if (!state.accounts[accountName]) {
        return interaction.reply({ 
            content: `Error: Account "${accountName}" not found in \`bot_state.json\`.`, 
            flags: 64 
        });
    }

    const baseAirports = state.accounts[accountName].baseAirports;
    
    // Validate base exists
    if (!baseAirports[baseIata]) {
        return interaction.reply({ 
            content: `Error: Base "${baseIata}" not found in baselist for account "${accountName}". Add it first with \`/routefinder baselist_add\`.`, 
            flags: 64 
        });
    }

    // Get the base object (handle both old format with just ID and new format with object)
    const baseObj = typeof baseAirports[baseIata] === 'object' ? baseAirports[baseIata] : { id: baseAirports[baseIata], excludeAirports: {} };
    if (!baseObj.excludeAirports) {
        baseObj.excludeAirports = {};
    }
    
    // Update the base object in state if it was in old format
    if (typeof baseAirports[baseIata] !== 'object') {
        baseAirports[baseIata] = baseObj;
    }

    const excludeAirports = baseObj.excludeAirports;

    if (subcommand === 'excludelist_view') {
        const iatas = Object.keys(excludeAirports);
        if (iatas.length === 0) {
            return interaction.reply({ content: `The exclude list for base "${baseIata}" in account "${accountName}" is currently empty.`, flags: 64 });
        }
        
        const excludeListString = iatas.map(iata => `• ${iata} (ID: ${excludeAirports[iata]})`).join('\n');
        
        return interaction.reply({ content: `**Exclude list for base "${baseIata}" in account "${accountName}":**\n${excludeListString}`, flags: 64 });
    
    } else if (subcommand === 'excludelist_add') {
        await interaction.deferReply({ flags: 64 });
        const iata = interaction.options.getString('iata').toUpperCase();
        
        if (excludeAirports[iata]) {
            return interaction.editReply(`Airport ${iata} is already in the exclude list for base "${baseIata}" in account "${accountName}".`);
        }

        try {
            const airport = await getAirportByIata(iata);
            if (!airport) {
                return interaction.editReply(`Could not find an airport with IATA code ${iata}.`);
            }
            
            baseObj.excludeAirports[iata] = airport.id;
            await saveState(state);
            
            return interaction.editReply(`Added ${iata} (${airport.name}, ${airport.city}) to the exclude list for base "${baseIata}" in account "${accountName}".`);

        } catch (error) {
            console.error('Error in excludelist add:', error);
            return interaction.editReply('An error occurred while trying to find that airport.');
        }

    } else if (subcommand === 'excludelist_delete') {
        const iata = interaction.options.getString('iata').toUpperCase();

        if (!excludeAirports[iata]) {
            return interaction.reply({ content: `Airport ${iata} is not in the exclude list for base "${baseIata}" in account "${accountName}".`, flags: 64 });
        }
        
        delete baseObj.excludeAirports[iata];
        await saveState(state);
        
        return interaction.reply({ content: `Removed ${iata} from the exclude list for base "${baseIata}" in account "${accountName}".`, flags: 64 });
    }
}
