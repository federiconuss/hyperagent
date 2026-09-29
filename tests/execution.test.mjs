import test from 'node:test';
import assert from 'node:assert/strict';
import { actionHash, signL1Action } from '../lib/signing.mjs';
import { createClient, clientFromEnv } from '../lib/hyperliquid.mjs';
import { main as trade } from '../hl-trade.mjs';
import { main as cancel } from '../hl-cancel.mjs';
import { main as orderbook } from '../hl-orderbook.mjs';

// Public test key and fixed vectors from the official hyperliquid-python-sdk:
// https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/tests/signing_test.py
const key = '0x0123456789012345678901234567890123456789012345678901234567890123';
const vault = '0x1719884eb866cb12b2287399b15f7db5e7d775ea';
const ok = { status: 'ok', response: { type: 'default' } };
const baseArgs = ['BTC', 'true', '60000', '0.001'];

function mockClient({ exchangeResult = ok, onlyIsolated = false, marginMode } = {}) {
  const submissions = [];
  const queries = [];
  return {
    network: 'testnet', submissions, queries,
    async info(body) {
      queries.push(body);
      if (body.type === 'meta') return { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40, onlyIsolated, marginMode }] };
      if (body.type === 'spotMeta') return {
        tokens: [{ index: 99, name: 'HYPE', szDecimals: 2 }, { index: 0, name: 'USDC', szDecimals: 8 }],
        universe: [{ name: '@107', index: 107, tokens: [99, 0] }],
      };
      if (body.type === 'l2Book') return { coin: body.coin, time: 123, levels: [[{ px: '20', sz: '2', n: 1 }], []] };
      throw new Error(`Unexpected info query ${body.type}`);
    },
    async exchange(action) { submissions.push(action); return exchangeResult; },
  };
}

test('official production order hash vector matches exactly', () => {
  const action = { type: 'order', orders: [{ a: 4, b: true, p: '1670.1', s: '0.0147', r: false, t: { limit: { tif: 'Ioc' } } }], grouping: 'na' };
  assert.equal(actionHash(action, null, 1677777606040), '0x0fcbeda5ae3c4950a548021552a4fea2226858c4453571bf3f24ba017eac2908');
});

test('official signatures match mainnet, testnet and vault vectors', async () => {
  const action = { type: 'dummy', num: 100000000000 };
  const vectors = [
    ['mainnet', null, '0x53749d5b30552aeb2fca34b530185976545bb22d0b3ce6f62e31be961a59298', '0x755c40ba9bf05223521753995abb2f73ab3229be8ec921f350cb447e384d8ed8', 27],
    ['testnet', null, '0x542af61ef1f429707e3c76c5293c80d01f74ef853e34b76efffcb57e574f9510', '0x17b8b32f086e8cdede991f1e2c529f5dd5297cbe8128500e00cbaf766204a613', 28],
    ['mainnet', vault, '0x3c548db75e479f8012acf3000ca3a6b05606bc2ec0c29c50c515066a326239', '0x4d402be7396ce74fbba3795769cda45aec00dc3125a984f2a9f23177b190da2c', 28],
    ['testnet', vault, '0xe281d2fb5c6e25ca01601f878e4d69c965bb598b88fac58e475dd1f5e56c362b', '0x7ddad27e9a238d045c035bc606349d075d5c5cd00a6cd1da23ab5c39d4ef0f60', 27],
  ];
  for (const [network, vaultAddress, r, s, v] of vectors) {
    const signature = await signL1Action(key, action, 0, { network, vaultAddress });
    // Python hex serializes integers without leading zeroes; ethers uses bytes32.
    assert.equal(BigInt(signature.r), BigInt(r));
    assert.equal(BigInt(signature.s), BigInt(s));
    assert.equal(signature.v, v);
  }
});

