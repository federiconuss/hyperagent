#!/usr/bin/env node
/**
 * Hyperliquid Orderbook Depth — Slippage Estimator
 * 
 * Usage: node hl-orderbook.mjs <COIN> [sizeUSD]
 * 
 * Output:
 *   mid, spread, depth at 1% from mid (bid/ask sides),
 *   suggested slippage category (thick/normal/thin)
 */

import https from 'https';

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
    req.on('error', reject); req.write(p); req.end();
  });
}

async function main() {
  const coin = process.argv[2];
  const sizeUSD = parseFloat(process.argv[3] || '0');

  if (!coin) {
    console.error('Usage: node hl-orderbook.mjs <COIN> [sizeUSD]');
    process.exit(1);
  }

  const book = await post({ type: 'l2Book', coin: coin.toUpperCase() });

  if (!book || !book.levels || book.levels.length < 2) {
    console.error(`No orderbook data for ${coin}`);
    process.exit(1);
  }

  const bids = book.levels[0]; // [[px, sz, nOrders], ...]
  const asks = book.levels[1];

  if (bids.length === 0 || asks.length === 0) {
    console.error(`Empty orderbook for ${coin}`);
    process.exit(1);
  }

  const bestBid = parseFloat(bids[0].px);
  const bestAsk = parseFloat(asks[0].px);
  const mid = (bestBid + bestAsk) / 2;
  const spread = (bestAsk - bestBid) / mid * 100;

  // Depth at 1% from mid
  const bid1pct = mid * 0.99;
  const ask1pct = mid * 1.01;

  let bidDepthUSD = 0;
  for (const lvl of bids) {
    const px = parseFloat(lvl.px);
    const sz = parseFloat(lvl.sz);
    if (px >= bid1pct) {
      bidDepthUSD += px * sz;
    }
  }

  let askDepthUSD = 0;
  for (const lvl of asks) {
    const px = parseFloat(lvl.px);
    const sz = parseFloat(lvl.sz);
    if (px <= ask1pct) {
      askDepthUSD += px * sz;
    }
  }

  const depth1pct = Math.min(bidDepthUSD, askDepthUSD);

  // Slippage category
  let slippageCategory, slippagePct;
  if (depth1pct > 500000) {
    slippageCategory = 'thick';
    slippagePct = 0.15;
  } else if (depth1pct > 50000) {
    slippageCategory = 'normal';
    slippagePct = 0.50;
  } else {
    slippageCategory = 'thin';
    slippagePct = 1.50;
  }

  // If sizeUSD provided, estimate actual slippage
  let estSlippage = slippagePct;
  if (sizeUSD > 0 && depth1pct > 0) {
    // If order is > depth, slippage increases proportionally
    const fillRatio = sizeUSD / depth1pct;
    if (fillRatio > 1) {
      estSlippage = Math.min(2.0, slippagePct * fillRatio);
    }
  }
  estSlippage = Math.max(0.1, Math.min(2.0, estSlippage));

  console.log(`=== ORDERBOOK: ${coin.toUpperCase()} ===`);
  console.log(`Mid: $${mid.toPrecision(6)} | Spread: ${spread.toFixed(4)}%`);
  console.log(`Best Bid: $${bestBid} | Best Ask: $${bestAsk}`);
  console.log(`Depth ±1%: Bid $${bidDepthUSD.toFixed(0)} | Ask $${askDepthUSD.toFixed(0)} | Min $${depth1pct.toFixed(0)}`);
  console.log(`Category: ${slippageCategory} | Base Slip: ${slippagePct}%`);
  if (sizeUSD > 0) {
    console.log(`Order Size: $${sizeUSD.toFixed(2)} | Est Slip: ${estSlippage.toFixed(2)}%`);
    console.log(`Entry adj: mark * ${estSlippage.toFixed(2)}%`);
  }
  console.log(`\nslippage_pct=${estSlippage.toFixed(2)}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
