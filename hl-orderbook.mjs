#!/usr/bin/env node
import { createClient } from './lib/hyperliquid.mjs';
import { resolveMarket } from './lib/markets.mjs';
import { parseCli, runCli } from './lib/execution-cli.mjs';

const usage = 'node hl-orderbook.mjs <coin> [--market perp|spot] [--dex name]';

export async function main(args, { client, env = process.env } = {}) {
  const { values, positionals } = parseCli(args, {
    market: { type: 'string', default: 'perp' }, dex: { type: 'string', default: '' }, help: { type: 'boolean' },
  });
  if (values.help) return { usage };
  if (positionals.length !== 1) throw new Error(usage);
  client ??= createClient({ network: env.HL_NETWORK || 'mainnet' });
  const market = await resolveMarket(client, positionals[0], { market: values.market, dex: values.dex });
  const book = await client.info({ type: 'l2Book', coin: market.coin });
  if (!Array.isArray(book?.levels) || book.levels.length !== 2) throw new Error('Invalid orderbook response');
  return { network: client.network, market, book };
}

runCli(import.meta.url, main);
