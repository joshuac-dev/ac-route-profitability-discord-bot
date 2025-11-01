import fs from 'fs/promises';
import path from 'path';

const stateFilePath = path.resolve(process.cwd(), 'bot_state.json');

let stateCache = null;

/**
 * Ensures the state file exists.
 */
async function ensureStateFile() {
    try {
        await fs.access(stateFilePath);
    } catch (error) {
        // File doesn't exist, create it with default structure
        await fs.writeFile(stateFilePath, JSON.stringify({
            accounts: {}
        }, null, 2), 'utf8');
    }
}

/**
 * Loads the bot state from bot_state.json.
 * @param {boolean} forceRefresh - If true, bypasses cache and reads from disk.
 * @returns {Promise<object>} The bot state.
 */
export async function loadState(forceRefresh = false) {
    if (stateCache && !forceRefresh) {
        return stateCache;
    }

    await ensureStateFile();
    
    try {
        const data = await fs.readFile(stateFilePath, 'utf8');
        stateCache = JSON.parse(data);
        // Ensure default structure if file is partial
        stateCache.accounts = stateCache.accounts || {};
        
        // Migration: Move global planeList and baseAirports to account-specific if they exist
        // This provides backward compatibility
        if (stateCache.planeList || stateCache.baseAirports) {
            console.log('[STATE] Detected old format with global planeList/baseAirports. Migration may be needed.');
            const hasGlobalPlaneList = stateCache.planeList?.length > 0;
            const hasGlobalBaseAirports = Object.keys(stateCache.baseAirports || {}).length > 0;
            
            if ((hasGlobalPlaneList || hasGlobalBaseAirports) && Object.keys(stateCache.accounts).length > 0) {
                console.log('[STATE] Migrating global lists to first account...');
                const firstAccountName = Object.keys(stateCache.accounts)[0];
                const firstAccount = stateCache.accounts[firstAccountName];
                
                // Only migrate if the account doesn't already have these properties
                if (hasGlobalPlaneList && !firstAccount.planeList?.length) {
                    firstAccount.planeList = stateCache.planeList;
                    console.log(`[STATE] Migrated planeList (${stateCache.planeList.length} items) to account "${firstAccountName}".`);
                }
                
                if (hasGlobalBaseAirports && !Object.keys(firstAccount.baseAirports || {}).length) {
                    firstAccount.baseAirports = stateCache.baseAirports;
                    console.log(`[STATE] Migrated baseAirports (${Object.keys(stateCache.baseAirports).length} items) to account "${firstAccountName}".`);
                }
                
                // Clear the global lists after migration
                delete stateCache.planeList;
                delete stateCache.baseAirports;
                
                console.log('[STATE] Migration complete. State will be saved on next saveState() call.');
            } else {
                // Clean up empty global lists
                delete stateCache.planeList;
                delete stateCache.baseAirports;
            }
        }
        
        // Ensure each account has the required properties
        for (const accountName of Object.keys(stateCache.accounts)) {
            if (!stateCache.accounts[accountName].planeList) {
                stateCache.accounts[accountName].planeList = [];
            }
            if (!stateCache.accounts[accountName].baseAirports) {
                stateCache.accounts[accountName].baseAirports = {};
            }
            
            // Migration: Convert old baseAirports format (IATA -> ID) to new format (IATA -> {id, excludeAirports})
            const baseAirports = stateCache.accounts[accountName].baseAirports;
            for (const iata of Object.keys(baseAirports)) {
                if (typeof baseAirports[iata] !== 'object') {
                    // Old format: just an ID number
                    baseAirports[iata] = {
                        id: baseAirports[iata],
                        excludeAirports: {}
                    };
                } else if (!baseAirports[iata].excludeAirports) {
                    // New format but missing excludeAirports
                    baseAirports[iata].excludeAirports = {};
                }
            }
            
            // Remove old account-level excludeAirports if it exists
            if (stateCache.accounts[accountName].excludeAirports) {
                delete stateCache.accounts[accountName].excludeAirports;
            }
        }
        
        return stateCache;
    } catch (error) {
        console.error('Failed to load state from bot_state.json:', error);
        // Return default structure on parse error
        return { accounts: {} };
    }
}

/**
 * Saves the provided state object to bot_state.json.
 * @param {object} state - The state object to save.
 */
export async function saveState(state) {
    try {
        await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
        stateCache = state; // Update the cache
    } catch (error) {
        console.error('Failed to save state to bot_state.json:', error);
    }
}
