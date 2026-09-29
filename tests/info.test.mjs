import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main as infoMain, parseInfoRequest } from '../hl-info.mjs';
import { main as marketsMain } from '../hl-markets.mjs';

test('info accepts an arbitrary JSON /info request without rewriting it', async () => {
  const body = { type: 'candleSnapshot', req: { coin: '@107', interval: '1h', startTime: 1000 } };
  const output = [];
  const client = {
    async info(request) { assert.deepEqual(request, body); return [{ c: '4.125', t: 1000 }]; },
    exchange() { assert.fail('Must never sign or send an exchange action.'); },
  };
  const result = await infoMain([JSON.stringify(body)], { client, stdout: value => output.push(value) });
  assert.deepEqual(JSON.parse(output[0]), result);
});

test('info forwards valid primitive responses such as account mode or null', async () => {
  for (const response of ['unifiedAccount', null, false]) {
    const output = [];
    await infoMain(['{"type":"userAbstraction","user":"0x..."}'], {
      client: { async info() { return response; } }, stdout: value => output.push(value),
    });
    assert.equal(JSON.parse(output[0]), response);
  }
});

test('info rejects malformed or missing request bodies before HTTP', () => {
  for (const args of [[], ['{}', '{}'], ['{'], ['null'], ['[]'], ['42'], ['{}'], ['{"type":1}'], ['{"type":" "}']]) {
    assert.throws(() => parseInfoRequest(args));
  }
});

test('info errors propagate and help is offline', async () => {
  await assert.rejects(infoMain(['{"type":"meta"}'], {
    client: { async info() { throw new Error('HTTP 429'); } },
  }), /HTTP 429/);
  const output = [];
  await infoMain(['--help'], { client: { info() { assert.fail(); } }, stdout: value => output.push(value) });
  assert.match(output[0], /read-only/);
});

test('perp markets default to native DEX and preserve API metadata/contexts', async () => {
  const data = [{ universe: [{ name: 'BTC', szDecimals: 5 }] }, [{ markPx: '100000.01', funding: '0.00001' }]];
  const output = [];
  const result = await marketsMain([], {
    client: { network: 'testnet', async info(body) { assert.deepEqual(body, { type: 'metaAndAssetCtxs', dex: '' }); return data; } },
    stdout: value => output.push(value),
  });
  assert.deepEqual(result, { network: 'testnet', market: 'perp', dex: '', metadata: data[0], contexts: data[1] });
  assert.deepEqual(JSON.parse(output[0]), result);
});

test('named DEX metadata request includes its namespace', async () => {
  await marketsMain(['--dex', 'xyz'], {
    client: { async info(body) { assert.deepEqual(body, { type: 'metaAndAssetCtxs', dex: 'xyz' }); return [{ universe: [] }, []]; } },
    stdout() {},
  });
});

test('spot discovery preserves pair indices and tokens instead of assuming perp IDs', async () => {
  const data = [{
    universe: [{ name: '@107', index: 107, tokens: [150, 0] }],
    tokens: [{ index: 0, name: 'USDC', szDecimals: 8 }, { index: 150, name: 'HYPE', szDecimals: 2 }],
  }, [{ coin: '@107', markPx: '30.55' }]];
  const result = await marketsMain(['--market', 'spot'], {
    client: { network: 'mainnet', async info(body) { assert.deepEqual(body, { type: 'spotMetaAndAssetCtxs' }); return data; } },
    stdout() {},
  });
  assert.equal(result.metadata.universe[0].index, 107);
  assert.deepEqual(result.metadata.tokens, data[0].tokens);
  assert.equal('dex' in result, false);
});

test('market validation rejects unsupported markets/flags and malformed responses', async () => {
  const client = { info() { assert.fail('Invalid flags should not send HTTP.'); } };
  for (const args of [['--market', 'future'], ['--market', 'spot', '--dex', 'xyz'], ['--market', 'spot', '--dex', ''], ['--signal']]) {
    await assert.rejects(marketsMain(args, { client }));
  }
  await assert.rejects(marketsMain([], { client: { async info() { return {}; } } }), /Malformed/);
});

test('CLI invalid input exits nonzero with structured stderr and no stdout', () => {
  for (const [file, args] of [
    ['hl-info.mjs', ['{']],
    ['hl-account.mjs', ['--user', 'not-an-address']],
    ['hl-markets.mjs', ['--market', 'spot', '--dex', 'xyz']],
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../${file}`, import.meta.url)), ...args], {
      encoding: 'utf8', env: { PATH: process.env.PATH, HL_NETWORK: 'testnet' },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(typeof JSON.parse(result.stderr).error, 'string');
  }
});
