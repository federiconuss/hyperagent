#!/usr/bin/env node
/**
 * Hyperliquid order placement with correct EIP-712 signing
 * Based on hyperliquid-python-sdk signing.py
 * 
 * Usage: node hl-trade.mjs <asset_index> <isBuy> <limitPx> <sz> [reduceOnly]
 * Example: node hl-trade.mjs 0 true 60000 0.001   (BTC long)
 * 
 * Set env: HL_PRIVATE_KEY, HL_ACCOUNT
 */

import { ethers } from 'ethers';
import { encode } from '@msgpack/msgpack';
import https from 'https';

if (!process.env.HL_PRIVATE_KEY || !process.env.HL_ACCOUNT) {
  console.error('Missing env vars. Set HL_PRIVATE_KEY and HL_ACCOUNT (see .env.example)');
  process.exit(1);
}

const PRIVATE_KEY = process.env.HL_PRIVATE_KEY;
const ACCOUNT = process.env.HL_ACCOUNT;
const IS_MAINNET = true;

// --- Asset name to index mapping (fetch from API) ---
async function getAssetIndex(coin) {
  const data = await postInfo({ type: 'meta' });
  const idx = data.universe.findIndex(u => u.name === coin);
  if (idx === -1) throw new Error(`Asset ${coin} not found. Available: ${data.universe.map(u=>u.name).join(', ')}`);
  return idx;
}

// --- Info API ---
const HTTP_TIMEOUT = 15000;

function postInfo(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.hyperliquid.xyz', port: 443, path: '/info', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.setTimeout(HTTP_TIMEOUT, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject); req.write(payload); req.end();
  });
}

// --- Exchange API ---
function postExchange(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.hyperliquid.xyz', port: 443, path: '/exchange', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d)); } });
    });
    req.setTimeout(HTTP_TIMEOUT, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject); req.write(payload); req.end();
  });
}

// --- Signing (matches Python SDK exactly) ---
function actionHash(action, vaultAddress, nonce) {
  // msgpack encode the action
  const packed = encode(action);
  // nonce as 8 bytes big-endian
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64BE(BigInt(nonce));
  // no vault
  const vaultByte = Buffer.from([0x00]);
  
  const combined = Buffer.concat([Buffer.from(packed), nonceBuf, vaultByte]);
  return ethers.keccak256(combined);
}

function constructPhantomAgent(hash, isMainnet) {
  return { source: isMainnet ? 'a' : 'b', connectionId: hash };
}

async function signL1Action(wallet, action, nonce) {
  const hash = actionHash(action, null, nonce);
  const phantomAgent = constructPhantomAgent(hash, IS_MAINNET);
  
  const domain = {
    chainId: 1337,
    name: 'Exchange',
    verifyingContract: '0x0000000000000000000000000000000000000000',
    version: '1',
  };
  
  const types = {
    Agent: [
      { name: 'source', type: 'string' },
      { name: 'connectionId', type: 'bytes32' },
    ],
  };
  
  const signature = await wallet.signTypedData(domain, types, phantomAgent);
  return { r: '0x' + signature.slice(2, 66), s: '0x' + signature.slice(66, 130), v: parseInt(signature.slice(130, 132), 16) };
}

// --- Float formatting (matches SDK) ---
function floatToWire(x) {
  const rounded = parseFloat(x.toPrecision(5));
  if (Math.abs(rounded - x) >= 1e-12 * Math.abs(x)) {
    throw new Error(`floatToWire: ${x} rounds to ${rounded}`);
  }
  return rounded.toString();
}

