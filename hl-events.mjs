#!/usr/bin/env node
/**
 * HyperAgent — Event Risk Layer
 *
 * Checks upcoming macro (FOMC, CPI, NFP, PCE, GDP, PPI) and crypto events,
 * applies time-window rules, and outputs restrictions for the agent.
 *
 * Data sources (100% free, no trials):
 *   - FRED API (St. Louis Fed) — macro release dates
 *   - Hardcoded FOMC 2026 dates (from federalreserve.gov)
 *   - Local events-crypto.json — manually maintained crypto events
 *
 * Usage: node hl-events.mjs
 */

import https from 'https';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HTTP_TIMEOUT = 15000;

// ─── FRED Release IDs & Standard Times ───

const MACRO_RELEASES = [
  { name: 'CPI',  releaseId: 10, timeET: '08:30', tier: 1, scope: 'global' },
  { name: 'NFP',  releaseId: 50, timeET: '08:30', tier: 1, scope: 'global' },
  { name: 'PCE',  releaseId: 21, timeET: '08:30', tier: 1, scope: 'global' },
  { name: 'GDP',  releaseId: 53, timeET: '08:30', tier: 2, scope: 'global' },
  { name: 'PPI',  releaseId: 46, timeET: '08:30', tier: 2, scope: 'global' },
];

// FOMC 2026 — decision dates (2nd day of each meeting), announcement at 14:00 ET
// Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
const FOMC_2026_DATES = [
  '2026-01-28',
  '2026-03-18',
  '2026-04-29',
  '2026-06-17',
  '2026-07-29',
  '2026-09-16',
  '2026-10-28',
  '2026-12-09',
];

// ─── Time Window Rules (milliseconds) ───

const WINDOWS = {
  tier1: {
    blockBefore:     6  * 3600e3,   // 6h before → block new entries
    hardBlockBefore: 90 * 60e3,     // 90min before → defensive only
    reduceAfter:     3  * 3600e3,   // 3h after → reduce (wait for direction)
  },
  tier2: {
    reduceBefore:  2 * 3600e3,      // 2h before → reduce size, higher score needed
    cautionAfter:  1 * 3600e3,      // 1h after → caution
  },
  tier3: {
    defaultWindow: 24 * 3600e3,     // 24h window for crypto events
  },
};

// ─── HTTP Helper ───

function httpGet(url) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'Accept': 'application/json', 'User-Agent': 'HyperAgent/1.0' },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`JSON parse error: ${d.slice(0, 200)}`)); }
      });
    });
    req.setTimeout(HTTP_TIMEOUT, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
  });
}

// ─── DST Detection (US Eastern) ───
// EDT (UTC-4): 2nd Sunday of March → 1st Sunday of November
// EST (UTC-5): rest of the year

function isEDT(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed

  // Jan, Feb, Nov, Dec → EST
  if (month < 2 || month > 10) return false;
  // Apr–Oct → EDT
  if (month > 2 && month < 10) return true;

  // March: EDT starts 2nd Sunday
  if (month === 2) {
    const firstDay = new Date(Date.UTC(year, 2, 1)).getUTCDay();
    const secondSunday = firstDay === 0 ? 8 : (14 - firstDay + 1);
    return date.getUTCDate() >= secondSunday;
  }

  // November: EDT ends 1st Sunday
  if (month === 10) {
    const firstDay = new Date(Date.UTC(year, 10, 1)).getUTCDay();
    const firstSunday = firstDay === 0 ? 1 : (7 - firstDay + 1);
    return date.getUTCDate() < firstSunday;
  }

  return false;
}

function etToUTC(dateStr, timeET) {
  const [hours, minutes] = timeET.split(':').map(Number);
  const base = new Date(`${dateStr}T${timeET}:00Z`);
  const offset = isEDT(base) ? 4 : 5;
  return new Date(Date.UTC(
    parseInt(dateStr.slice(0, 4)),
    parseInt(dateStr.slice(5, 7)) - 1,
    parseInt(dateStr.slice(8, 10)),
    hours + offset,
    minutes,
  ));
}

// ─── Fetch FRED Release Dates ───

