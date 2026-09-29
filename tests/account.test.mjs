import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAbstraction, getAccountSnapshot } from '../lib/account.mjs';
import { main as accountMain } from '../hl-account.mjs';

const USER = '0x1111111111111111111111111111111111111111';
const VAULT = '0x2222222222222222222222222222222222222222';
const spot = {
  balances: [
    { coin: 'USDC', token: 0, total: '999999999999.12345678', hold: '20.00000001', entryNtl: '0' },
    { coin: 'HYPE', token: 150, total: '4.25000000', hold: '1.00000000', entryNtl: '90' },
  ],
};
const perps = {
  assetPositions: [{ type: 'oneWay', position: { coin: 'BTC', szi: '0.1', unrealizedPnl: '12.4' } }],
  marginSummary: { accountValue: '12345', totalRawUsd: '12000', totalMarginUsed: '300', totalNtlPos: '10000' },
  crossMarginSummary: { accountValue: '12345', totalRawUsd: '12000', totalMarginUsed: '300', totalNtlPos: '10000' },
  withdrawable: '12045',
  time: 123456789,
};
const nativeOrders = [
  { coin: 'BTC', oid: 10, side: 'B' },
  { coin: '@107', oid: 11, side: 'A' },
];
const builderOrders = [{ coin: 'xyz:XYZ100', oid: 12, side: 'B' }];

function fixture(mode, overrides = {}) {
  const calls = [];
  return {
    network: 'testnet', calls,
    async info(body) {
      calls.push(body);
      if (Object.hasOwn(overrides, body.type)) return overrides[body.type];
      switch (body.type) {
        case 'userAbstraction': return mode;
        case 'spotClearinghouseState': return structuredClone(spot);
        case 'clearinghouseState': return structuredClone(perps);
        case 'openOrders': return structuredClone(body.dex ? builderOrders : nativeOrders);
        default: throw new Error(`Unexpected request ${body.type}`);
      }
    },
    exchange() { assert.fail('Read-only commands must never invoke exchange.'); },
  };
}

test('disabled mode retains separate ledgers and exact API decimal strings', async () => {
  const api = fixture('disabled');
  const result = await getAccountSnapshot(api, { user: USER });
  assert.equal(result.abstraction.balanceModel, 'separate');
  assert.deepEqual(result.balances.spot, spot.balances);
  assert.deepEqual(result.balances.perps.marginSummary, perps.marginSummary);
  assert.equal(result.balances.perps.withdrawable, '12045');
  assert.equal(result.scope.allPerpDexes, false);
  assert.deepEqual(result.positions.assetPositions, perps.assetPositions);
  assert.deepEqual(result.openOrders, [{ dex: '', includesSpot: true, orders: nativeOrders }]);
  assert.deepEqual(api.calls.map(call => call.type), ['userAbstraction', 'spotClearinghouseState', 'clearinghouseState', 'openOrders']);
});

for (const mode of ['unifiedAccount', 'portfolioMargin']) {
  test(`${mode} uses spot balances once and never promotes per-DEX totals or total-minus-hold`, async () => {
    const result = await getAccountSnapshot(fixture(mode), { user: USER });
    assert.equal(result.abstraction.mode, mode);
    assert.equal(result.abstraction.balanceModel, 'unified');
    assert.equal(result.abstraction.balanceSource, 'spotClearinghouseState');
    assert.deepEqual(result.balances, { unified: spot.balances });
    assert.deepEqual(result.raw.spotClearinghouseState, spot);
    assert.deepEqual(result.raw.clearinghouseState, perps);
    assert.match(result.raw.clearinghouseStateBalanceUse, /do not use per-DEX totals/);
    assert.equal(result.positions.assetPositions[0].position.szi, '0.1');
    assert.equal('withdrawable' in result.balances, false);
    assert.equal('buyingPower' in result.balances, false);
    assert.equal('available' in result.balances.unified[0], false);
  });
}

test('default mode is explicitly undetermined, not silently treated as standard', async () => {
  const result = await getAccountSnapshot(fixture('default'), { user: USER });
  assert.equal(result.abstraction.balanceModel, 'undetermined');
  assert.equal(result.abstraction.balanceSource, null);
  assert.deepEqual(result.raw.clearinghouseState, perps);
  assert.equal('perps' in result.balances, false);
});

