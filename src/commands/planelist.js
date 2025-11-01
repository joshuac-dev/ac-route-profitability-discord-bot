import { loadState, saveState } from '../stateStore.js';

export const subcommands = (builder) => 
    builder.addSubcommand(sub => sub
        .setName('planelist_add')
        .setDescription('Add a plane to your list by name or ID')
        .addStringOption(opt => opt.setName('account').setDescription('The name of the account').setRequired(true))
        .addStringOption(opt => opt.setName('plane').setDescription('The model name or model ID').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('planelist_delete')
        .setDescription('Remove a plane from your list by name or ID')
        .addStringOption(opt => opt.setName('account').setDescription('The name of the account').setRequired(true))
        .addStringOption(opt => opt.setName('plane').setDescription('The model name or model ID to remove').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('planelist_view')
        .setDescription('View all planes currently in your list')
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

    const planeList = state.accounts[accountName].planeList;

    if (subcommand === 'planelist_view') {
        if (!planeList || planeList.length === 0) {
            // --- (FIX) Using flags: 64 instead of ephemeral: true ---
            return interaction.reply({ content: `The planelist for account "${accountName}" is currently empty.`, flags: 64 });
        }
        
        const planeListString = planeList
            .map(p => `• ${p.modelName || 'Unknown Name'} (ID: ${p.modelId || 'Unknown ID'})`)
            .join('\n');
        
        // --- (FIX) Using flags: 64 instead of ephemeral: true ---
        return interaction.reply({ content: `**Planelist for account "${accountName}":**\n${planeListString}`, flags: 64 });
    
    } else if (subcommand === 'planelist_add') {
        const planeIdentifier = interaction.options.getString('plane');
        const isId = !isNaN(planeIdentifier);
        
        let entry;
        let addedMsg = '';
        if (isId) {
            const modelId = parseInt(planeIdentifier, 10);
            entry = { modelId: modelId, modelName: null };
            if (planeList.some(p => p.modelId === entry.modelId)) {
                // --- (FIX) Using flags: 64 instead of ephemeral: true ---
                return interaction.reply({ content: `Plane with ID ${entry.modelId} is already in the list for account "${accountName}".`, flags: 64 });
            }
            state.accounts[accountName].planeList = [...planeList, entry];
            addedMsg = `Added plane with ID: ${entry.modelId}`;
        } else {
            const normalizedName = planeIdentifier.trim().toLowerCase();
            entry = { modelId: null, modelName: normalizedName };
            if (planeList.some(p => p.modelName === entry.modelName)) {
                // --- (FIX) Using flags: 64 instead of ephemeral: true ---
                return interaction.reply({ content: `Plane with name "${normalizedName}" is already in the list for account "${accountName}".`, flags: 64 });
            }
            state.accounts[accountName].planeList = [...planeList, entry];
            addedMsg = `Added plane with name: "${planeIdentifier}" (stored as: ${normalizedName})`;
        }
        
        await saveState(state);
        // --- (FIX) Using flags: 64 instead of ephemeral: true ---
        return interaction.reply({ content: `${addedMsg} for account "${accountName}". The planelist now has ${state.accounts[accountName].planeList.length} entries.`, flags: 64 });

    } else if (subcommand === 'planelist_delete') {
        const planeIdentifier = interaction.options.getString('plane');
        const isId = !isNaN(planeIdentifier);
        const originalLength = planeList.length;

        if (isId) {
            const modelId = parseInt(planeIdentifier, 10);
            state.accounts[accountName].planeList = planeList.filter(p => p.modelId !== modelId);
        } else {
            const normalizedName = planeIdentifier.trim().toLowerCase();
            state.accounts[accountName].planeList = planeList.filter(p => p.modelName !== normalizedName);
        }

        if (state.accounts[accountName].planeList.length === originalLength) {
            // --- (FIX) Using flags: 64 instead of ephemeral: true ---
            return interaction.reply({ content: `Could not find plane "${planeIdentifier}" in the list for account "${accountName}".`, flags: 64 });
        }

        await saveState(state);
        // --- (FIX) Using flags: 64 instead of ephemeral: true ---
        return interaction.reply({ content: `Removed "${planeIdentifier}" from the list for account "${accountName}".`, flags: 64 });
    }
}
