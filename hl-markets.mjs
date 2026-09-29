#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createClient } from './lib/hyperliquid.mjs';

export const HELP = `Usage: node hl-markets.mjs [--market perp|spot] [--dex NAME]

Read market metadata and asset contexts as JSON, without rankings or trade signals.
--market defaults to perp. --dex selects a perp DEX and is invalid for spot.
Spot metadata includes pair indices and token IDs; names are HyperCore names.
HL_NETWORK selects mainnet (default) or testnet. No private key is needed.
`;

export async function main(args = process.argv.slice(2), { env = process.env, client, stdout = console.log } = {}) {
  const { values } = parseArgs({ args, options: {
    market: { type: 'string', default: 'perp' }, dex: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  }, strict: true, allowPositionals: false });
  if (values.help) { stdout(HELP); return; }
  if (!['spot', 'perp'].includes(values.market)) throw new Error('--market must be perp or spot.');
  if (values.market === 'spot' && values.dex !== undefined) throw new Error('--dex applies only to perp markets.');
  const api = client ?? createClient({ network: env.HL_NETWORK || 'mainnet' });
  const body = values.market === 'spot'
    ? { type: 'spotMetaAndAssetCtxs' }
    : { type: 'metaAndAssetCtxs', dex: values.dex ?? '' };
  const data = await api.info(body);
  if (!Array.isArray(data) || data.length !== 2 || !data[0] || !Array.isArray(data[0].universe) || !Array.isArray(data[1])) {
    throw new Error(`Malformed ${body.type} response.`);
  }
  const result = {
    network: api.network,
    market: values.market,
    ...(values.market === 'perp' ? { dex: values.dex ?? '' } : {}),
    metadata: data[0],
    contexts: data[1],
  };
  stdout(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
}
