import axios from 'axios';
import { wrapper as axiosCookieJarSupport } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

const BASE_URL = 'https://www.airline-club.com';

// --- Cost Calculation Constants from AIRPLANE_COST_CALCULATIONS.md ---
const FUEL_UNIT_COST = 0.0043;
const MAX_ASCEND_DISTANCE_1 = 180;
const MAX_ASCEND_DISTANCE_2 = 250;
const MAX_ASCEND_DISTANCE_3 = 1000;
const ASCEND_FUEL_BURN_MULTIPLIER_1 = 32;
const ASCEND_FUEL_BURN_MULTIPLIER_2 = 13;
const ASCEND_FUEL_BURN_MULTIPLIER_3 = 2;

const CREW_UNIT_COST = 12;
const BASE_INFLIGHT_COST = 20;

// Constants for our simulation
const DEFAULT_LOAD_FACTOR = 1.0; // Per spec, "Assume 100% economy seats sold"
const DEFAULT_QUALITY = 20; // (FIX) Changed from 60 to 20 to match game's service cost

// From "Airport Fees (AFPF)" section
const airplaneTypeMultiplierMap = {
    "LIGHT": 1,
    "SMALL": 1,
    "REGIONAL": 3,
    "MEDIUM": 8,
    "LARGE": 12,
    "X_LARGE": 15,
    "JUMBO": 18,
    "SUPERSONIC": 12,
};

// From "Service Supplies Cost (SSPF)" section
const durationCostPerHourByStar = [0, 1, 4, 8, 13, 20]; // 0-star to 5-star
// --- End Constants ---

/**
 * Creates a new, sandboxed API client instance with its own cookie jar.
 */
function createApiClient() {
    const jar = new CookieJar();
    const client = axios.create({ jar });
    axiosCookieJarSupport(client);
    client.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
    return client;
}

/**
 * Logs into Airline Club.
 */
export async function login(client, username, password) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    console.log(`[API] Attempting login for ${username}...`);
    try {
        const response = await client.post(`${BASE_URL}/login`, {}, {
            headers: { 'Authorization': `Basic ${credentials}` }
        });
        if (response.data && response.data.airlineIds && response.data.airlineIds.length > 0) {
            console.log(`[API] Login successful. Got airlineId: ${response.data.airlineIds[0]}`);
            return response.data.airlineIds[0];
        } else {
            throw new Error('Login failed: No airlineIds found in response.');
        }
    } catch (error) {
        console.error('[API] Login request failed:', error.message);
        throw new Error('Login failed. Please check credentials and server status.');
    }
}

/**
 * Fetches the global list of all airports.
 */
export async function fetchAirports(client) {
    console.log('[API] Fetching global airport list...');
    try {
        const response = await client.get(`${BASE_URL}/airports`);
        console.log(`[API] Fetched ${response.data.length} airports.`);
        return response.data;
    } catch (error) {
        console.error('[API] Failed to fetch airports:', error.message);
        throw new Error('Could not fetch airport list.');
    }
}

/**
 * Fetches the master list of all airplane models and their base stats.
 */
export async function fetchAirplaneModels(client) {
    console.log('[API] Fetching global airplane model list...');
    try {
        const response = await client.get(`${BASE_URL}/airplane-models`);
        console.log(`[API] Fetched ${response.data.length} airplane models.`);
        const modelMap = new Map();
        for (const model of response.data) {
            modelMap.set(model.id, model);
        }
        return modelMap;
    } catch (error) {
        console.error('[API] Failed to fetch airplane models:', error.message);
        throw new Error('Could not fetch airplane model list.');
    }
}

/**
 * Fetches route planning data between two airports.
 */
export async function fetchRouteData(client, airlineId, fromAirportId, toAirportId) {
    const params = new URLSearchParams();
    params.append('airlineId', airlineId);
    params.append('fromAirportId', fromAirportId);
    params.append('toAirportId', toAirportId);

    try {
        const response = await client.post(
            `${BASE_URL}/airlines/${airlineId}/plan-link`,
            params,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } }
        );
        return response.data;
    } catch (error) {
        console.error(`[API] Failed to fetch route data (${fromAirportId} -> ${toAirportId}):`, error.message);
        return null;
    }
}

// --- REBUILT COST CALCULATION FUNCTIONS ---