async function fetchFREDReleaseDates(releaseId, apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${apiKey}&file_type=json&include_release_dates_with_no_data=true&sort_order=asc`;

  try {
    const data = await httpGet(url);
    if (!data.release_dates) return [];
    return data.release_dates
      .map(r => r.date)
      .filter(d => d >= today);
  } catch (e) {
    console.error(`⚠️ FRED fetch failed for release ${releaseId}: ${e.message}`);
    return [];
  }
}

// ─── Build All Macro Events ───

async function buildMacroEvents(apiKey) {
  const events = [];

  // FOMC dates (always available, hardcoded)
  const now = new Date();
  for (const dateStr of FOMC_2026_DATES) {
    const dateUTC = etToUTC(dateStr, '14:00');
    if (dateUTC < new Date(now.getTime() - WINDOWS.tier1.reduceAfter)) continue; // skip old
    events.push({
      name: 'FOMC',
      dateUTC: dateUTC.toISOString(),
      tier: 1,
      scope: 'global',
      source: 'hardcoded',
    });
  }

  // FRED releases
  if (!apiKey) {
    console.error('⚠️ FRED_API_KEY not set — only FOMC dates and crypto events available');
    return events;
  }

  for (const rel of MACRO_RELEASES) {
    await new Promise(r => setTimeout(r, 100)); // rate limit courtesy
    const dates = await fetchFREDReleaseDates(rel.releaseId, apiKey);
    for (const dateStr of dates.slice(0, 3)) { // next 3 upcoming dates max
      const dateUTC = etToUTC(dateStr, rel.timeET);
      if (dateUTC < new Date(now.getTime() - WINDOWS.tier1.reduceAfter)) continue;
      events.push({
        name: rel.name,
        dateUTC: dateUTC.toISOString(),
        tier: rel.tier,
        scope: rel.scope,
        source: 'FRED',
      });
    }
  }

  return events;
}

// ─── Load Crypto Events ───

function loadCryptoEvents() {
  try {
    const filePath = join(__dirname, 'events-crypto.json');
    const raw = readFileSync(filePath, 'utf8');
    const events = JSON.parse(raw);

    if (!Array.isArray(events)) {
      console.error('⚠️ events-crypto.json is not an array');
      return [];
    }

    const now = Date.now();
    const weekMs = 7 * 24 * 3600e3;

    return events.filter(e => {
      if (!e.coin || !e.event || !e.date || !e.tier || !e.action) {
        console.error(`⚠️ Skipping malformed crypto event: ${JSON.stringify(e)}`);
        return false;
      }
      const eventTime = new Date(e.date).getTime();
      return eventTime > now - WINDOWS.tier3.defaultWindow && eventTime < now + weekMs;
    }).map(e => ({
      name: `${e.coin}: ${e.event}`,
      coin: e.coin,
      dateUTC: new Date(e.date).toISOString(),
      tier: e.tier,
      scope: e.scope || 'asset',
      action: e.action,
      source: 'crypto-json',
    }));
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error('ℹ️ events-crypto.json not found — no crypto events loaded');
    } else {
      console.error(`⚠️ Error reading events-crypto.json: ${e.message}`);
    }
    return [];
  }
}

// ─── Classify Event → Apply Time Window Rules ───

function classifyEvent(event, now) {
  const eventTime = new Date(event.dateUTC).getTime();
  const msUntil = eventTime - now;
  const msAfter = -msUntil;

  let action = null;
  let reason = null;

  if (event.source === 'crypto-json') {
    // Tier 3: use action from JSON if within window
    const inWindow = Math.abs(msUntil) < WINDOWS.tier3.defaultWindow;
    if (inWindow) {
      action = event.action;
      reason = msUntil > 0 ? `${event.name} in ${formatDuration(msUntil)}` : `${event.name} ${formatDuration(msAfter)} ago`;
    }
  } else if (event.tier === 1) {
    if (msUntil > 0 && msUntil < WINDOWS.tier1.hardBlockBefore) {
      action = 'block';
      reason = `${event.name} in ${formatDuration(msUntil)} — defensive only`;
    } else if (msUntil > 0 && msUntil < WINDOWS.tier1.blockBefore) {
      action = 'block';
      reason = `${event.name} in ${formatDuration(msUntil)}`;
    } else if (msAfter > 0 && msAfter < WINDOWS.tier1.reduceAfter) {
      action = 'reduce';
      reason = `${event.name} released ${formatDuration(msAfter)} ago — wait for direction`;
    }
  } else if (event.tier === 2) {
    if (msUntil > 0 && msUntil < WINDOWS.tier2.reduceBefore) {
      action = 'reduce';
      reason = `${event.name} in ${formatDuration(msUntil)}`;
    } else if (msAfter > 0 && msAfter < WINDOWS.tier2.cautionAfter) {
      action = 'caution';
      reason = `${event.name} released ${formatDuration(msAfter)} ago`;
    }
  }

  return { ...event, action, reason, msUntil };
}

// ─── Determine Overall Status ───

function determineStatus(events) {
  const active = events.filter(e => e.action);
  if (active.some(e => e.action === 'block')) return 'HIGH';
  if (active.some(e => e.action === 'reduce')) return 'MEDIUM';
  if (active.some(e => e.action === 'caution')) return 'LOW';
  return 'CLEAR';
}

// ─── Format Duration ───

function formatDuration(ms) {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86400e3);
  const hours = Math.floor((abs % 86400e3) / 3600e3);
  const mins = Math.floor((abs % 3600e3) / 60e3);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 && days === 0) parts.push(`${mins}m`);
  return parts.join(' ') || '0m';
}

// ─── Output ───

function printOutput(status, classified, now) {
  const restrictions = classified.filter(e => e.action);
  const upcoming = classified
    .filter(e => e.msUntil > 0)
    .sort((a, b) => a.msUntil - b.msUntil);

  console.log('=== EVENT RISK ===');
  console.log(`Status: ${status}`);

  if (upcoming.length > 0) {
    const next = upcoming[0];
    const tierLabel = `Tier ${next.tier}`;
    const actionLabel = next.action ? ` — ${next.action}` : '';
    console.log(`Next: ${next.name} in ${formatDuration(next.msUntil)} (${tierLabel}${actionLabel})`);
  }

  if (restrictions.length > 0) {
    console.log('\nActive restrictions:');
    for (const r of restrictions) {
      const coinLabel = r.coin ? `${r.coin}: ` : '';
      console.log(`  - ${coinLabel}${r.action.toUpperCase()}: ${r.reason}`);
    }
  }

  // Upcoming events (next 7 days)
  if (upcoming.length > 0) {
    console.log('\nUpcoming events (7d):');
    for (const e of upcoming.slice(0, 10)) {
      const dateStr = new Date(e.dateUTC).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
      const tierLabel = `T${e.tier}`;
      console.log(`  - [${tierLabel}] ${e.name} — ${dateStr} (in ${formatDuration(e.msUntil)})`);
    }
  }

  if (status === 'CLEAR') {
    console.log('\n✅ No active event restrictions. Normal trading.');
  }

  // Machine-parseable JSON line
  const json = {
    status,
    timestamp: new Date(now).toISOString(),
    restrictions: restrictions.map(r => ({
      name: r.name,
      coin: r.coin || '*',
      tier: r.tier,
      action: r.action,
      reason: r.reason,
      dateUTC: r.dateUTC,
    })),
    upcoming: upcoming.slice(0, 10).map(e => ({
      name: e.name,
      tier: e.tier,
      dateUTC: e.dateUTC,
      msUntil: e.msUntil,
      action: e.action,
    })),
  };
  console.log(`\nEVENT_JSON:${JSON.stringify(json)}`);
}

// ─── Main ───

async function main() {
  const now = Date.now();

  // 1. Fetch macro events
  const macroEvents = await buildMacroEvents(process.env.FRED_API_KEY);

  // 2. Load crypto events
  const cryptoEvents = loadCryptoEvents();

  // 3. Merge and classify
  const allEvents = [...macroEvents, ...cryptoEvents];
  const classified = allEvents.map(e => classifyEvent(e, now));

  // 4. Determine status
  const status = determineStatus(classified);

  // 5. Output
  printOutput(status, classified, now);
}

main().catch(e => {
  console.error(`❌ Event risk check failed: ${e.message}`);
  process.exit(1);
});