test('read clients require no credentials; exchange routes to network with normalized vault and unique nonces', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ok }; };
  const publicClient = createClient({ fetchImpl });
  await publicClient.info({ type: 'meta' });
  await assert.rejects(publicClient.exchange({ type: 'cancel', cancels: [] }), /HL_PRIVATE_KEY/);
  assert.equal(calls.length, 1);
  const client = createClient({ network: 'testnet', privateKey: key, vaultAddress: vault.toUpperCase().replace('0X', '0x'), fetchImpl });
  await Promise.all([client.exchange({ type: 'cancel', cancels: [] }), client.exchange({ type: 'cancel', cancels: [] })]);
  assert.equal(calls[1].url, 'https://api.hyperliquid-testnet.xyz/exchange');
  assert.equal(calls[1].body.vaultAddress, vault);
  assert.equal(client.vaultAddress, vault);
  assert.notEqual(calls[1].body.nonce, calls[2].body.nonce);
  assert.equal(clientFromEnv({ HL_NETWORK: 'testnet' }).network, 'testnet');
  assert.throws(() => createClient({ network: 'wrong' }), /HL_NETWORK/);
  assert.throws(() => createClient({ vaultAddress: 'bad' }), /HL_VAULT_ADDRESS/);
  await assert.rejects(createClient({ privateKey: 'sensitive-invalid-key', fetchImpl }).exchange({ type: 'cancel', cancels: [] }), /^Error: Invalid HL_PRIVATE_KEY$/);
  assert.equal(calls.length, 3);
});

test('HTTP, invalid JSON and nested exchange errors reject without retries', async () => {
  for (const [response, expected] of [
    [{ ok: false, status: 429 }, /HTTP 429/],
    [{ ok: true, json: async () => { throw new Error('bad'); } }, /invalid JSON/],
    [{ ok: true, json: async () => ({ status: 'err', response: 'rejected' }) }, /rejected/],
    [{ ok: true, json: async () => ({ status: 'ok', response: { data: { statuses: [{ error: 'bad tick' }] } } }) }, /bad tick/],
  ]) {
    let calls = 0;
    const client = createClient({ privateKey: key, fetchImpl: async () => { calls += 1; return response; } });
    await assert.rejects(client.exchange({ type: 'cancel', cancels: [] }), expected);
    assert.equal(calls, 1);
  }
});

test('dry-run constructs spot/perp actions without calling exchange; normal order never changes leverage implicitly', async () => {
  const client = mockClient();
  const dry = await trade([...baseArgs, '--dry-run'], { client });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.actions.length, 1);
  assert.equal(dry.actions[0].orders[0].a, 0);
  assert.equal(client.submissions.length, 0);
  const spot = await trade(['HYPE/USDC', 'false', '20.50', '2.10', '--market', 'spot', '--alo', '--dry-run'], { client });
  assert.deepEqual(spot.actions[0].orders[0], { a: 10107, b: false, p: '20.5', s: '2.1', r: false, t: { limit: { tif: 'Alo' } } });
  await trade(baseArgs, { client });
  assert.equal(client.submissions.length, 1);
  assert.equal(client.submissions[0].type, 'order');
});

test('invalid order inputs never submit actions', async () => {
  const invalid = [
    ['BTC', 'yes', '60000', '0.001'], ['BTC', 'true', 'Infinity', '0.001'], ['BTC', 'true', '60000', 'NaN'],
    [...baseArgs, 'yes'], ['BTC', 'true', '60000.1', '0.001'], ['BTC', 'true', '60000', '0.000001'],
    [...baseArgs, '--ioc', '--alo'], [...baseArgs, '--unknown'], [...baseArgs, '--dry-run', '--dry-run'],
    [...baseArgs, '--leverage', '2'], [...baseArgs, '--cross'], [...baseArgs, '--leverage', '2', '--cross', '--isolated'],
    [...baseArgs, '--leverage', '50', '--cross'], [...baseArgs, '--leverage', '2.1', '--isolated'],
    [...baseArgs, '--trigger', '55000'], [...baseArgs, '--tpsl', 'sl'], [...baseArgs, '--trigger', '55000', '--tpsl', 'bad'],
    [...baseArgs, '--trigger', '55000', '--tpsl', 'sl', '--ioc'],
    ['HYPE/USDC', 'true', '20', '1', 'true', '--market', 'spot'],
    ['HYPE/USDC', 'true', '20', '1', '--market', 'spot', '--leverage', '2', '--cross'],
  ];
  for (const args of invalid) {
    const client = mockClient();
    await assert.rejects(trade(args, { client }), undefined, args.join(' '));
    assert.equal(client.submissions.length, 0, args.join(' '));
  }
});

