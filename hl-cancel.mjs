#!/usr/bin/env node
import { clientFromEnv, createClient, assertExchangeSuccess } from './lib/hyperliquid.mjs';
import { resolveMarket } from './lib/markets.mjs';
import { parseCli, runCli } from './lib/execution-cli.mjs';

const usage = 'node hl-cancel.mjs <coin> <oid> [--market perp|spot] [--dex name] [--dry-run]';

export async function main(args, { client, env = process.env } = {}) {
  const { values, positionals } = parseCli(args, {
    market: { type: 'string', default: 'perp' }, dex: { type: 'string', default: '' },
    'dry-run': { type: 'boolean' }, help: { type: 'boolean' },
  });
  if (values.help) return { usage };
  if (positionals.length !== 2) throw new Error(usage);
  const [coin, id] = positionals;
  const oid = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(oid) || oid < 1) throw new Error('Order ID must be a positive safe integer');
  client ??= values['dry-run']
    ? createClient({ network: env.HL_NETWORK || 'mainnet', vaultAddress: env.HL_VAULT_ADDRESS || undefined })
    : clientFromEnv(env);
  const market = await resolveMarket(client, coin, { market: values.market, dex: values.dex });
  const action = { type: 'cancel', cancels: [{ a: market.asset, o: oid }] };
  if (values['dry-run']) return { dryRun: true, network: client.network, vaultAddress: client.vaultAddress ?? null, market, action };
  return { network: client.network, vaultAddress: client.vaultAddress ?? null, market, response: assertExchangeSuccess(await client.exchange(action)) };
}

runCli(import.meta.url, main);
