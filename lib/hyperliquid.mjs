import { signL1Action } from './signing.mjs';

const URLS = { mainnet: 'https://api.hyperliquid.xyz', testnet: 'https://api.hyperliquid-testnet.xyz' };
let lastNonce = 0;

export function assertExchangeSuccess(response) {
  if (response?.status !== 'ok') {
    const error = new Error(`Exchange rejected action: ${JSON.stringify(response?.response ?? response)}`);
    error.response = response;
    throw error;
  }
  const statuses = response.response?.data?.statuses ?? [];
  const failures = statuses.filter(status => status && typeof status === 'object' && 'error' in status);
  if (failures.length) {
    const error = new Error(`Exchange rejected action: ${failures.map(status => status.error).join('; ')}`);
    error.response = response;
    throw error;
  }
  return response;
}

export function createClient({ network = 'mainnet', privateKey, vaultAddress, fetchImpl = globalThis.fetch } = {}) {
  if (!Object.hasOwn(URLS, network)) throw new Error('HL_NETWORK must be mainnet or testnet');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required (Node.js 20+)');
  if (vaultAddress != null && !/^0x[0-9a-fA-F]{40}$/.test(vaultAddress)) throw new Error('Invalid HL_VAULT_ADDRESS');
  const vault = vaultAddress?.toLowerCase() ?? null;

  async function post(path, body) {
    // Never retry an exchange request automatically: a timeout does not prove rejection.
    const response = await fetchImpl(`${URLS[network]}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Hyperliquid ${path} returned HTTP ${response.status}`);
    try { return await response.json(); } catch { throw new Error(`Hyperliquid ${path} returned invalid JSON`); }
  }

  return {
    network,
    vaultAddress: vault,
    info: body => post('/info', body),
    async exchange(action) {
      if (!privateKey) throw new Error('HL_PRIVATE_KEY is required for execution; use --dry-run to preview');
      // Protect back-to-back and concurrent calls in this process from nonce collisions.
      const nonce = lastNonce = Math.max(Date.now(), lastNonce + 1);
      const signature = await signL1Action(privateKey, action, nonce, { network, vaultAddress: vault });
      return assertExchangeSuccess(await post('/exchange', { action, nonce, signature, vaultAddress: vault }));
    },
  };
}

export function clientFromEnv(env = process.env) {
  return createClient({ network: env.HL_NETWORK || 'mainnet', privateKey: env.HL_PRIVATE_KEY, vaultAddress: env.HL_VAULT_ADDRESS || undefined });
}
