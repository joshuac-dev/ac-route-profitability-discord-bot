// ... imports and other functions remain the same ...

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

    // ... existing login, maps, airport enumeration, etc.

    // Inside the per-route loop, after fetching routeData via plan-link:
    //
    // Example structure:
    // for each base -> for each candidate airport:
    //   const routeData = await fetchRouteData(client, airlineId, fromAirportId, toAirportId);
    //   if (!routeData) continue;

    // Add this check immediately after routeData is obtained:
    if (minEconomyDemand > 0) {
        const econDemand = routeData?.directDemand?.economy ?? 0;
        if (econDemand < minEconomyDemand) {
            if (isDebug) {
                await onProgress?.(`[SKIP] ${routeData.fromAirportCode || routeData.fromAirportId} -> ${routeData.toAirportCode || routeData.toAirportId}: direct economy demand ${econDemand} < ${minEconomyDemand}`);
            }
            // Skip this route before plane viability and scoring
            // continue to next candidate in your surrounding loop
        }
    }

    // ... then proceed to analyzeRoute(routeData, ...) as before
}