// --- Main ---
async function main() {
  const coinOrIndex = process.argv[2] || 'BTC';
  const isBuy = (process.argv[3] || 'true') === 'true';
  const limitPx = parseFloat(process.argv[4]);
  const sz = parseFloat(process.argv[5]);
  const reduceOnly = (process.argv[6] || 'false') === 'true';
  
  if (!limitPx || !sz) {
    console.error('Usage: node hl-trade.mjs <coin> <isBuy> <limitPx> <sz> [reduceOnly]');
    console.error('Example: node hl-trade.mjs BTC true 60000 0.001');
    process.exit(1);
  }
  
  // Resolve asset index
  let assetIndex;
  if (/^\d+$/.test(coinOrIndex)) {
    assetIndex = parseInt(coinOrIndex);
  } else {
    console.log(`Resolving asset index for ${coinOrIndex}...`);
    assetIndex = await getAssetIndex(coinOrIndex);
    console.log(`${coinOrIndex} = asset index ${assetIndex}`);
  }
  
  const wallet = new ethers.Wallet(PRIVATE_KEY);
  console.log(`\n📝 ORDER:`);
  console.log(`   Coin:     ${coinOrIndex} (index ${assetIndex})`);
  console.log(`   Side:     ${isBuy ? 'LONG' : 'SHORT'}`);
  console.log(`   Price:    $${limitPx}`);
  console.log(`   Size:     ${sz}`);
  console.log(`   Reduce:   ${reduceOnly}`);
  console.log(`   Signer:   ${wallet.address}`);
  console.log(`   Account:  ${ACCOUNT}\n`);
  
  // Check for trigger (stop) order: --trigger <triggerPx> --tpsl <tp|sl>
  const triggerIdx = process.argv.indexOf('--trigger');
  const tpslIdx = process.argv.indexOf('--tpsl');
  const triggerPx = triggerIdx > 0 ? parseFloat(process.argv[triggerIdx + 1]) : null;
  const tpsl = tpslIdx > 0 ? process.argv[tpslIdx + 1] : 'sl'; // 'tp' or 'sl'

  let orderType;
  if (triggerPx) {
    const isMarket = true; // trigger orders execute at market
    // Key order MUST match Python SDK: isMarket, triggerPx, tpsl
    orderType = {
      trigger: {
        isMarket,
        triggerPx: floatToWire(triggerPx),
        tpsl,
      }
    };
    console.log(`   Trigger:  $${triggerPx} (${tpsl})`);
  } else {
    const isIoc = process.argv.includes('--ioc');
    orderType = { limit: { tif: isIoc ? 'Ioc' : 'Gtc' } };
    if (isIoc) console.log(`   Mode:     IoC (market/immediate)`);
  }

  // Set isolated margin mode before placing order (Fede 4-Mar-2026)
  const levIdx = process.argv.indexOf('--leverage');
  const leverageVal = levIdx !== -1 ? (parseInt(process.argv[levIdx + 1]) || 1) : 1;
  const setIsolated = !process.argv.includes('--cross');
  {
    const levAction = {
      type: 'updateLeverage',
      asset: assetIndex,
      isCross: !setIsolated,
      leverage: leverageVal,
    };
    const levNonce = Date.now();
    console.log(`🔧 Setting ${setIsolated ? 'ISOLATED' : 'CROSS'} margin, leverage ${leverageVal}x...`);
    const levSig = await signL1Action(wallet, levAction, levNonce);
    const levResp = await postExchange({ action: levAction, nonce: levNonce, signature: levSig, vaultAddress: null });
    if (levResp.status === 'ok') {
      console.log(`   ✅ Margin mode set\n`);
    } else {
      console.log(`   ⚠️ Margin update: ${JSON.stringify(levResp)}\n`);
    }
  }

  const orderWire = {
    a: assetIndex,
    b: isBuy,
    p: floatToWire(limitPx),
    s: floatToWire(sz),
    r: reduceOnly,
    t: orderType,
  };
  
  const action = {
    type: 'order',
    orders: [orderWire],
    grouping: 'na',
  };
  
  const nonce = Date.now() + 1; // +1 to avoid collision with leverage nonce
  console.log('✍️  Signing with EIP-712...');
  const signature = await signL1Action(wallet, action, nonce);
  console.log(`   Signature v=${signature.v}`);
  
  const payload = {
    action,
    nonce,
    signature,
    vaultAddress: null,
  };
  
  console.log('\n📤 Sending to /exchange...');
  const response = await postExchange(payload);
  
  console.log('\n📥 RESPONSE:');
  console.log(JSON.stringify(response, null, 2));
  
  if (response.status === 'ok') {
    const statuses = response.response?.data?.statuses;
    if (statuses) {
      for (const s of statuses) {
        if (s.resting) console.log(`\n✅ ORDER RESTING: oid=${s.resting.oid}`);
        if (s.filled) console.log(`\n✅ ORDER FILLED: oid=${s.filled.oid} avgPx=${s.filled.avgPx}`);
        if (s.error) console.log(`\n❌ ORDER ERROR: ${s.error}`);
      }
    }
  } else {
    console.log(`\n❌ ERROR: ${response.status || JSON.stringify(response)}`);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
