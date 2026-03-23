#!/usr/bin/env node
/**
 * Hyperliquid Market Analysis — Top-Down Approach
 * 
 * Flow: Daily (macro) → 4h (direction) → 1h (entry timing)
 * 
 * 1. Daily candles: regime, SMA50/200, EMA20/50, macro RSI, Fibonacci, trend
 * 2. 4h candles: intermediate direction, RSI, momentum confirmation
 * 3. 1h candles: entry timing signal
 * 
 * Usage: node hl-analysis.mjs
 */

import https from 'https';

if (!process.env.HL_ACCOUNT) {
  console.error('Missing env var. Set HL_ACCOUNT (see .env.example)');
  process.exit(1);
}

const ACCOUNT = process.env.HL_ACCOUNT;

// ─── Sector correlation groups ───
const SECTOR_MAP = {
  // L1s
  ETH: 'L1', SOL: 'L1', AVAX: 'L1', NEAR: 'L1', ADA: 'L1', DOT: 'L1', APT: 'L1', SUI: 'L1', SEI: 'L1', TIA: 'L1', INJ: 'L1', ATOM: 'L1', FTM: 'L1', ALGO: 'L1',
  // DeFi
  AAVE: 'DeFi', CRV: 'DeFi', UNI: 'DeFi', LINK: 'DeFi', MKR: 'DeFi', SNX: 'DeFi', COMP: 'DeFi', SUSHI: 'DeFi', YFI: 'DeFi', PENDLE: 'DeFi', JUP: 'DeFi',
  // Memes
  DOGE: 'Meme', SHIB: 'Meme', PEPE: 'Meme', WIF: 'Meme', BONK: 'Meme', FARTCOIN: 'Meme', PUMP: 'Meme', FLOKI: 'Meme', MEME: 'Meme', POPCAT: 'Meme', NEIRO: 'Meme', PNUT: 'Meme', GOAT: 'Meme', MEW: 'Meme', TRUMP: 'Meme',
  // L2s
  ARB: 'L2', OP: 'L2', MATIC: 'L2', STRK: 'L2', ZK: 'L2', BLAST: 'L2', SCROLL: 'L2', MANTA: 'L2', METIS: 'L2',
  // AI
  RENDER: 'AI', FET: 'AI', ONDO: 'AI', TAO: 'AI', ARKM: 'AI', WLD: 'AI',
  // Gaming
  AXS: 'Gaming', IMX: 'Gaming', GALA: 'Gaming', SAND: 'Gaming', MANA: 'Gaming', PIXEL: 'Gaming',
  // BTC is its own sector
  BTC: 'BTC',
};

// ─── HTTP helpers ───

const HTTP_TIMEOUT = 15000;

function post(body) {
  return new Promise((resolve, reject) => {
    const p = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.hyperliquid.xyz', port: 443, path: '/info', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.setTimeout(HTTP_TIMEOUT, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject); req.write(p); req.end();
  });
}

function httpGet(url) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function getBTCDominance() {
  try {
    const data = await httpGet('https://api.coingecko.com/api/v3/global');
    if (data?.data?.market_cap_percentage?.btc) return data.data.market_cap_percentage.btc;
  } catch(e) {}
  try {
    const data = await httpGet('https://api.coincap.io/v2/assets/bitcoin');
    if (data?.data?.marketCapDominance) return parseFloat(data.data.marketCapDominance);
  } catch(e) {}
  console.error('⚠️ BTC dominance unavailable (CoinGecko + CoinCap both failed) — macro scoring incomplete');
  return null;
}

