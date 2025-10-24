import { newBrowser } from './browser.js';
import { parseMoney, formatUSD } from '../util/money.js';

const SEL = {
  loginUser: '#loginUserName',
  loginPass: '#loginPassword',
  loginBtn:  '.button.login',

  // From: base swap
  gearIcon:   '#planLinkFromAirportEditIcon',
  fromSelect: '#planLinkFromAirportSelect',

  // Planner DOM anchors (for cross-checks / fallbacks)
  toName:       '#planLinkToAirportName',       // Erzincan(ERC) etc.
  directDemand: '#planLinkDirectDemand',        // "414 / 4 / 0"

  // Per-flight cost fields (light-blue block)
  costs: {
    fuel: '#FCPF', crew: '#CCPF', fees: '#AFPF',
    dep: '#depreciation', serv: '#SSPF', maint: '#maintenance'
  }
};

// API endpoint guesses (work in most AC installs; adjustable if needed)
const AIRPORTS_API_HINTS = ['/airports', '/airports/all', '/airports?simple=true'];

async function login(page, {user, pass}) {
  await page.goto('https://www.airline-club.com/', { waitUntil: 'networkidle0' });
  await page.type(SEL.loginUser, user);
  await page.type(SEL.loginPass, pass);
  await page.click(SEL.loginBtn);
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
}

async function pickFromAirportByIATA(page, iata) {
  // open the dropdown via gear, then choose option whose text contains (IATA)
  await page.click(SEL.gearIcon); // shows the <select>
  await page.waitForSelector(SEL.fromSelect, { visible: true });
  const value = await page.$eval(SEL.fromSelect, (sel, iata) => {
    const opts = [...sel.querySelectorAll('option')];
    const hit = opts.find(o => (o.textContent || '').includes(`(${iata.toUpperCase()})`));
    return hit ? hit.value : null;
  }, iata);
  if (!value) throw new Error(`Base ${iata} not found in From dropdown`);
  await page.select(SEL.fromSelect, String(value)); // triggers planner reload hook
  // give the UI a beat if it reloads anything
  await page.waitForTimeout(250);
}

async function fetchAllAirports(page) {
  // Try common endpoints; fall back to reading map DOM if needed.
  for (const url of AIRPORTS_API_HINTS) {
    try {
      const res = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      }, url);
      // Expect objects with { id, iata, name, countryCode, ... }
      if (Array.isArray(res) && res.length && (res[0].id || res[0].iata)) {
        return res;
      }
    } catch (_) {/* try next */}
  }
  // Fallback: use any data already present in planner session (best-effort).
  return [];
}

function normalizePlaneMatcher(userList) {
  // support ids or names; do case-insensitive name contains
  const ids = new Set();
  const names = [];
  for (const x of userList) {
    const t = String(x).trim();
    if (/^\d+$/.test(t)) ids.add(Number(t));
    else names.push(t.toLowerCase());
  }
  return (model) => {
    if (ids.has(model.modelId)) return true;
    const nm = (model.modelName || '').toLowerCase();
    return names.some(s => nm.includes(s));
  };
}

async function readPerFlightCostFromDom(page) {
  // Sum the cost buckets visible on the planner for currently selected model
  const get = async (s) => {
    try {
      return parseMoney(await page.$eval(s, el => el.textContent || ''));
    } catch { return 0; }
  };
  const [fuel, crew, fees, dep, serv, maint] = await Promise.all([
    get(SEL.costs.fuel), get(SEL.costs.crew), get(SEL.costs.fees),
    get(SEL.costs.dep),  get(SEL.costs.serv), get(SEL.costs.maint)
  ]);
  return { fuel, crew, fees, dep, serv, maint, total: fuel + crew + fees + dep + serv + maint };
}

async function captureNextPlannerJSON(page) {
  // Wait for the next XHR that contains the planner payload (server suggestion lives here)
  const resp = await page.waitForResponse(r =>
    /plan-link/i.test(r.url()) && /application\/json/i.test(r.headers()['content-type'] || ''), { timeout: 15000 }
  ).catch(() => null);
  if (!resp) return null;
  try { return await resp.json(); } catch { return null; }
}

async function openPlannerForToAirport(page, fromId, toId) {
  // Use the page’s own function (observed in onchange on the From select)
  await page.evaluate(({ fromId, toId }) => {
    // planLink(from,to) exists on the page
    // eslint-disable-next-line no-undef
    if (typeof planLink === 'function') planLink(fromId, toId);
  }, { fromId, toId });
}

async function getCurrentFromId(page) {
  return page.$eval(SEL.fromSelect, sel => sel.value).catch(() => null);
}

async function getToIdFromPlannerDom(page) {
  // If the destination identity span has onclick="showAirportDetails(2368)", use that 2368
  const onclick = await page.$eval(SEL.toName, el => el.getAttribute('onclick') || '').catch(() => '');
  const m = onclick.match(/\((\d+)\)/);
  return m ? Number(m[1]) : null;
}