/**
 * 1. Calculates Fuel Cost per week
 */
function calculateFuelCost(distance, fuelBurn, frequency, loadFactor) {
    let ascend1 = 0, ascend2 = 0, ascend3 = 0, cruise = 0;

    if (distance <= 360) {
        ascend1 = (distance / 2) * fuelBurn * ASCEND_FUEL_BURN_MULTIPLIER_1;
        cruise = (distance / 2) * fuelBurn; // descent is 1x fuelBurn
    } else if (distance <= 500) {
        ascend1 = 180 * fuelBurn * ASCEND_FUEL_BURN_MULTIPLIER_1;
        ascend2 = (distance / 2 - 180) * fuelBurn * ASCEND_FUEL_BURN_MULTIPLIER_2;
        cruise = (distance / 2) * fuelBurn; // descent
    } else if (distance <= 2000) {
        ascend1 = 180 * fuelBurn * ASCEND_FUEL_BURN_MULTIPLIER_1;
        ascend2 = 250 * fuelBurn * ASCEND_FUEL_BURN_MULTIPLIER_2;
        ascend3 = (distance / 2 - 180 - 250) * fuelBurn * ASCEND_FUEL_BURN_MULTIPLIER_3;
        cruise = (distance / 2) * fuelBurn; // descent
    } else { // distance > 2000
        ascend1 = 180 * fuelBurn * ASCEND_FUEL_BURN_MULTIPLIER_1;
        ascend2 = 250 * fuelBurn * ASCEND_FUEL_BURN_MULTIPLIER_2;
        ascend3 = 1000 * fuelBurn * ASCEND_FUEL_BURN_MULTIPLIER_3;
        cruise = (distance - 180 - 250 - 1000) * fuelBurn; // cruise + descent
    }

    const fuelUnitsPerFlight = ascend1 + ascend2 + ascend3 + cruise;
    const loadFactorMultiplier = 0.7 + 0.3 * loadFactor;
    
    // --- (FIX 1) ---
    // Removed * 2 multiplier. The formula seems to be for total weekly fuel burn,
    // not one-way.
    return fuelUnitsPerFlight * FUEL_UNIT_COST * frequency * loadFactorMultiplier;
}

/**
 * 2. Calculates Crew Cost per week
 */
function calculateCrewCost(capacity, durationMinutes, frequency) {
    // 1.0 (economy) * capacity * (duration / 60) * 12
    const costPerFlight = 1.0 * capacity * (durationMinutes / 60) * CREW_UNIT_COST;
    
    // --- (FIX 2) ---
    // Removed * 2 multiplier. This formula seems to be for total weekly crew cost.
    return costPerFlight * frequency;
}

/**
 * 3. Calculates Airport Fees per week
 */
function calculateAirportFees(capacity, airplaneType, fromAirport, toAirport, baseAirports, frequency) {
    const baseSlotFees = [0, 50, 50, 80, 150, 250, 350, 500]; // 0-indexed for size
    const typeMultiplier = airplaneTypeMultiplierMap[airplaneType] || 1;

    const getSlotFee = (airport) => {
        const baseFee = baseSlotFees[Math.min(airport.size, 7)];
        // TODO: This doesn't account for 50% HQ discount, only 20% base
        const discount = baseAirports[airport.iata] ? 0.8 : 1.0; 
        return baseFee * typeMultiplier * discount;
    };
    
    const getLandingFee = (airport) => {
        const perSeatFee = airport.size <= 3 ? 3 : airport.size;
        return capacity * perSeatFee;
    };

    const fromSlotFee = getSlotFee(fromAirport);
    const toSlotFee = getSlotFee(toAirport);
    const fromLandingFee = getLandingFee(fromAirport);
    const toLandingFee = getLandingFee(toAirport);
    
    const feePerRoundTrip = fromSlotFee + toSlotFee + fromLandingFee + toLandingFee;
    return feePerRoundTrip * frequency;
}

/**
 * 4. Calculates Depreciation per week
 */
function calculateDepreciation(price, lifespan) {
    // TODO: This is still slightly off from game numbers.
    // The game is likely using a discounted price that we don't have access to.
    // Using the base price is the best we can do for now.
    return price / lifespan;
}

/**
 * 5. Calculates Maintenance per week
 */
function calculateMaintenance(capacity) {
    // --- (FIX 3) ---
    // Your game screenshots prove the multiplier is 100, not 150.
    return capacity * 100;
}

