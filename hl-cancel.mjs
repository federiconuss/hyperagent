#!/usr/bin/env node
/**
 * Cancel order on Hyperliquid
 * Usage: node hl-cancel.mjs <coin> <oid>
 */
import { ethers } from 'ethers';
import { encode } from '@msgpack/msgpack';
import https from 'https';

if (!process.env.HL_PRIVATE_KEY) {
  console.error('Missing env var. Set HL_PRIVATE_KEY (see .env.example)');
  process.exit(1);
}

const PRIVATE_KEY = process.env.HL_PRIVATE_KEY;
const IS_MAINNET = true;

async function getAssetIndex(coin) {
  const data = await postInfo({ type: 'meta' });
  const idx = data.universe.findIndex(u => u.name === coin);
  if (idx === -1) throw new Error(`Asset ${coin} not found. Use exact Hyperliquid name (e.g. BTC, ETH, SOL)`);
  return idx;
}

const HTTP_TIMEOUT = 15000;

function postInfo(body) {
  return new Promise((resolve, reject) => {
    const p = JSON.stringify(body);
    const req = https.request({ hostname: 'api.hyperliquid.xyz', port: 443, path: '/info', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
    req.setTimeout(HTTP_TIMEOUT, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject); req.write(p); req.end();
  });
}

function postExchange(body) {
  return new Promise((resolve, reject) => {
    const p = JSON.stringify(body);
    const req = https.request({ hostname: 'api.hyperliquid.xyz', port: 443, path: '/exchange', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(new Error(d))} }); });
    req.setTimeout(HTTP_TIMEOUT, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject); req.write(p); req.end();
  });
}

function actionHash(action, vaultAddress, nonce) {
  const packed = encode(action);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64BE(BigInt(nonce));
  const combined = Buffer.concat([Buffer.from(packed), nonceBuf, Buffer.from([0x00])]);
  return ethers.keccak256(combined);
}

async function signL1Action(wallet, action, nonce) {
  const hash = actionHash(action, null, nonce);
  const phantomAgent = { source: IS_MAINNET ? 'a' : 'b', connectionId: hash };
  const domain = { chainId: 1337, name: 'Exchange', verifyingContract: '0x0000000000000000000000000000000000000000', version: '1' };
  const types = { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] };
  const sig = await wallet.signTypedData(domain, types, phantomAgent);
  return { r: '0x' + sig.slice(2, 66), s: '0x' + sig.slice(66, 130), v: parseInt(sig.slice(130, 132), 16) };
}

async function main() {
  const coin = process.argv[2] || 'BTC';
  const oid = parseInt(process.argv[3]);
  if (!oid) { console.error('Usage: node hl-cancel.mjs <coin> <oid>'); process.exit(1); }
  
  const assetIndex = await getAssetIndex(coin);
  const wallet = new ethers.Wallet(PRIVATE_KEY);
  const action = { type: 'cancel', cancels: [{ a: assetIndex, o: oid }] };
  const nonce = Date.now();
  const signature = await signL1Action(wallet, action, nonce);
  
  console.log(`🗑️ Cancelling oid=${oid} for ${coin}...`);
  const response = await postExchange({ action, nonce, signature, vaultAddress: null });
  console.log(JSON.stringify(response, null, 2));
  
  if (response.status === 'ok') console.log('✅ Cancelled');
  else console.log('❌ Failed');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
