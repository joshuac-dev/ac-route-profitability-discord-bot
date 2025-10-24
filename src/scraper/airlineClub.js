import { newBrowser } from './browser.js';
import { parseMoney, formatUSD } from '../util/money.js';

// Helpers to find elements by the ids/classes you provided

const SEL = {
  loginUser: '#loginUserName',        // from login outerHTML
  loginPass: '#loginPassword',        // from login outerHTML
  loginBtn:  '.button.login',         // from login outerHTML
  gearIcon:  '#planLinkFromAirportEditIcon', // from gear outerHTML
  fromSelect:'#planLinkFromAirportSelect',   // from dropdown outerHTML
  costs: {
    fuel: '#FCPF', crew: '#CCPF', fees: '#AFPF',
    dep: '#depreciation', serv: '#SSPF', maint: '#maintenance'
  },
  competitors: '#planLinkCompetitors' // competitor container
};

async function login(page, {user, pass}) {
  await page.goto('https://www.airline-club.com/', { waitUntil: 'networkidle0' });

  // Some UIs hide the login box until responsive breakpoint; we’ll target the actual inputs by id.
  await page.type(SEL.loginUser, user);   // :contentReference[oaicite:5]{index=5}
  await page.type(SEL.loginPass, pass);   // :contentReference[oaicite:6]{index=6}
  await page.click(SEL.loginBtn);         // :contentReference[oaicite:7]{index=7}
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
}

async function pickFromAirport(page, airportIdValue) {
  // Click the gear, then set the <select> to the desired airport id
  await page.click(SEL.gearIcon);                               // :contentReference[oaicite:8]{index=8}
  await page.waitForSelector(SEL.fromSelect, { visible: true }); 
  await page.select(SEL.fromSelect, String(airportIdValue));    // :contentReference[oaicite:9]{index=9}
  await page.waitForNetworkIdle?.();
}

async function readPlaneCosts(page) {
  // Sum the visible per-flight costs per your UI block
  const get = async (s) => parseMoney(await page.$eval(s, el => el.textContent));
  const [fuel, crew, fees, dep, serv, maint] = await Promise.all([
    get(SEL.costs.fuel), get(SEL.costs.crew), get(SEL.costs.fees),
    get(SEL.costs.dep),  get(SEL.costs.serv), get(SEL.costs.maint)
  ]); // :contentReference[oaicite:10]{index=10}
  return { fuel, crew, fees, dep, serv, maint, total: fuel + crew + fees + dep + serv + maint };
}

async function readCompetition(page) {
  // Scrape table rows to get comp pricing/quality/LF for econ
  const rows = await page.$$eval(`${SEL.competitors} .data-row`, trs => trs.map(tr => {
    const cells = [...tr.children].map(td => td.textContent.trim());
    return {
      airline: cells[0],
      prices: cells[1],        // like "$270 / $720 / $2050"
      capFreq: cells[2],       // like "3257 / 66 / 6 (26)"
      quality: Number(cells[3]),
      lf: cells[4]
    };
  })); // :contentReference[oaicite:11]{index=11}
  return rows;
}

// TODO: Port the real econ price function from the game’s Scala.
// For now, a placeholder that takes service quality + competition into account.
function estimateEconomyPrice({ baseQuality, competition }) {
  // Placeholder heuristic until we wire the Scala logic:
  // take median of competitor econ prices, adjust by (baseQuality / 50).
  const econPrices = competition
    .map(c => (c.prices.match(/\$([0-9,]+)/)?.[1] || '').replace(/,/g, ''))
    .map(n => (n ? Number(n) : NaN))
    .filter(n => Number.isFinite(n))
    .sort((a,b)=>a-b);
  if (!econPrices.length) return 200; // fallback
  const mid = econPrices[Math.floor(econPrices.length/2)];
  const factor = Math.max(0.7, Math.min(1.3, baseQuality / 50));
  return Math.round(mid * factor);
}

export async function runRouteScan({ credentials, planes, bases }) {
  if (!bases?.length) return 'No bases configured. Use `/routefinder baselist add ...`.';
  if (!planes?.length) return 'No planes configured. Use `/routefinder planelist add ...`.';

  const { browser, page } = await newBrowser();
  try {
    await login(page, credentials);

    // TODO: 1) Open route finder UI (click your "Plan Flight" button).
    // TODO: 2) For each base: ensure From: matches, else change using gear+dropdown.
    // TODO: 3) Iterate ALL destination airports (one by one) and:
    //   - Switch through plane dropdown; only consider planes in `planes` list
    //   - Read per-flight cost (readPlaneCosts)
    //   - Read competition (readCompetition)
    //   - Compute best econ price (estimateEconomyPrice) -> revenue
    //   - Multiply by frequency * capacity (all-economy)
    //   - PROFIT = REVENUE - COSTS
    //   - PROFIT/FREQ = PROFIT / frequency (rounded)
    // Keep a top-5 per base, then format the result.

    // For now, return a stub so the bot replies.
    return 'Scanner wired. Next step: hook route-finder navigation + Scala pricing.';
  } finally {
    await browser.close();
  }
}