test('explicit leverage failure stops order, and invalid order is rejected before changing leverage', async () => {
  const client = mockClient({ exchangeResult: { status: 'err', response: 'leverage rejected' } });
  await assert.rejects(trade([...baseArgs, '--leverage', '2', '--isolated'], { client }), /leverage rejected/);
  assert.deepEqual(client.submissions.map(action => action.type), ['updateLeverage']);
  const invalid = mockClient();
  await assert.rejects(trade(['BTC', 'true', '12345.6', '0.001', '--leverage', '2', '--cross'], { client: invalid }), /significant/);
  assert.equal(invalid.submissions.length, 0);
  const isolated = mockClient({ onlyIsolated: true });
  await assert.rejects(trade([...baseArgs, '--leverage', '2', '--cross'], { client: isolated }), /isolated margin only/);
  assert.equal(isolated.submissions.length, 0);
  for (const marginMode of ['strictIsolated', 'noCross']) {
    const restricted = mockClient({ marginMode });
    await assert.rejects(trade([...baseArgs, '--leverage', '2', '--cross'], { client: restricted }), /isolated margin only/);
    assert.equal(restricted.submissions.length, 0);
    await trade([...baseArgs, '--leverage', '2', '--isolated', '--dry-run'], { client: restricted });
  }
});

test('trigger prices validate and explicitly requested TP/SL is preserved', async () => {
  const client = mockClient();
  const result = await trade([...baseArgs, 'true', '--trigger', '55000', '--tpsl', 'sl', '--dry-run'], { client });
  assert.deepEqual(result.actions[0].orders[0].t, { trigger: { isMarket: true, triggerPx: '55000', tpsl: 'sl' } });
  assert.equal(result.actions[0].orders[0].r, true);
  await assert.rejects(trade([...baseArgs, '--trigger', '55000.1', '--tpsl', 'sl'], { client }), /significant/);
  assert.equal(client.submissions.length, 0);
});

test('dry-run shows the normalized vault target while ignoring irrelevant private keys', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith('/info'));
    assert.equal(JSON.parse(options.body).type, 'meta');
    return { ok: true, json: async () => ({ universe: [{ name: 'BTC', szDecimals: 5 }] }) };
  };
  try {
    const env = { HL_PRIVATE_KEY: 'intentionally-invalid', HL_VAULT_ADDRESS: vault.toUpperCase().replace('0X', '0x') };
    assert.equal((await trade([...baseArgs, '--dry-run'], { env })).vaultAddress, vault);
    assert.equal((await cancel(['BTC', '123', '--dry-run'], { env })).vaultAddress, vault);
    await assert.rejects(trade([...baseArgs, '--dry-run'], { env: { HL_VAULT_ADDRESS: 'bad' } }), /HL_VAULT_ADDRESS/);
  } finally { globalThis.fetch = previousFetch; }
});

test('an order failure reports the leverage change that already completed', async () => {
  const client = mockClient();
  client.exchange = async action => {
    client.submissions.push(action);
    return action.type === 'updateLeverage' ? ok : { status: 'err', response: 'order rejected' };
  };
  await assert.rejects(trade([...baseArgs, '--leverage', '2', '--isolated'], { client }), error => {
    assert.match(error.message, /order rejected/);
    assert.deepEqual(error.completedActions, [{ action: { type: 'updateLeverage', asset: 0, isCross: false, leverage: 2 }, response: ok }]);
    assert.equal(error.failedAction.type, 'order');
    return true;
  });
  assert.deepEqual(client.submissions.map(action => action.type), ['updateLeverage', 'order']);
});

test('cancel and orderbook use spot metadata mapping; invalid IDs and cancel failures propagate', async () => {
  const client = mockClient();
  const result = await cancel(['@107', '123', '--market', 'spot', '--dry-run'], { client });
  assert.deepEqual(result.action, { type: 'cancel', cancels: [{ a: 10107, o: 123 }] });
  assert.equal(client.submissions.length, 0);
  for (const oid of ['-1', '0', '1.2', '9007199254740992', '123x']) await assert.rejects(cancel(['BTC', oid], { client }));
  const rejected = mockClient({ exchangeResult: { status: 'ok', response: { data: { statuses: [{ error: 'already filled' }] } } } });
  await assert.rejects(cancel(['BTC', '123'], { client: rejected }), /already filled/);
  const book = await orderbook(['HYPE/USDC', '--market', 'spot'], { client });
  assert.equal(book.book.coin, '@107');
  assert.deepEqual(client.queries.at(-1), { type: 'l2Book', coin: '@107' });
});
