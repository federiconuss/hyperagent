import { Wallet, getBytes, keccak256 } from 'ethers';
import { encode } from '@msgpack/msgpack';

// L1 action signing follows the official hyperliquid-python-sdk signing.py.
// Object insertion order is significant in MessagePack: do not sort action keys.
export function actionHash(action, vaultAddress, nonce) {
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Invalid nonce');
  const nonceBytes = Buffer.alloc(8);
  nonceBytes.writeBigUInt64BE(BigInt(nonce));
  const vault = vaultAddress == null
    ? Buffer.from([0])
    : Buffer.concat([Buffer.from([1]), Buffer.from(getBytes(vaultAddress))]);
  if (vault.length !== 1 && vault.length !== 21) throw new Error('Invalid vault address');
  return keccak256(Buffer.concat([Buffer.from(encode(action)), nonceBytes, vault]));
}

export async function signL1Action(privateKey, action, nonce, { network = 'mainnet', vaultAddress = null } = {}) {
  if (!['mainnet', 'testnet'].includes(network)) throw new Error('Invalid network');
  let wallet;
  try { wallet = new Wallet(privateKey); } catch { throw new Error('Invalid HL_PRIVATE_KEY'); }
  const signature = await wallet.signTypedData(
    { chainId: 1337, name: 'Exchange', verifyingContract: '0x0000000000000000000000000000000000000000', version: '1' },
    { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    { source: network === 'mainnet' ? 'a' : 'b', connectionId: actionHash(action, vaultAddress, nonce) },
  );
  return { r: signature.slice(0, 66), s: `0x${signature.slice(66, 130)}`, v: Number.parseInt(signature.slice(130, 132), 16) };
}
