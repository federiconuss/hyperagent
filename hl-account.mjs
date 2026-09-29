#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createClient } from './lib/hyperliquid.mjs';
import { getAccountSnapshot } from './lib/account.mjs';

export const HELP = `Usage: node hl-account.mjs [--user 0x...] [--dex NAME]

Read account mode, balances, selected perp DEX positions and open orders as JSON.
--user defaults to HL_VAULT_ADDRESS, then HL_ACCOUNT; use the account, not an API wallet.
--dex defaults to the native perp DEX. Native/spot orders are included with a named DEX.
HL_NETWORK selects mainnet (default) or testnet. No private key is needed.
Account mode is read only; this command never changes it.
`;

export async function main(args = process.argv.slice(2), { env = process.env, client, stdout = console.log } = {}) {
  const { values } = parseArgs({ args, options: {
    user: { type: 'string' }, dex: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  }, strict: true, allowPositionals: false });
  if (values.help) { stdout(HELP); return; }
  const result = await getAccountSnapshot(client ?? createClient({ network: env.HL_NETWORK || 'mainnet' }), {
    user: values.user ?? (env.HL_VAULT_ADDRESS || env.HL_ACCOUNT),
    dex: values.dex ?? '',
  });
  stdout(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
}
