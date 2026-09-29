#!/usr/bin/env node
import { clientFromEnv, createClient, assertExchangeSuccess } from './lib/hyperliquid.mjs';
import { resolveMarket, positiveDecimal, validatePrice, validateSize } from './lib/markets.mjs';
import { booleanValue, parseCli, runCli } from './lib/execution-cli.mjs';

const usage = 'node hl-trade.mjs <coin> <isBuy:true|false> <limitPx> <sz> [reduceOnly:true|false] [--market perp|spot] [--dex name] [--ioc|--alo] [--trigger px --tpsl tp|sl] [--leverage N --cross|--isolated] [--dry-run]';

export async function main(args, { client, env = process.env } = {}) {
  const { values, positionals } = parseCli(args, {
    market: { type: 'string', default: 'perp' }, dex: { type: 'string', default: '' },
    ioc: { type: 'boolean' }, alo: { type: 'boolean' }, trigger: { type: 'string' }, tpsl: { type: 'string' },
    leverage: { type: 'string' }, cross: { type: 'boolean' }, isolated: { type: 'boolean' },
    'dry-run': { type: 'boolean' }, help: { type: 'boolean' },
  });
  if (values.help) return { usage };
  if (positionals.length < 4 || positionals.length > 5) throw new Error(usage);
  const [coin, side, priceInput, sizeInput, reduceInput = 'false'] = positionals;
  const isBuy = booleanValue(side, 'isBuy');
  const reduceOnly = booleanValue(reduceInput, 'reduceOnly');
  positiveDecimal(priceInput, 'Price');
  positiveDecimal(sizeInput, 'Size');
  if (values.ioc && values.alo) throw new Error('--ioc and --alo are mutually exclusive');
  if (values.trigger !== undefined && (values.ioc || values.alo)) throw new Error('Trigger orders cannot use --ioc or --alo');
  if ((values.tpsl !== undefined) !== (values.trigger !== undefined)) throw new Error('--trigger and --tpsl must be supplied together');
  if (values.tpsl !== undefined && !['tp', 'sl'].includes(values.tpsl)) throw new Error('--tpsl must be tp or sl');
  if (values.trigger !== undefined) positiveDecimal(values.trigger, 'Trigger price');
  if (values.cross && values.isolated) throw new Error('--cross and --isolated are mutually exclusive');
  if ((values.cross || values.isolated) && values.leverage === undefined) throw new Error('--cross/--isolated requires --leverage');
  let leverage;
  if (values.leverage !== undefined) {
    if (!values.cross && !values.isolated) throw new Error('--leverage requires explicit --cross or --isolated');
    leverage = Number(values.leverage);
    if (!/^\d+$/.test(values.leverage) || !Number.isSafeInteger(leverage) || leverage < 1) throw new Error('--leverage must be a positive integer');
  }
  if (values.market === 'spot' && (reduceOnly || leverage !== undefined || values.cross || values.isolated)) {
    throw new Error('Spot orders do not support reduceOnly or leverage/margin flags');
  }
  if (values.market === 'spot' && values.trigger !== undefined) throw new Error('Trigger orders are supported only for perpetuals by this CLI');

  client ??= values['dry-run']
    ? createClient({ network: env.HL_NETWORK || 'mainnet', vaultAddress: env.HL_VAULT_ADDRESS || undefined })
    : clientFromEnv(env);
  const market = await resolveMarket(client, coin, { market: values.market, dex: values.dex });
  if (market.isDelisted) throw new Error(`Market ${market.coin} is delisted`);
  const price = validatePrice(priceInput, market);
  const size = validateSize(sizeInput, market);
  const type = values.trigger !== undefined
    ? { trigger: { isMarket: true, triggerPx: validatePrice(values.trigger, market, 'Trigger price'), tpsl: values.tpsl } }
    : { limit: { tif: values.ioc ? 'Ioc' : values.alo ? 'Alo' : 'Gtc' } };
  if (leverage !== undefined && Number.isFinite(market.maxLeverage) && leverage > market.maxLeverage) throw new Error(`Leverage exceeds market maximum ${market.maxLeverage}`);
  if (leverage !== undefined && values.cross && (market.onlyIsolated || ['strictIsolated', 'noCross'].includes(market.marginMode))) {
    throw new Error('This market supports isolated margin only');
  }
  const actions = [];
  if (leverage !== undefined) actions.push({ type: 'updateLeverage', asset: market.asset, isCross: !!values.cross, leverage });
  actions.push({ type: 'order', orders: [{ a: market.asset, b: isBuy, p: price, s: size, r: reduceOnly, t: type }], grouping: 'na' });
  if (values['dry-run']) return { dryRun: true, network: client.network, vaultAddress: client.vaultAddress ?? null, market, actions };
  const responses = [];
  const completedActions = [];
  for (const action of actions) {
    try {
      const response = assertExchangeSuccess(await client.exchange(action));
      responses.push(response);
      completedActions.push({ action, response });
    } catch (error) {
      // Leverage and order submissions are separate transactions, not atomic.
      if (completedActions.length) error.completedActions = completedActions;
      error.failedAction = action;
      throw error;
    }
  }
  return { network: client.network, vaultAddress: client.vaultAddress ?? null, market, responses };
}

runCli(import.meta.url, main);
