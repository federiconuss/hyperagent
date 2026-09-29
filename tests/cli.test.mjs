import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const transport = fileURLToPath(new URL('./fixtures/public-api.mjs', import.meta.url));
const commands = ['account', 'info', 'markets', 'trade', 'cancel', 'orderbook'];
function run(command, args) {
  const env = { ...process.env, HL_NETWORK: 'testnet' };
  for (const key of ['HL_PRIVATE_KEY', 'HL_ACCOUNT', 'HL_VAULT_ADDRESS', 'NODE_OPTIONS']) delete env[key];
  return spawnSync(process.execPath, ['--import', transport, `hl-${command}.mjs`, ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 10000,
  });
}

for (const command of commands) {
  test(`${command} exposes help without credentials or an API call`, () => {
    const result = run(command, ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /usage/i);
    assert.equal(result.stderr, '');
  });
  test(`${command} rejects malformed input with JSON stderr and nonzero exit`, () => {
    const result = run(command, ['--unknown-flag']);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(typeof JSON.parse(result.stderr).error, 'string');
  });
}

for (const [command, args] of [
  ['trade', ['BTC', 'true', '100000', '0.001', '--dry-run']],
  ['trade', ['HYPE/USDC', 'true', '20', '1', '--market', 'spot', '--dry-run']],
  ['cancel', ['HYPE/USDC', '123', '--market', 'spot', '--dry-run']],
]) {
  test(`${command} ${args[0]} dry-run works without a key and never sends an exchange request`, () => {
    const result = run(command, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).dryRun, true);
    assert.equal(result.stderr, '');
  });
}

test('account CLI reports unified spot balance without exposing per-DEX totals as balances', () => {
  const result = run('account', ['--user', '0x1111111111111111111111111111111111111111']);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.abstraction.balanceModel, 'unified');
  assert.equal(output.balances.unified[0].total, '100');
  assert.equal(output.balances.perps, undefined);
});

test('raw info CLI preserves API response JSON', () => {
  const result = run('info', ['{"type":"allMids"}']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { BTC: '100000', '@107': '20' });
});