// ─── Technical Indicators ───

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = parseFloat(candles[i].h), l = parseFloat(candles[i].l), pc = parseFloat(candles[i - 1].c);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcVolatility(closes) {
  if (closes.length < 2) return 0;
  const returns = [];
  for (let i = 1; i < closes.length; i++) returns.push(Math.log(closes[i] / closes[i - 1]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

function volPercentile(currentVol, historicalVols) {
  const sorted = [...historicalVols].sort((a, b) => a - b);
  const rank = sorted.filter(v => v <= currentVol).length;
  return (rank / sorted.length) * 100;
}

function sma(closes, period) {
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function ema(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    e = closes[i] * k + e * (1 - k);
  }
  return e;
}

// ─── Pivot-based Swing Detection ───
// A swing low: candle with `wing` lower candles on each side
// A swing high: candle with `wing` higher candles on each side
// Returns the most recent pivot high and pivot low

function findSwing(closes, lookback = 50) {
  if (closes.length < 10) return null;
  const seg = closes.slice(-Math.min(lookback, closes.length));
  const wing = 3; // require 3 candles on each side

  let pivotLow = null, pivotLowIdx = -1;
  let pivotHigh = null, pivotHighIdx = -1;

  // Scan from most recent backwards to find the latest pivots
  for (let i = seg.length - 1 - wing; i >= wing; i--) {
    // Check pivot low
    if (pivotLow === null) {
      let isLow = true;
      for (let j = 1; j <= wing; j++) {
        if (seg[i - j] <= seg[i] || seg[i + j] <= seg[i]) { isLow = false; break; }
      }
      if (isLow) { pivotLow = seg[i]; pivotLowIdx = i; }
    }
    // Check pivot high
    if (pivotHigh === null) {
      let isHigh = true;
      for (let j = 1; j <= wing; j++) {
        if (seg[i - j] >= seg[i] || seg[i + j] >= seg[i]) { isHigh = false; break; }
      }
      if (isHigh) { pivotHigh = seg[i]; pivotHighIdx = i; }
    }
    if (pivotLow !== null && pivotHigh !== null) break;
  }

  // Fallback: if we couldn't find proper pivots, use min/max
  if (pivotLow === null || pivotHigh === null) {
    let lo = Infinity, loIdx = 0, hi = -Infinity, hiIdx = 0;
    for (let i = 0; i < seg.length; i++) {
      if (seg[i] < lo) { lo = seg[i]; loIdx = i; }
      if (seg[i] > hi) { hi = seg[i]; hiIdx = i; }
    }
    if (pivotLow === null) { pivotLow = lo; pivotLowIdx = loIdx; }
    if (pivotHigh === null) { pivotHigh = hi; pivotHighIdx = hiIdx; }
  }

  return { swingLow: pivotLow, swingHigh: pivotHigh, isUptrend: pivotLowIdx < pivotHighIdx };
}

function calcFibLevels(swingLow, swingHigh, isUptrend) {
  const d = swingHigh - swingLow;
  if (isUptrend) {
    return {
      ret_236: swingHigh - d * 0.236, ret_382: swingHigh - d * 0.382,
      ret_500: swingHigh - d * 0.500, ret_618: swingHigh - d * 0.618,
      tp1: swingHigh + d * 0.272, tp2: swingHigh + d * 0.618,
      tp3: swingHigh + d * 1.000, tp4: swingHigh + d * 1.618,
    };
  } else {
    return {
      ret_236: swingLow + d * 0.236, ret_382: swingLow + d * 0.382,
      ret_500: swingLow + d * 0.500, ret_618: swingLow + d * 0.618,
      tp1: swingLow - d * 0.272, tp2: swingLow - d * 0.618,
      tp3: swingLow - d * 1.000, tp4: swingLow - d * 1.618,
    };
  }
}

function kellyFraction(winRate, avgWinLoss) {
  return Math.max(0, (winRate - (1 - winRate) / avgWinLoss) * 0.5);
}

// ─── Trailing SL Recommendation ───

function trailingSLRec(currentPx, isLong, allLevels) {
  if (!allLevels || allLevels.length < 3) return null;

  // Sort levels ascending by price
  const sorted = [...allLevels].filter(l => l.px > 0).sort((a, b) => a.px - b.px);

  if (isLong) {
    // For longs: find the highest level still below current price, then go 2 back
    const below = sorted.filter(l => l.px < currentPx);
    if (below.length < 2) return null;
    const target = below[below.length - 2]; // 2 levels below price
    return { slPrice: target.px, label: `Trail → ${target.label} (2 levels below)` };
  } else {
    // For shorts: find the lowest level still above current price, then go 2 back
    const above = sorted.filter(l => l.px > currentPx);
    if (above.length < 2) return null;
    const target = above[1]; // 2 levels above price
    return { slPrice: target.px, label: `Trail → ${target.label} (2 levels above)` };
  }
}

// ─── Regime Classification (on DAILY data) ───

function getRegime(volPct, momentum) {
  const isTrending = Math.abs(momentum) > 0.05;
  const isHighVol = volPct > 60;

  if (isTrending && !isHighVol) return { regime: 'TRENDING_NORMAL', kelly: 0.5, atrMult: 2.5, action: 'FULL' };
  if (isTrending && isHighVol) return { regime: 'TRENDING_HIGHVOL', kelly: 0.25, atrMult: 3.0, action: 'SMALL' };
  if (!isTrending && !isHighVol) return { regime: 'RANGING_NORMAL', kelly: 0.5, atrMult: 1.2, action: 'MEAN_REVERT' };
  return { regime: 'RANGING_HIGHVOL', kelly: 0, atrMult: 0, action: 'SIT_OUT' };
}

// ─── Main ───

async function main() {
  const now = Date.now();

  // ━━━ 1. ACCOUNT STATE ━━━
  const state = await post({ type: 'clearinghouseState', user: ACCOUNT });
  const spot = await post({ type: 'spotClearinghouseState', user: ACCOUNT });
  if (!spot || !spot.balances) throw new Error('Could not fetch spot balance. Check HL_ACCOUNT.');
  const usdc = spot.balances.find(b => b.coin === 'USDC');
  const totalBalance = parseFloat(usdc?.total || '0');
  const hold = parseFloat(usdc?.hold || '0');
  const freeBalance = totalBalance - hold;

  console.log('=== ACCOUNT ===');
  console.log(`Total: $${totalBalance.toFixed(2)} | Hold: $${hold.toFixed(2)} | Free: $${freeBalance.toFixed(2)}`);
  console.log(`Positions: ${state.assetPositions.length}`);

  // Track open positions for correlation & sizing
  const openPositions = [];

  if (state.assetPositions.length > 0) {
    console.log('\n=== OPEN POSITIONS ===');
    for (const ap of state.assetPositions) {
      const p = ap.position;
      const entryPx = parseFloat(p.entryPx);
      const szi = parseFloat(p.szi);
      const isLong = szi > 0;
      const currentPx = parseFloat(p.positionValue) / Math.abs(szi);
      const pnlPct = (parseFloat(p.returnOnEquity) * 100).toFixed(2);

      openPositions.push({ coin: p.coin, isLong, sector: SECTOR_MAP[p.coin] || 'Other' });

      let posLine = `${p.coin}: ${isLong ? 'LONG' : 'SHORT'} ${p.szi} @ ${p.entryPx} | PnL: ${pnlPct}% | Value: $${parseFloat(p.positionValue).toFixed(2)}`;

      // Fetch 4h candles for this position's coin to build fib levels
      try {
        const h4 = await post({ type: 'candleSnapshot', req: { coin: p.coin, interval: '4h', startTime: now - 7 * 86400000, endTime: now } });
        if (h4.length >= 10) {
          const h4Closes = h4.map(x => parseFloat(x.c));
          const h4Swing = findSwing(h4Closes, 42);
          const posLevels = [];
          if (h4Swing) {
            const fib = calcFibLevels(h4Swing.swingLow, h4Swing.swingHigh, h4Swing.isUptrend);
            posLevels.push(
              { px: fib.ret_236, label: 'fib_236' },
              { px: fib.ret_382, label: 'fib_382' },
              { px: fib.ret_500, label: 'fib_500' },
              { px: fib.ret_618, label: 'fib_618' },
              { px: h4Swing.swingLow, label: 'h4_swing_low' },
              { px: h4Swing.swingHigh, label: 'h4_swing_high' },
            );
          }
          const slRec = trailingSLRec(currentPx, isLong, posLevels);
          if (slRec) {
            posLine += `\n  📍 SL Rec: ${slRec.label} → $${slRec.slPrice.toPrecision(6)}`;
          }
        }
      } catch (e) {
        console.error(`  ⚠️ Could not compute trailing SL for ${p.coin}: ${e.message}`);
      }

      console.log(posLine);
    }
  }

  // ━━━ 1b. VERIFY OPEN ORDERS (SL/TP check) ━━━
  if (state.assetPositions.length > 0) {
    console.log('\n=== ORDER VERIFICATION ===');
    try {
      const openOrders = await post({ type: 'openOrders', user: ACCOUNT });
      const ordersByAsset = {};
      for (const o of openOrders) {
        const coin = o.coin;
        if (!ordersByAsset[coin]) ordersByAsset[coin] = { hasSL: false, hasTP: false, orders: [] };
        ordersByAsset[coin].orders.push(o);
        // Detect SL/TP: reduce-only orders are likely SL or TP
        if (o.reduceOnly) {
          // A stop order below entry for longs / above entry for shorts = SL
          // A limit order above entry for longs / below entry for shorts = TP
          // We'll just check if there are at least 2 reduce-only orders (SL + TP)
          const pos = state.assetPositions.find(ap => ap.position.coin === coin);
          if (pos) {
            const isLong = parseFloat(pos.position.szi) > 0;
            const limitPx = parseFloat(o.limitPx);
            const entry = parseFloat(pos.position.entryPx);
            if (isLong) {
              if (limitPx <= entry) ordersByAsset[coin].hasSL = true;
              if (limitPx > entry) ordersByAsset[coin].hasTP = true;
            } else {
              if (limitPx >= entry) ordersByAsset[coin].hasSL = true;
              if (limitPx < entry) ordersByAsset[coin].hasTP = true;
            }
          }
        }
      }

      for (const ap of state.assetPositions) {
        const coin = ap.position.coin;
        const info = ordersByAsset[coin];
        const warnings = [];
        if (!info || !info.hasSL) warnings.push('❌ NO SL FOUND');
        if (!info || !info.hasTP) warnings.push('❌ NO TP FOUND');
        if (warnings.length > 0) {
          console.log(`⚠️ ${coin}: ${warnings.join(' | ')}`);
        } else {
          console.log(`✅ ${coin}: SL + TP active`);
        }
      }
    } catch (e) {
      console.log('⚠️ Could not verify open orders:', e.message);
    }
  }

  // ━━━ 2. MACRO — BTC DAILY ━━━
  console.log('\n' + '='.repeat(60));
  console.log('=== STEP 1: MACRO — BTC DAILY ===');
  console.log('='.repeat(60));

  const btcDom = await getBTCDominance();
  const btcDaily = await post({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1d', startTime: now - 200 * 86400000, endTime: now } });
  const btcDailyCloses = btcDaily.map(c => parseFloat(c.c));
  const btcPrice = btcDailyCloses[btcDailyCloses.length - 1];

  const btcRSI_D = calcRSI(btcDailyCloses);

  const len = btcDailyCloses.length;
  const mom7d = len >= 7 ? (btcDailyCloses[len - 1] - btcDailyCloses[len - 7]) / btcDailyCloses[len - 7] : 0;
  const mom30d = len >= 30 ? (btcDailyCloses[len - 1] - btcDailyCloses[len - 30]) / btcDailyCloses[len - 30] : 0;

  const dailyWindowSize = 14;
  const historicalVols = [];
  for (let i = dailyWindowSize; i < btcDailyCloses.length; i++) {
    historicalVols.push(calcVolatility(btcDailyCloses.slice(i - dailyWindowSize, i)));
  }
  const currentDailyVol = calcVolatility(btcDailyCloses.slice(-dailyWindowSize));
  const dailyVolAnn = currentDailyVol * Math.sqrt(365);
  const dailyVolPct = volPercentile(currentDailyVol, historicalVols);

  const btcRegime = getRegime(dailyVolPct, mom7d);

  // SMAs
  const sma50 = sma(btcDailyCloses, 50);
  const sma200 = sma(btcDailyCloses, 200);

  // EMAs
  const ema20 = ema(btcDailyCloses, 20);
  const ema50 = ema(btcDailyCloses, 50);

  const dailySwing = findSwing(btcDailyCloses, 60);
  let dailyFib = null, macroTrend = 'NEUTRAL';
  if (dailySwing) {
    dailyFib = calcFibLevels(dailySwing.swingLow, dailySwing.swingHigh, dailySwing.isUptrend);
    macroTrend = dailySwing.isUptrend ? 'UPTREND' : 'DOWNTREND';
  }

  const btcDailyATR = calcATR(btcDaily);

  console.log(`BTC: $${btcPrice.toFixed(0)} | Daily RSI: ${btcRSI_D.toFixed(1)}`);
  console.log(`Mom 7d: ${(mom7d * 100).toFixed(2)}% | Mom 30d: ${(mom30d * 100).toFixed(2)}%`);
  console.log(`Daily Vol: ${(dailyVolAnn * 100).toFixed(1)}% ann | Percentile: ${dailyVolPct.toFixed(0)}th`);
  console.log(`Regime (DAILY): ${btcRegime.regime} → ${btcRegime.action}`);
  if (sma50) console.log(`SMA50: $${sma50.toFixed(0)} ${btcPrice > sma50 ? '(price ABOVE ✅)' : '(price BELOW ⚠️)'}`);
  if (sma200) console.log(`SMA200: $${sma200.toFixed(0)} ${btcPrice > sma200 ? '(price ABOVE ✅)' : '(price BELOW ⚠️)'}`);
  if (ema20) console.log(`EMA20: $${ema20.toFixed(0)} ${btcPrice > ema20 ? '(price ABOVE ✅)' : '(price BELOW ⚠️)'}`);
  if (ema50) console.log(`EMA50: $${ema50.toFixed(0)} ${btcPrice > ema50 ? '(price ABOVE ✅)' : '(price BELOW ⚠️)'}`);
  if (sma50 && sma200) console.log(`${sma50 > sma200 ? 'Golden Cross ✅' : 'Death Cross ⚠️'}`);
  if (dailySwing) {
    const pricePct = (btcPrice - dailySwing.swingLow) / (dailySwing.swingHigh - dailySwing.swingLow);
    console.log(`Daily Swing: $${dailySwing.swingLow.toFixed(0)} → $${dailySwing.swingHigh.toFixed(0)} (${macroTrend})`);
    console.log(`Position in range: ${(pricePct * 100).toFixed(1)}%`);
    if (dailyFib) {
      console.log(`Daily Fib Supports: 0.382=$${dailyFib.ret_382.toFixed(0)} | 0.5=$${dailyFib.ret_500.toFixed(0)} | 0.618=$${dailyFib.ret_618.toFixed(0)}`);
    }
  }
  console.log(`BTC Dominance: ${btcDom ? btcDom.toFixed(2) + '%' : 'N/A'} ${!btcDom ? '' : btcDom > 58 ? '(HIGH — desfavorable alts)' : btcDom > 45 ? '(normal)' : '(LOW — altseason!)'}`);
  console.log(`Daily ATR: $${btcDailyATR.toFixed(0)}`);

  // Macro bias
  let macroBias = 0;
  if (btcRSI_D < 30) macroBias += 1;
  if (btcRSI_D > 70) macroBias -= 1;
  if (mom30d < -0.15) macroBias -= 1;
  if (mom30d > 0.15) macroBias += 1;
  if (sma50 && btcPrice < sma50) macroBias -= 1;
  if (sma200 && btcPrice < sma200) macroBias -= 1;
  if (sma50 && btcPrice > sma50) macroBias += 0.5;
  if (sma200 && btcPrice > sma200) macroBias += 0.5;
  // EMA signals contribute to macro bias
  if (ema20 && ema50 && ema20 > ema50) macroBias += 0.5;
  if (ema20 && ema50 && ema20 < ema50) macroBias -= 0.5;
  if (macroTrend === 'DOWNTREND') macroBias -= 1;
  if (macroTrend === 'UPTREND') macroBias += 1;
  macroBias = Math.max(-2, Math.min(2, Math.round(macroBias)));

  console.log(`\nMACRO BIAS: ${macroBias > 0 ? '+' : ''}${macroBias} ${macroBias >= 1 ? '🟢 favors LONGS' : macroBias <= -1 ? '🔴 favors SHORTS' : '⚪ neutral'}`);

  // ━━━ 3. INTERMEDIATE — BTC 4H ━━━
  console.log('\n' + '='.repeat(60));
  console.log('=== STEP 2: INTERMEDIATE — BTC 4H ===');
  console.log('='.repeat(60));

  const btc4h = await post({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '4h', startTime: now - 14 * 86400000, endTime: now } });
  const btc4hCloses = btc4h.map(c => parseFloat(c.c));
  const btcRSI_4h = calcRSI(btc4hCloses);
  const mom4h_3d = btc4hCloses.length >= 18 ? (btc4hCloses[btc4hCloses.length - 1] - btc4hCloses[btc4hCloses.length - 18]) / btc4hCloses[btc4hCloses.length - 18] : 0;
  const btc4hATR = calcATR(btc4h);
  const swing4h = findSwing(btc4hCloses, 42);

  console.log(`BTC 4h RSI: ${btcRSI_4h.toFixed(1)} | Mom 3d: ${(mom4h_3d * 100).toFixed(2)}%`);
  console.log(`4h ATR: $${btc4hATR.toFixed(0)}`);
  if (swing4h) {
    console.log(`4h Swing: $${swing4h.swingLow.toFixed(0)} → $${swing4h.swingHigh.toFixed(0)} (${swing4h.isUptrend ? 'UP' : 'DOWN'})`);
  }

  let btcHealthy = true;
  const btcWarnings = [];
  if (btcRSI_D < 25) btcWarnings.push('Daily RSI extremely oversold — potential capitulation');
  if (sma50 && sma200 && sma50 < sma200) btcWarnings.push('Death Cross active');
  if (sma200 && btcPrice < sma200 * 0.95) btcWarnings.push('Price >5% below SMA200');
  if (mom30d < -0.20) btcWarnings.push('BTC down >20% in 30d — bear market');

  if (btcWarnings.length >= 2) {
    btcHealthy = false;
    console.log('\n⚠️ BTC HEALTH WARNING:');
    btcWarnings.forEach(w => console.log(`  - ${w}`));
    console.log('  → Extra caution on all trades, especially alts');
  }

  // ━━━ 4. REGIME DECISION ━━━
  console.log('\n' + '='.repeat(60));
  console.log('=== REGIME DECISION ===');
  console.log('='.repeat(60));
  console.log(`Regime: ${btcRegime.regime} (based on DAILY candles)`);
  console.log(`Action: ${btcRegime.action}`);

  if (btcRegime.action === 'SIT_OUT') {
    console.log('\n⚠️ RANGING + HIGH VOL on daily — very dangerous conditions.');
    console.log('Scanning tokens anyway for monitoring.');
    console.log('CONDITIONAL trades allowed if macro bias ±2 AND score ±4.\n');
  }

  // ━━━ 5. TOKEN SCAN ━━━
  console.log('='.repeat(60));
  console.log('=== STEP 3: TOKEN SCAN (Daily → 4h → 1h) ===');
  console.log('='.repeat(60));

  const meta = await post({ type: 'metaAndAssetCtxs' });
  const universe = meta[0].universe;
  const ctxs = meta[1];

  const candidates = [];
  for (let i = 0; i < universe.length; i++) {
    const ctx = ctxs[i];
    if (!ctx) continue;
    const vol24h = parseFloat(ctx.dayNtlVlm);
    if (vol24h < 5000000) continue;
    candidates.push({
      name: universe[i].name, index: i, szDecimals: universe[i].szDecimals,
      price: parseFloat(ctx.markPx),
      prevDay: parseFloat(ctx.prevDayPx),
      chg24h: parseFloat(ctx.prevDayPx) > 0 ? (parseFloat(ctx.markPx) - parseFloat(ctx.prevDayPx)) / parseFloat(ctx.prevDayPx) : 0,
      vol24h, funding: parseFloat(ctx.funding),
      oi: parseFloat(ctx.openInterest) * parseFloat(ctx.markPx),
    });
  }

  console.log(`Candidates (vol > $5M): ${candidates.length}\n`);

  // Sizing adjustment based on open positions count
  const numOpen = state.assetPositions.length;
  let maxCapPct;
  if (numOpen === 0) maxCapPct = 0.50;
  else if (numOpen === 1) maxCapPct = 0.40;
  else if (numOpen === 2) maxCapPct = 0.30;
  else maxCapPct = 0.20;

  // Track sectors already occupied by open positions
  const occupiedSectors = new Map(); // sector -> { coin, direction }
  for (const pos of openPositions) {
    if (pos.sector && pos.sector !== 'Other') {
      occupiedSectors.set(pos.sector, { coin: pos.coin, isLong: pos.isLong });
    }
  }

  const scored = [];

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  for (const c of candidates) {
    try {
      await delay(50); // rate limit: 50ms between tokens
      // ── Daily candles ──
      const daily = await post({ type: 'candleSnapshot', req: { coin: c.name, interval: '1d', startTime: now - 90 * 86400000, endTime: now } });
      if (daily.length < 20) continue;
      const dailyCloses = daily.map(x => parseFloat(x.c));
      const dRSI = calcRSI(dailyCloses);
      const dATR = calcATR(daily);
      const dLen = dailyCloses.length;
      const dMom7 = dLen >= 7 ? (dailyCloses[dLen - 1] - dailyCloses[dLen - 7]) / dailyCloses[dLen - 7] : 0;
      const dMom30 = dLen >= 30 ? (dailyCloses[dLen - 1] - dailyCloses[dLen - 30]) / dailyCloses[dLen - 30] : 0;
      const dSwing = findSwing(dailyCloses, 60);
      const dSMA50 = sma(dailyCloses, 50);
      const dEMA20 = ema(dailyCloses, 20);
      const dEMA50 = ema(dailyCloses, 50);

      // ── 4h candles ──
      const h4 = await post({ type: 'candleSnapshot', req: { coin: c.name, interval: '4h', startTime: now - 7 * 86400000, endTime: now } });
      if (h4.length < 10) continue;
      const h4Closes = h4.map(x => parseFloat(x.c));
      const h4RSI = calcRSI(h4Closes);
      const h4ATR = calcATR(h4);
      const h4Mom = (h4Closes[h4Closes.length - 1] - h4Closes[0]) / h4Closes[0];
      const h4Swing = findSwing(h4Closes, 42);

      // ── 1h candles ──
      const h1 = await post({ type: 'candleSnapshot', req: { coin: c.name, interval: '1h', startTime: now - 2 * 86400000, endTime: now } });
      const h1Closes = h1.length > 10 ? h1.map(x => parseFloat(x.c)) : h4Closes;
      const h1RSI = calcRSI(h1Closes);

      // ── Scoring ──
      let score = 0;
      const signals = [];

      // 1. Daily RSI
      if (dRSI < 30) { score += 3; signals.push(`D-RSI ${dRSI.toFixed(1)} oversold +3`); }
      else if (dRSI < 40) { score += 1; signals.push(`D-RSI ${dRSI.toFixed(1)} low +1`); }
      else if (dRSI > 70) { score -= 3; signals.push(`D-RSI ${dRSI.toFixed(1)} overbought -3`); }
      else if (dRSI > 60) { score -= 1; signals.push(`D-RSI ${dRSI.toFixed(1)} high -1`); }

      // 2. Daily trend (SMA50 + EMA + momentum)
      if (dSMA50 && c.price > dSMA50) { score += 1; signals.push('Above SMA50 +1'); }
      if (dSMA50 && c.price < dSMA50) { score -= 1; signals.push('Below SMA50 -1'); }
      if (dEMA20 && dEMA50) {
        if (dEMA20 > dEMA50) { score += 1; signals.push('EMA20>EMA50 +1'); }
        if (dEMA20 < dEMA50) { score -= 1; signals.push('EMA20<EMA50 -1'); }
      }
      if (dMom30 > 0.15) { score += 1; signals.push(`Mom30d +${(dMom30*100).toFixed(1)}% +1`); }
      if (dMom30 < -0.15) { score -= 1; signals.push(`Mom30d ${(dMom30*100).toFixed(1)}% -1`); }

      // 3. 4h RSI confirmation
      if (h4RSI < 30) { score += 2; signals.push(`4h-RSI ${h4RSI.toFixed(1)} oversold +2`); }
      else if (h4RSI < 40) { score += 1; signals.push(`4h-RSI ${h4RSI.toFixed(1)} low +1`); }
      else if (h4RSI > 70) { score -= 2; signals.push(`4h-RSI ${h4RSI.toFixed(1)} overbought -2`); }
      else if (h4RSI > 60) { score -= 1; signals.push(`4h-RSI ${h4RSI.toFixed(1)} high -1`); }

      // 4. Funding rate
      const fundScore = -c.funding * 10000;
      if (fundScore > 5) { score += 3; signals.push(`Funding very neg +3`); }
      else if (fundScore > 1) { score += 2; signals.push(`Funding neg +2`); }
      else if (fundScore > 0) { score += 1; signals.push(`Funding sl neg +1`); }
      else if (fundScore < -5) { score -= 3; signals.push(`Funding very pos -3`); }
      else if (fundScore < -1) { score -= 2; signals.push(`Funding pos -2`); }
      else if (fundScore < 0) { score -= 1; signals.push(`Funding sl pos -1`); }

      // 5. Overextension
      if (dMom7 > 0.15) { score -= 1; signals.push(`7d overextended up -1`); }
      if (dMom7 < -0.15) { score += 1; signals.push(`7d overextended down +1`); }

      // 6. Volume confirmation
      const volRecent = h4.slice(-4).reduce((a, x) => a + parseFloat(x.v || 0), 0);
      const volOlder = h4.slice(-12, -4).reduce((a, x) => a + parseFloat(x.v || 0), 0) / 2;
      if (volRecent > volOlder * 1.3 && score !== 0) {
        const vDir = Math.sign(score);
        score += vDir;
        signals.push(`Vol confirms ${vDir > 0 ? 'long' : 'short'} +${vDir}`);
      }

      // 7. BTC dominance
      if (btcDom && btcDom > 58 && c.name !== 'BTC') { score -= 1; signals.push('BTC dom >58% -1'); }
      if (btcDom && btcDom < 45 && c.name !== 'BTC') { score += 1; signals.push('BTC dom <45% +1'); }

      // 8. Macro bias
      score += macroBias;
      if (macroBias !== 0) signals.push(`Macro bias ${macroBias > 0 ? '+' : ''}${macroBias}`);

      // ── Direction decision with granular regime ──
      let direction = 'SKIP';
      let isConditional = false;
      let sizeMult = 1.0; // size multiplier

      if (btcRegime.action === 'SIT_OUT') {
        // Granular: allow conditional trades in SIT_OUT
        const minScoreConditional = 4; // lowered from 5
        if (macroBias === -2 && score <= -minScoreConditional) {
          direction = 'SHORT';
          isConditional = true;
          sizeMult = 0.5;
        } else if (macroBias === 2 && score >= minScoreConditional) {
          direction = 'LONG';
          isConditional = true;
          sizeMult = 0.5;
        }
      } else {
        const minScore = 2;
        if (score >= minScore) direction = 'LONG';
        else if (score <= -minScore) direction = 'SHORT';
      }

      // Fibonacci on 4h
      let fib = null;
      if (h4Swing) fib = calcFibLevels(h4Swing.swingLow, h4Swing.swingHigh, h4Swing.isUptrend);

      // ── Level proximity & rejection detection ──
      const allLevels = [];
      if (fib) {
        allLevels.push(
          { px: fib.ret_236, label: 'fib_236' },
          { px: fib.ret_382, label: 'fib_382' },
          { px: fib.ret_500, label: 'fib_500' },
          { px: fib.ret_618, label: 'fib_618' },
        );
      }
      if (h4Swing) {
        allLevels.push(
          { px: h4Swing.swingLow, label: 'h4_swing_low' },
          { px: h4Swing.swingHigh, label: 'h4_swing_high' },
        );
      }
      if (dSwing) {
        allLevels.push(
          { px: dSwing.swingLow, label: 'd_swing_low' },
          { px: dSwing.swingHigh, label: 'd_swing_high' },
        );
      }

      // Find nearest level to current price
      let nearestLevel = null;
      let priceToLevelPct = Infinity;
      for (const lvl of allLevels) {
        if (lvl.px <= 0) continue;
        const dist = Math.abs(c.price - lvl.px) / c.price * 100;
        if (dist < priceToLevelPct) {
          priceToLevelPct = dist;
          nearestLevel = lvl;
        }
      }
      if (!nearestLevel) priceToLevelPct = 99;

      // Rejection detection using 1h OHLC (last 3 candles)
      // LONG rejection: 1h low touched support level, current close bounced above it
      // SHORT rejection: 1h high touched resistance level, current close rejected below it
      let rejection = false;
      let rejectionType = null;
      // Dynamic tolerance: max(0.5%, ATR_1h_pct * 0.25) — wider for volatile tokens
      const h1ATR = h1.length > 14 ? calcATR(h1) : h4ATR / 2;
      const h1AtrPct = h1ATR / c.price * 100;
      const rejectionTolerance = Math.max(0.5, h1AtrPct * 0.25);

      if (h1.length >= 3 && nearestLevel) {
        const recent1h = h1.slice(-3);
        const currentClose = parseFloat(h1[h1.length - 1].c);
        const levelPx = nearestLevel.px;
        const tolerance = c.price * rejectionTolerance / 100;

        for (const candle of recent1h) {
          const low = parseFloat(candle.l);
          const high = parseFloat(candle.h);

          // Long rejection: low wicked into level, close bounced above
          if (low <= levelPx + tolerance && low >= levelPx - tolerance && currentClose > levelPx) {
            rejection = true;
            rejectionType = 'LONG';
            break;
          }
          // Short rejection: high wicked into level, close rejected below
          if (high >= levelPx - tolerance && high <= levelPx + tolerance && currentClose < levelPx) {
            rejection = true;
            rejectionType = 'SHORT';
            break;
          }
        }
      }

      // Kelly sizing
      const winRate = btcRegime.regime.includes('TRENDING') ? 0.55 : 0.50;
      const kelly = kellyFraction(winRate, 2.0);
      const regimeKelly = btcRegime.kelly || 0.1;
      const effectiveKelly = Math.min(kelly, regimeKelly);
      const atrPct = dATR / c.price;
      const atrMult = btcRegime.atrMult || 2.5;
      const riskPerUnit = atrMult * atrPct;
      let posSize = riskPerUnit > 0 ? (effectiveKelly * freeBalance) / riskPerUnit : 0;
      posSize = Math.min(posSize, freeBalance * maxCapPct); // adjusted cap based on open positions
      posSize *= sizeMult; // conditional trade multiplier
      if (btcRegime.action === 'SIT_OUT' && !isConditional) posSize = 0;

      // Sector info (no blocking — disabled by Fede 4-Mar-2026)
      const sector = SECTOR_MAP[c.name] || 'Other';
      let sectorBlocked = false;

      scored.push({
        ...c, dRSI: dRSI.toFixed(1), h4RSI: h4RSI.toFixed(1), h1RSI: h1RSI.toFixed(1),
        dMom7: (dMom7 * 100).toFixed(2), dMom30: (dMom30 * 100).toFixed(2),
        h4Mom: (h4Mom * 100).toFixed(2),
        fundScore: fundScore.toFixed(2), score, signals, direction,
        kelly: effectiveKelly.toFixed(3), suggestedSizeUSD: posSize.toFixed(2),
        fib, dSwing, h4Swing, dATR, h4ATR,
        isConditional, sectorBlocked, sector,
        dEMA20, dEMA50,
        // v2.3 entry gate fields
        priceToLevelPct: priceToLevelPct.toFixed(2),
        nearestLevel: nearestLevel ? nearestLevel.label : 'none',
        nearestLevelPx: nearestLevel ? nearestLevel.px : null,
        rejection, rejectionType,
        rejectionTolerance: rejectionTolerance.toFixed(2),
        allLevels: allLevels.filter(l => l.px > 0).map(l => ({ label: l.label, px: +l.px.toPrecision(6) })),
      });
    } catch (e) { console.error(`⚠️ Skipped ${c.name}: ${e.message}`); }
  }

  scored.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  console.log(`Analyzed ${scored.length} tokens\n`);

  // Top 15 overview
  console.log('TOP 15 BY SCORE:');
  scored.slice(0, 15).forEach((s, i) => {
    const cond = s.isConditional ? ' [COND]' : '';
    const sect = s.sectorBlocked ? ' [SECTOR-BLOCKED]' : '';
    const lvl = s.nearestLevel !== 'none' ? ` Lvl:${s.nearestLevel}@${s.priceToLevelPct}%` : '';
    const rej = s.rejection ? ` REJ:${s.rejectionType}✅` : '';
    const gate = parseFloat(s.priceToLevelPct) <= parseFloat(s.rejectionTolerance) && s.rejection ? ' [GATE✅]' : '';
    console.log(`${String(i + 1).padStart(2)}. ${s.name.padEnd(10)} Score:${String(s.score).padStart(4)} | $${s.price} | D-RSI:${s.dRSI} 4h-RSI:${s.h4RSI} | Fund:${s.fundScore} | ${s.direction}${cond}${sect}${lvl}${rej}${gate} [${s.sector}]`);
  });

  // Actionable trades
  const longs = scored.filter(s => s.direction === 'LONG');
  const shorts = scored.filter(s => s.direction === 'SHORT');

  if (longs.length > 0) {
    console.log(`\n=== LONG OPPORTUNITIES ===`);
    longs.slice(0, 5).forEach(s => {
      const sz = (parseFloat(s.suggestedSizeUSD) / s.price).toFixed(s.szDecimals);
      const condLabel = s.isConditional ? ' ⚡ CONDITIONAL (50% size)' : '';
      const gatePass = parseFloat(s.priceToLevelPct) <= parseFloat(s.rejectionTolerance) && s.rejection;
      const gateLabel = gatePass ? ' [ENTRY GATE ✅]' : ` [GATE ❌ lvl:${s.priceToLevelPct}%/${s.rejectionTolerance}% rej:${s.rejection}]`;
      let fibInfo = '';
      if (s.h4Swing) {
        const d = s.h4Swing.swingHigh - s.h4Swing.swingLow;
        const tp4 = (s.h4Swing.swingHigh + d * 1.618).toPrecision(5);
        const sl = (s.price * 0.92).toPrecision(5);
        const sup618 = (s.h4Swing.swingHigh - d * 0.618).toPrecision(5);
        fibInfo = `TP4(4h): $${tp4} | SL(-8%): $${sl} | Fib0.618: $${sup618}`;
      } else {
        fibInfo = `TP(+15%): $${(s.price * 1.15).toPrecision(5)}`;
      }
      let emaInfo = '';
      if (s.dEMA20 && s.dEMA50) {
        emaInfo = `\n  EMA20: $${s.dEMA20.toPrecision(5)} | EMA50: $${s.dEMA50.toPrecision(5)} ${s.dEMA20 > s.dEMA50 ? '✅' : '⚠️'}`;
      }
      const levelInfo = s.nearestLevel !== 'none' ? `\n  Level: ${s.nearestLevel} @ $${s.nearestLevelPx ? s.nearestLevelPx.toPrecision(5) : '?'} (dist: ${s.priceToLevelPct}%, tol: ${s.rejectionTolerance}%)` : '';
      console.log(`\n${s.name}: LONG ${sz} @ $${s.price} | Size: $${s.suggestedSizeUSD} | Score: ${s.score} [${s.sector}]${condLabel}${gateLabel}`);
      console.log(`  ${fibInfo}${emaInfo}${levelInfo}`);
      console.log(`  Signals: ${s.signals.join(' | ')}`);
    });
  }

  if (shorts.length > 0) {
    console.log(`\n=== SHORT OPPORTUNITIES ===`);
    shorts.slice(0, 5).forEach(s => {
      const sz = (parseFloat(s.suggestedSizeUSD) / s.price).toFixed(s.szDecimals);
      const condLabel = s.isConditional ? ' ⚡ CONDITIONAL (50% size)' : '';
      const gatePass = parseFloat(s.priceToLevelPct) <= parseFloat(s.rejectionTolerance) && s.rejection;
      const gateLabel = gatePass ? ' [ENTRY GATE ✅]' : ` [GATE ❌ lvl:${s.priceToLevelPct}%/${s.rejectionTolerance}% rej:${s.rejection}]`;
      let fibInfo = '';
      if (s.h4Swing) {
        const d = s.h4Swing.swingHigh - s.h4Swing.swingLow;
        const tp4 = (s.h4Swing.swingLow - d * 1.618).toPrecision(5);
        const tpFallback = tp4 > 0 ? tp4 : (s.price * 0.85).toPrecision(5);
        const sl = (s.price * 1.08).toPrecision(5);
        const res618 = (s.h4Swing.swingLow + d * 0.618).toPrecision(5);
        fibInfo = `TP4(4h): $${tpFallback} | SL(+8%): $${sl} | Res(0.618): $${res618}`;
      } else {
        fibInfo = `TP(-15%): $${(s.price * 0.85).toPrecision(5)} | SL(+8%): $${(s.price * 1.08).toPrecision(5)}`;
      }
      let emaInfo = '';
      if (s.dEMA20 && s.dEMA50) {
        emaInfo = `\n  EMA20: $${s.dEMA20.toPrecision(5)} | EMA50: $${s.dEMA50.toPrecision(5)} ${s.dEMA20 < s.dEMA50 ? '✅' : '⚠️'}`;
      }
      const levelInfo = s.nearestLevel !== 'none' ? `\n  Level: ${s.nearestLevel} @ $${s.nearestLevelPx ? s.nearestLevelPx.toPrecision(5) : '?'} (dist: ${s.priceToLevelPct}%, tol: ${s.rejectionTolerance}%)` : '';
      console.log(`\n${s.name}: SHORT ${sz} @ $${s.price} | Size: $${s.suggestedSizeUSD} | Score: ${s.score} [${s.sector}]${condLabel}${gateLabel}`);
      console.log(`  ${fibInfo}${emaInfo}${levelInfo}`);
      console.log(`  Signals: ${s.signals.join(' | ')}`);
    });
  }

  // Sector blocking removed (Fede 4-Mar-2026)

  if (longs.length === 0 && shorts.length === 0) {
    console.log('\nNo high-confidence trades found.');
    if (btcRegime.action === 'SIT_OUT') {
      console.log('(SIT_OUT regime — only CONDITIONAL trades with macro bias ±2 and score ±4 qualify)');
    }
  }

  // ━━━ 6. SUMMARY ━━━
  console.log('\n' + '='.repeat(60));
  console.log('=== SUMMARY ===');
  console.log('='.repeat(60));
  console.log(`Regime: ${btcRegime.regime} (DAILY-based)`);
  console.log(`Vol Percentile: ${dailyVolPct.toFixed(0)}th — ${dailyVolPct < 20 ? 'LOW (breakout watch)' : dailyVolPct < 60 ? 'NORMAL' : dailyVolPct < 80 ? 'ELEVATED' : 'EXTREME'}`);
  console.log(`Macro Bias: ${macroBias > 0 ? '+' : ''}${macroBias}`);
  console.log(`BTC Dominance: ${btcDom ? btcDom.toFixed(2) + '%' : 'N/A'}`);
  console.log(`Kelly: ${btcRegime.kelly} | ATR mult: ${btcRegime.atrMult}`);
  console.log(`Open Positions: ${numOpen} | Max cap/trade: ${(maxCapPct * 100).toFixed(0)}%`);
  console.log(`Occupied Sectors: ${[...occupiedSectors.entries()].map(([s, p]) => `${s}(${p.coin})`).join(', ') || 'none'}`);
  console.log(`Actionable: ${longs.length} longs, ${shorts.length} shorts`);
  if (!btcHealthy) console.log('⚠️ BTC health warnings active — extra caution');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
