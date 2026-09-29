#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createClient } from './lib/hyperliquid.mjs';

export const HELP = `Usage: node hl-info.mjs '<JSON request body>'

Send one read-only request to Hyperliquid /info and print its JSON response.
Example: node hl-info.mjs '{"type":"allMids"}'
Example: node hl-info.mjs '{"type":"userAbstraction","user":"0x..."}'
HL_NETWORK selects mainnet (default) or testnet. No signing or exchange actions.
`;

export function parseInfoRequest(args) {
  if (args.length !== 1) throw new Error('Expected one JSON request body. Use --help for usage.');
  let body;
  try { body = JSON.parse(args[0]); } catch { throw new Error('The request body must be valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.type !== 'string' || !body.type.trim()) {
    throw new Error('The /info request must be a JSON object with a nonempty string type.');
  }
  return body;
}

export async function main(args = process.argv.slice(2), { env = process.env, client, stdout = console.log } = {}) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { stdout(HELP); return; }
  const body = parseInfoRequest(args);
  const result = await (client ?? createClient({ network: env.HL_NETWORK || 'mainnet' })).info(body);
  stdout(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
}