test('legacy DEX abstraction preserves raw state without a combined balance', async () => {
  const result = await getAccountSnapshot(fixture('dexAbstraction'), { user: USER });
  assert.equal(result.abstraction.balanceModel, 'legacyDexAbstraction');
  assert.equal(result.abstraction.balanceSource, null);
  assert.deepEqual(result.raw.clearinghouseState, perps);
  assert.equal('perps' in result.balances, false);
});

test('named perp DEX reads its positions/orders and native orders containing spot', async () => {
  const api = fixture('unifiedAccount');
  const result = await getAccountSnapshot(api, { user: USER, dex: 'xyz' });
  assert.deepEqual(api.calls.find(call => call.type === 'clearinghouseState'), { type: 'clearinghouseState', user: USER, dex: 'xyz' });
  assert.deepEqual(result.openOrders, [
    { dex: '', includesSpot: true, orders: nativeOrders },
    { dex: 'xyz', includesSpot: false, orders: builderOrders },
  ]);
  assert.equal(result.positions.dex, 'xyz');
});

test('unrecognized/malformed account modes never fall back to another balance model', async () => {
  for (const mode of ['newMode', undefined, null, false, { mode: 'unifiedAccount' }]) {
    const api = fixture(mode);
    await assert.rejects(getAccountSnapshot(api, { user: USER }), /Unknown or malformed userAbstraction/);
    assert.equal(api.calls.length, 1);
  }
  assert.throws(() => describeAbstraction('standard'), /Unknown/);
});

test('mode endpoint failure propagates without reading another ledger', async () => {
  let calls = 0;
  const api = { info: async () => { calls++; throw new Error('HTTP 503'); } };
  await assert.rejects(getAccountSnapshot(api, { user: USER }), /HTTP 503/);
  assert.equal(calls, 1);
});

test('malformed state is an error instead of an empty balance or position list', async () => {
  for (const [type, value] of [
    ['spotClearinghouseState', { balances: null }],
    ['clearinghouseState', { marginSummary: {} }],
    ['openOrders', { error: 'unavailable' }],
  ]) {
    await assert.rejects(getAccountSnapshot(fixture('unifiedAccount', { [type]: value }), { user: USER }), /Malformed/);
  }
});

test('invalid account address is rejected before API access', async () => {
  const api = fixture('disabled');
  for (const user of ['', undefined, '0x1234', `${USER}0`]) {
    await assert.rejects(getAccountSnapshot(api, { user }), /account address/);
  }
  assert.deepEqual(api.calls, []);
});

test('account CLI respects explicit user > vault > account and emits one JSON result', async () => {
  for (const [args, env, expected] of [
    [[], { HL_ACCOUNT: USER }, USER],
    [[], { HL_ACCOUNT: USER, HL_VAULT_ADDRESS: '' }, USER],
    [[], { HL_ACCOUNT: USER, HL_VAULT_ADDRESS: VAULT }, VAULT],
    [['--user', USER], { HL_ACCOUNT: VAULT, HL_VAULT_ADDRESS: VAULT }, USER],
  ]) {
    const api = fixture('unifiedAccount');
    const output = [];
    const result = await accountMain(args, { env, client: api, stdout: value => output.push(value) });
    assert.equal(result.user, expected);
    assert.equal(output.length, 1);
    assert.deepEqual(JSON.parse(output[0]), result);
    assert.ok(api.calls.every(call => call.user === expected));
  }
});

test('account CLI rejects blank configured addresses and preserves explicit user validation', async () => {
  const api = fixture('unifiedAccount');
  for (const [args, env] of [
    [[], { HL_ACCOUNT: '', HL_VAULT_ADDRESS: '' }],
    [['--user', ''], { HL_ACCOUNT: USER, HL_VAULT_ADDRESS: VAULT }],
  ]) {
    await assert.rejects(accountMain(args, { env, client: api }), /Provide the account address with --user, HL_VAULT_ADDRESS or HL_ACCOUNT/);
  }
  assert.deepEqual(api.calls, []);
});

test('account CLI rejects unknown flags and has offline help', async () => {
  const api = fixture('disabled');
  await assert.rejects(accountMain(['--change-mode', 'unifiedAccount'], { client: api }), /Unknown option/);
  const output = [];
  await accountMain(['--help'], { client: api, stdout: value => output.push(value) });
  assert.match(output[0], /read only/);
  assert.deepEqual(api.calls, []);
});
