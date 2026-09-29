/** Account reads only. Balance values stay as API decimal strings. */
const MODES = new Set(['default', 'disabled', 'dexAbstraction', 'unifiedAccount', 'portfolioMargin']);

export function validateUser(user) {
  if (typeof user !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(user)) {
    throw new Error('Provide the account address with --user, HL_VAULT_ADDRESS or HL_ACCOUNT (0x followed by 40 hex characters). Use the master/subaccount address, not an API wallet.');
  }
  return user;
}

export function describeAbstraction(mode) {
  if (!MODES.has(mode)) {
    throw new Error('Unknown or malformed userAbstraction response; refusing to assume an account balance model.');
  }
  if (mode === 'unifiedAccount' || mode === 'portfolioMargin') {
    return {
      mode,
      balanceModel: 'unified',
      balanceSource: 'spotClearinghouseState',
      note: 'Spot balances and holds cover spot and perps. Per-DEX account totals are not account balances and must not be added. No buying power or withdrawable amount is derived from total minus hold.',
    };
  }
  if (mode === 'dexAbstraction') {
    return {
      mode,
      balanceModel: 'legacyDexAbstraction',
      balanceSource: null,
      note: 'Legacy DEX abstraction: USDC defaults to perps and other collateral to spot. Raw ledgers are preserved without a combined balance. This mode is deprecated by Hyperliquid.',
    };
  }
  if (mode === 'default') {
    return {
      mode,
      balanceModel: 'undetermined',
      balanceSource: null,
      note: 'The API returned default. Raw ledgers are preserved without assuming a shared or separate balance model; no combined balance or buying power is calculated.',
    };
  }
  return {
    mode,
    balanceModel: 'separate',
    balanceSource: { spot: 'spotClearinghouseState', perps: 'clearinghouseState' },
    note: 'Spot and selected perp DEX balances are separate. No combined account total or spot buying power is calculated.',
  };
}

export async function getAccountSnapshot(client, { user, dex = '' }) {
  validateUser(user);
  if (typeof dex !== 'string' || dex.trim() !== dex) throw new Error('Invalid perp DEX name.');
  const mode = await client.info({ type: 'userAbstraction', user });
  const abstraction = describeAbstraction(mode);
  // Spot orders are only returned with the native perp DEX. Keep that response
  // separate when the caller also selects a builder-deployed perp DEX.
  const orderDexes = dex ? ['', dex] : [''];
  const [spot, perps, ...orders] = await Promise.all([
    client.info({ type: 'spotClearinghouseState', user }),
    client.info({ type: 'clearinghouseState', user, dex }),
    ...orderDexes.map(orderDex => client.info({ type: 'openOrders', user, dex: orderDex })),
  ]);
  if (!spot || !Array.isArray(spot.balances)) throw new Error('Malformed spotClearinghouseState response.');
  if (!perps || !Array.isArray(perps.assetPositions)) throw new Error('Malformed clearinghouseState response.');
  if (orders.some(value => !Array.isArray(value))) throw new Error('Malformed openOrders response.');

  const balances = abstraction.balanceModel === 'unified'
    ? { unified: spot.balances }
    : abstraction.balanceModel === 'separate'
      ? {
          spot: spot.balances,
          perps: {
            dex,
            marginSummary: perps.marginSummary,
            crossMarginSummary: perps.crossMarginSummary,
            withdrawable: perps.withdrawable,
          },
        }
      : { spot: spot.balances };

  return {
    network: client.network,
    user,
    abstraction,
    scope: {
      perpDex: dex,
      allPerpDexes: false,
      note: 'Positions cover the selected perp DEX only. Unified balances, when enabled, are shared with other DEXs. Requests are separate API snapshots, not an atomic account snapshot.',
    },
    balances,
    positions: { dex, assetPositions: perps.assetPositions },
    openOrders: orderDexes.map((orderDex, index) => ({
      dex: orderDex,
      includesSpot: orderDex === '',
      orders: orders[index],
    })),
    raw: {
      userAbstraction: mode,
      spotClearinghouseState: spot,
      clearinghouseState: perps,
      clearinghouseStateBalanceUse: abstraction.balanceModel === 'separate'
        ? 'Selected perp DEX ledger only.'
        : 'Raw API data only; do not use per-DEX totals as account balances.',
    },
  };
}