/**
 * 6. Calculates Service Supplies per week
 */
function calculateServiceSupplies(durationMinutes, soldSeats, frequency) {
    // --- (FIX 4) ---
    // Changed DEFAULT_QUALITY to 20, which makes star = 1
    const star = Math.floor(DEFAULT_QUALITY / 20);
    const durationCost = durationCostPerHourByStar[Math.min(star, 5)]; // = 1
    
    const costPerPassenger = BASE_INFLIGHT_COST + (durationCost * durationMinutes / 60);
    const roundtripCostPerPassenger = costPerPassenger * 2;
    const totalPaxPerWeek = soldSeats * frequency;
    
    return roundtripCostPerPassenger * totalPaxPerWeek;
}

/**
 * Calculates the economy ticket price based on competitor rules.
 */
function getTicketPrice(routeData) {
    const competitors = routeData.otherLinks;
    if (competitors && competitors.length > 0) {
        const competitorPrices = competitors.map(comp => comp.price.economy);
        return Math.min(...competitorPrices);
    } else {
        return routeData.suggestedPrice.economy;
    }
}

/**
 * Analyzes a single route and returns the best profit-per-frequency.
 */
export function analyzeRoute(routeData, userPlaneList, airplaneModelMap, airportMap, baseAirports, isDebug) {
    if (isDebug) {
        console.log(`\n[DEBUG] Analyzing route: ${routeData.fromAirportCode} -> ${routeData.toAirportCode} (Dist: ${routeData.distance}km)`);
    }

    const userPlaneIds = new Set(userPlaneList.filter(p => p.modelId).map(p => p.modelId));
    const userPlaneNames = new Set(userPlaneList.filter(p => p.modelName).map(p => p.modelName.trim().toLowerCase())); 

    if (isDebug) {
         console.log(`  [DEBUG] Matching against ${userPlaneIds.size} IDs: [${[...userPlaneIds].join(', ')}]`);
         console.log(`  [DEBUG] Matching against ${userPlaneNames.size} names: ["${[...userPlaneNames].join('", "')}"]`);
    }

    const viablePlanes = routeData.modelPlanLinkInfo.filter(model => {
        const apiModelName = model.modelName ? model.modelName.trim().toLowerCase() : null;
        const idMatch = userPlaneIds.has(model.modelId);

        let nameMatch = false;
        if (apiModelName) {
            for (const storedName of userPlaneNames) {
                if (apiModelName.includes(storedName)) {
                    nameMatch = true;
                    break;
                }
            }
        }
        
        if (isDebug) {
            console.log(`    [DEBUG] Checking API plane: "${model.modelName}" (ID: ${model.modelId})`);
            console.log(`      -> ID Match (${model.modelId}): ${idMatch}`);
            console.log(`      -> Name Match (API: "${apiModelName}" includes any from your list?): ${nameMatch}`);
        }
        return idMatch || nameMatch;
    });

    if (viablePlanes.length === 0) {
        if (isDebug) console.log(`  [DEBUG] Skipping: No planes from your planelist can fly this route.`);
        return null; 
    }

    if (isDebug) console.log(`  [DEBUG] Found ${viablePlanes.length} viable planes: ${viablePlanes.map(p => p.modelName).join(', ')}`);

    let bestPlaneForRoute = null;
    let maxScore = -Infinity;
    const ticketPrice = getTicketPrice(routeData);
    
    if (isDebug) console.log(`  [DEBUG] Using Ticket Price: $${ticketPrice}`);

    const fromAirport = airportMap.get(routeData.fromAirportId);
    const toAirport = airportMap.get(routeData.toAirportId);

    if (!fromAirport || !toAirport) {
        if (isDebug) console.log(`  [DEBUG] Skipping: Could not find airport data for ${routeData.fromAirportCode} or ${routeData.toAirportCode}.`);
        return null;
    }

    for (const plane of viablePlanes) {
        const planeBaseStats = airplaneModelMap.get(plane.modelId);
        if (!planeBaseStats) {
            if (isDebug) console.log(`  [DEBUG] Skipping plane ${plane.modelName}: No base stats found in airplane-models map.`);
            continue;
        }

        const F = plane.maxFrequency;
        const C = plane.capacity;
        const durationMinutes = plane.duration; 

        if (F === 0) {
            if (isDebug) console.log(`  [DEBUG] Skipping plane ${plane.modelName}: Frequency is 0.`);
            continue;
        }

        const soldSeats = C; 
        
        const fuelCost = calculateFuelCost(routeData.distance, planeBaseStats.fuelBurn, F, DEFAULT_LOAD_FACTOR);
        const crewCost = calculateCrewCost(C, durationMinutes, F);
        const airportFees = calculateAirportFees(C, planeBaseStats.airplaneType, fromAirport, toAirport, baseAirports, F);
        const depreciation = calculateDepreciation(planeBaseStats.price, planeBaseStats.lifespan);
        const maintenance = calculateMaintenance(C);
        const serviceSupplies = calculateServiceSupplies(durationMinutes, soldSeats, F);

        const totalWeeklyCost = fuelCost + crewCost + airportFees + depreciation + maintenance + serviceSupplies;
        
        // Per spec: REVENUE = ticketPrice * F * C
        const REVENUE = ticketPrice * F * C;
        const PROFIT = REVENUE - totalWeeklyCost;
        const SCORE = Math.round(PROFIT / F);

        if (isDebug) {
            console.log(`    [CALC] Plane: ${plane.modelName} (Freq: ${F}, Cap: ${C})`);
            console.log(`      - Revenue (Ticket * F * C): $${Math.round(REVENUE).toLocaleString()}`);
            console.log(`      - Costs (Weekly):`);
            console.log(`        - Fuel:       $${Math.round(fuelCost).toLocaleString()}`);
            console.log(`        - Crew:       $${Math.round(crewCost).toLocaleString()}`);
            console.log(`        - Airport:    $${Math.round(airportFees).toLocaleString()}`);
            console.log(`        - Deprec:     $${Math.round(depreciation).toLocaleString()}`);
            console.log(`        - Maint:      $${Math.round(maintenance).toLocaleString()}`);
            console.log(`        - Service:    $${Math.round(serviceSupplies).toLocaleString()}`);
            console.log(`        - TOTAL COST: $${Math.round(totalWeeklyCost).toLocaleString()}`);
            console.log(`      - Profit (Rev - Cost): $${Math.round(PROFIT).toLocaleString()}`);
            console.log(`      - SCORE (Profit / F): $${SCORE.toLocaleString()}`);
        }

        if (SCORE > maxScore) {
            maxScore = SCORE;
            bestPlaneForRoute = plane;
        }
    }

    if (!bestPlaneForRoute) {
        if (isDebug) console.log(`  [DEBUG] Skipping: No viable planes had Frequency > 0 or valid stats.`);
        return null;
    }

    if (isDebug) {
        console.log(`  [ANALYSIS] Best plane for route ${routeData.fromAirportCode} -> ${routeData.toAirportCode} is: ${bestPlaneForRoute.modelName} with score $${maxScore.toLocaleString()}`);
    } else if (maxScore > 0) {
        console.log(`  [ANALYSIS] Route ${routeData.fromAirportCode} -> ${routeData.toAirportCode}: Found profit! Score: $${maxScore.toLocaleString()} (Plane: ${bestPlaneForRoute.modelName})`);
    }

    return {
        fromAirportId: routeData.fromAirportId,
        toAirportId: routeData.toAirportId,
        score: maxScore,
        planeName: bestPlaneForRoute.modelName,
    };
}

/**
 * Utility function to add a delay.
 */
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Main analysis runner.
 */
export async function runAnalysis(username, password, baseAirports, userPlaneList, isDebug, testLimit, onProgress) {
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
            
            if (routeData) {
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

/**
 * Standalone helper to find an airport by IATA.
 */
export async function getAirportByIata(iata) {
    const client = createApiClient(); 
    console.log(`[API] Fetching airport by IATA: ${iata}`);
    try {
        const allAirports = await fetchAirports(client);
        const airport = allAirports.find(a => a.iata.toUpperCase() === iata.toUpperCase()) || null;
        if (airport) {
            console.log(`[API] Found ${iata}: ${airport.name} (ID: ${airport.id})`);
        } else {
            console.warn(`[API] Could not find airport with IATA: ${iata}`);
        }
        return airport;
    } catch (error) {
        console.error("[API] Failed to get airport by IATA:", error);
        return null;
    }
}
