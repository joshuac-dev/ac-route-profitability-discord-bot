// ...existing imports and helpers...

/**
 * Main analysis runner.
 */
export async function runAnalysis(
    username,
    password,
    baseAirports,
    userPlaneList,
    isDebug,
    testLimit,
    onProgress,
    options = {} // NEW
) {
    const { minEconomyDemand = 0 } = options;

    const client = createApiClient();
    
    await onProgress('Logging in...');
    const airlineId = await login(client, username, password);
    
    await onProgress('Fetching global airport list...');
    const allAirports = await fetchAirports(client);

    await onProgress('Fetching global airplane model stats...');
    const airplaneModelMap = await fetchAirplaneModels(client);

    const airportIdLookup = new Map();
    for (const airport of allAirports) {
        airportIdLookup.set(airport.id, airport);
    }
    
    // Prepare airports list (apply test limit if needed)
    let availableAirports = allAirports;
    if (testLimit > 0 && testLimit < availableAirports.length) {
        availableAirports = availableAirports.slice(0, testLimit);
        console.log(`[ANALYSIS] Limiting scan to first ${availableAirports.length} airports.`);
    }
    
    const allResults = new Map();
    const baseIatas = Object.keys(baseAirports);
    let baseIndex = 1;

    for (const baseIata of baseIatas) {
        const baseObj = typeof baseAirports[baseIata] === 'object' ? baseAirports[baseIata] : { id: baseAirports[baseIata], excludeAirports: {} };
        const fromAirportId = baseObj.id;
        const fromAirport = airportIdLookup.get(fromAirportId);
        
        if (!fromAirport) {
            console.warn(`[WARN] Skipping base ${baseIata}: Not found in airport list.`);
            await onProgress(`Skipping base ${baseIata}: Not found in airport list.`);
            continue;
        }

        // Filter out airports excluded for this specific base
        const baseExcludeAirports = baseObj.excludeAirports || {};
        const excludedIds = new Set(Object.values(baseExcludeAirports));
        const airportsToScan = availableAirports.filter(airport => !excludedIds.has(airport.id));
        
        if (excludedIds.size > 0) {
            console.log(`[ANALYSIS] Excluding ${excludedIds.size} airports from scan for base ${baseIata}.`);
        }
        
        const totalToScan = airportsToScan.length;

        console.log(`[ANALYSIS] === Starting analysis for base: ${baseIata} (${fromAirport.city}) ===`);
        const baseProgress = `(Base ${baseIndex}/${baseIatas.length})`;
        await onProgress(`Analyzing routes from ${baseIata} ${baseProgress}... (0/${totalToScan})`);
        
        let routeScores = [];
        let processedCount = 0;

        for (const destAirport of airportsToScan) {
            const toAirportId = destAirport.id;

            if (fromAirportId === toAirportId) {
                processedCount++;
                continue;
            }
            
            const routeData = await fetchRouteData(client, airlineId, fromAirportId, toAirportId);

            // NEW: demand filter + progress line (only in debug)
            let skippedForDemand = false;
            if (routeData && minEconomyDemand > 0) {
                const econ = routeData?.directDemand?.economy ?? 0;
                if (econ < minEconomyDemand) {
                    skippedForDemand = true;
                    if (isDebug && typeof onProgress === 'function') {
                        const fromCode = routeData.fromAirportCode
                            || airportIdLookup.get(routeData.fromAirportId)?.iata
                            || fromAirport.iata
                            || String(routeData.fromAirportId || fromAirportId);
                        const toCode = routeData.toAirportCode
                            || airportIdLookup.get(routeData.toAirportId)?.iata
                            || destAirport.iata
                            || String(routeData.toAirportId || toAirportId);
                        await onProgress(`[SKIP][Demand] ${fromCode} -> ${toCode}: direct economy ${econ} < minimum ${minEconomyDemand}`);
                    }
                }
            }
            
            if (routeData && !skippedForDemand) {
                const analysis = analyzeRoute(
                    routeData, 
                    userPlaneList, 
                    airplaneModelMap, 
                    airportIdLookup,
                    baseAirports,
                    isDebug
                );
                
                if (analysis) {
                    analysis.fromIata = fromAirport.iata;
                    analysis.fromCity = fromAirport.city;
                    analysis.toIata = destAirport.iata;
                    analysis.toCity = destAirport.city;
                    routeScores.push(analysis);
                }
            }
            
            processedCount++;
            if (processedCount % 50 === 0) { 
                await onProgress(`Analyzing routes from ${baseIata} ${baseProgress}... (${processedCount}/${totalToScan})`);
            }

            await delay(150);
        }

        routeScores.sort((a, b) => b.score - a.score);
        allResults.set(baseIata, routeScores.slice(0, 10));
        
        console.log(`[ANALYSIS] === Completed base ${baseIata}. Found ${routeScores.length} viable routes. Top 10 saved. ===`);
        baseIndex++;
    }
    
    console.log('[ANALYSIS] All bases complete.');
    return allResults;
}
