import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarket, validatePrice, validateSize } from '../lib/markets.mjs';

const spotMeta = {
  tokens: [
    { index: 150, name: 'HYPE', szDecimals: 2 },
    { index: 0, name: 'USDC', szDecimals: 8 },
    { index: 77, name: 'PURR', szDecimals: 0 },
  ],
  universe: [
    { index: 107, name: '@107', tokens: [150, 0] },
    { index: 0, name: 'PURR/USDC', tokens: [77, 0] },
  ],
};
const info = async body => {
  if (body.type === 'spotMeta') return spotMeta;
  if (body.type === 'perpDexs') return [null, { name: 'first' }, { name: 'xyz' }];
  if (body.type === 'meta' && body.dex === 'xyz') return { universe: [{ name: 'xyz:XYZ100', szDecimals: 3, maxLeverage: 20 }] };
  if (body.type === 'meta') return { universe: [{ name: 'BTC', szDecimals: 5 }, { name: 'ETH', szDecimals: 4 }] };
  throw new Error(`Unexpected info call: ${JSON.stringify(body)}`);
};

test('spot mapping uses pair index, not token index or array order; canonical info coin differs from exchange ID', async () => {
  for (const input of ['HYPE/USDC', '@107']) {
    const market = await resolveMarket({ info }, input, { market: 'spot' });
    assert.equal(market.asset, 10107);
    assert.equal(market.coin, '@107');
    assert.equal(market.szDecimals, 2);
    assert.equal(market.base.index, 150);
  }
  assert.equal((await resolveMarket({ info }, '@0', { market: 'spot' })).coin, 'PURR/USDC');
  assert.equal((await resolveMarket({ info }, 'PURR/USDC', { market: 'spot' })).asset, 10000);
});

test('perp native and builder mappings use selected DEX metadata', async () => {
  assert.equal((await resolveMarket({ info }, 'ETH')).asset, 1);
  assert.equal((await resolveMarket({ info }, '0')).coin, 'BTC');
  for (const [input, options] of [['xyz:XYZ100', {}], ['XYZ100', { dex: 'xyz' }], ['0', { dex: 'xyz' }]]) {
    const market = await resolveMarket({ info }, input, options);
    assert.equal(market.asset, 120000);
    assert.equal(market.coin, 'xyz:XYZ100');
    assert.equal(market.dex, 'xyz');
  }
});

test('unknown, ambiguous and mismatched market selectors fail', async () => {
  await assert.rejects(resolveMarket({ info }, 'btc'), /Unknown perpetual/);
  await assert.rejects(resolveMarket({ info }, '1000000'), /Unknown perpetual/);
  await assert.rejects(resolveMarket({ info }, 'HYPE', { market: 'spot' }), /Unknown spot/);
  await assert.rejects(resolveMarket({ info }, 'BTC', { market: 'invalid' }), /--market/);
  await assert.rejects(resolveMarket({ info }, 'BTC', { dex: 'missing' }), /Unknown builder/);
  await assert.rejects(resolveMarket({ info }, 'xyz:XYZ100', { dex: 'first' }), /conflicts/);
  await assert.rejects(resolveMarket({ info }, 'HYPE/USDC', { market: 'spot', dex: 'xyz' }), /only to perpetuals/);
  const ambiguous = { info: async () => ({ ...spotMeta, universe: [...spotMeta.universe, { index: 200, name: '@200', tokens: [150, 0] }] }) };
  await assert.rejects(resolveMarket(ambiguous, 'HYPE/USDC', { market: 'spot' }), /Ambiguous/);
  assert.equal((await resolveMarket(ambiguous, '@200', { market: 'spot' })).asset, 10200);
});

test('price and lot rules allow integer prices and enforce exact decimals without rounding', () => {
  const perp = { market: 'perp', szDecimals: 3 };
  const spot = { market: 'spot', szDecimals: 1 };
  assert.equal(validatePrice('123456', perp), '123456');
  assert.equal(validatePrice('01234.500', perp), '1234.5');
  assert.equal(validatePrice('0.0001234', spot), '0.0001234');
  assert.equal(validateSize('01.0100', perp), '1.01');
  assert.throws(() => validatePrice('1234.56', perp), /significant/);
  assert.throws(() => validatePrice('0.0001', perp), /decimal places/);
  assert.throws(() => validatePrice('0.0001234', { market: 'spot', szDecimals: 2 }), /decimal places/);
  assert.throws(() => validateSize('1.0001', perp), /decimal places/);
  for (const invalid of ['0', '-1', 'Infinity', 'NaN', '1e-3', '10usd', '', ' 1', '1e309']) {
    assert.throws(() => validateSize(invalid, perp), /finite positive decimal/);
    assert.throws(() => validatePrice(invalid, perp), /finite positive decimal/);
  }
});
