// A transport boundary for subprocess tests. Any exchange request fails.
globalThis.fetch = async (url, options) => {
  if (!String(url).endsWith('/info')) throw new Error('TEST: exchange must never be called');
  const request = JSON.parse(options.body);
  const spotMeta = {
    tokens: [
      { name: 'USDC', index: 0, szDecimals: 8 },
      { name: 'HYPE', index: 150, szDecimals: 2 },
    ],
    universe: [{ name: '@107', index: 107, tokens: [150, 0] }],
  };
  const meta = { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] };
  const responses = {
    meta,
    spotMeta,
    metaAndAssetCtxs: [meta, [{ markPx: '100000' }]],
    spotMetaAndAssetCtxs: [spotMeta, [{ coin: '@107', markPx: '20' }]],
    allMids: { BTC: '100000', '@107': '20' },
    userAbstraction: 'unifiedAccount',
    spotClearinghouseState: { balances: [{ coin: 'USDC', token: 0, total: '100', hold: '20' }] },
    clearinghouseState: { assetPositions: [], marginSummary: { accountValue: '99999' } },
    openOrders: [],
    l2Book: { coin: request.coin, time: 1, levels: [[{ px: '19', sz: '10', n: 1 }], [{ px: '21', sz: '10', n: 1 }]] },
  };
  if (!(request.type in responses)) throw new Error(`TEST: unexpected info type ${request.type}`);
  return new Response(JSON.stringify(responses[request.type]), { status: 200 });
};