function pickBestPlaneByCost(models, userMatcher, costLookup) {
  // models: modelPlanLinkInfo[] from planner JSON
  // costLookup(modelId) -> perFlight total cost
  const filtered = models.filter(userMatcher);
  let best = null;
  for (const m of filtered) {
    const cost = costLookup(m.modelId);
    if (cost == null) continue;
    if (!best || cost < best.cost) best = { model: m, cost };
  }
  return best;
}

export async function runRouteScan({ credentials, planes, bases }) {
  if (!bases?.length) return 'No bases configured. Use `/routefinder baselist add ...`.';
  if (!planes?.length) return 'No planes configured. Use `/routefinder planelist add ...`.';

  const { browser, page } = await newBrowser();
  const perBaseResults = [];

  try {
    await login(page, credentials);

    const airports = await fetchAllAirports(page); // may be empty; we can still drive via map/manual clicks later

    for (const base of bases) {
      // Ensure From: is the base being processed
      await pickFromAirportByIATA(page, base.iata || base.IATA || base.iataCode || base);

      const fromId = await getCurrentFromId(page); // value from the select

      // List of candidate destinations: from API if available; otherwise we’ll skip (until user clicks)
      const destinations = airports.length ? airports.filter(a => String(a.id) !== String(fromId)) : [];

      // We'll keep top-5 for this base
      const top = [];

      for (const to of destinations) {
        // Trigger planner for (fromId, to.id) and capture its JSON
        const plannerPromise = captureNextPlannerJSON(page);
        await openPlannerForToAirport(page, Number(fromId), Number(to.id));
        const planner = await plannerPromise;

        if (!planner || !planner.modelPlanLinkInfo?.length) continue;

        // Build a modelId -> per-flight cost lookup by briefly selecting model in UI (so the cost panel updates)
        const userMatcher = normalizePlaneMatcher(planes);

        // If UI exposes a model <select>, prefer that; otherwise we’ll compute costs from current DOM only
        const costByModelId = new Map();

        // Try to use client helpers the page exposes to switch model; if not present, fall back to current
        for (const m of planner.modelPlanLinkInfo.filter(userMatcher)) {
          // Attempt to switch model using page code, if available
          await page.evaluate((id) => {
            // Many AC builds expose a hidden "selectedModel" input and an update call
            const sel = document.querySelector('#airplaneModelDetails .selectedModel');
            if (sel) { sel.value = String(id); }
            if (typeof window.updateModelInfo === 'function') window.updateModelInfo();
          }, m.modelId).catch(() => {});
          // Give the UI a moment to refresh costs
          await page.waitForTimeout(150);
          const pf = await readPerFlightCostFromDom(page);
          if (pf.total > 0) costByModelId.set(m.modelId, pf.total);
        }

        const costLookup = (modelId) => costByModelId.get(modelId);
        const best = pickBestPlaneByCost(planner.modelPlanLinkInfo, userMatcher, costLookup);
        if (!best) continue;

        // Server-guided price for economy
        const priceEcon =
          planner.suggestedPrice?.economy ??
          planner.suggestedPriceEcon ?? // fallback variants in some builds
          null;
        if (!priceEcon) continue;

        const freq = best.model.maxFrequency ?? best.model.frequency ?? 0;
        const cap  = best.model.capacity ?? best.model.seats ?? 0;
        if (!freq || !cap) continue;

        const revenue = priceEcon * cap * freq;

        // Costs per flight (we already read for the chosen model; multiply by freq)
        const perFlightCost = costLookup(best.model.modelId) ?? 0;
        const totalCost = perFlightCost * freq;

        const profit = revenue - totalCost;
        const profitPerFreq = Math.round(profit / Math.max(1, freq));

        top.push({
          fromIATA: (base.iata || base.IATA || '').toUpperCase(),
          toIATA: (to.iata || to.code || '').toUpperCase(),
          profitPerFreq,
        });

        // Maintain top-5
        top.sort((a, b) => b.profitPerFreq - a.profitPerFreq);
        if (top.length > 5) top.length = 5;
      }

      // Format output for this base
      if (top.length) {
        perBaseResults.push(
          `**${base.iata.toUpperCase()}** top routes:\n` +
          top.map(r => `${r.fromIATA} - ${r.toIATA} - ${formatUSD(r.profitPerFreq)}`).join('\n')
        );
      } else {
        perBaseResults.push(`**${base.iata.toUpperCase()}** — no qualifying routes found.`);
      }
    }

    return perBaseResults.join('\n\n');

  } catch (err) {
    console.error(err);
    return `Route scan failed: ${err.message}`;
  } finally {
    await browser.close();
  }
}
