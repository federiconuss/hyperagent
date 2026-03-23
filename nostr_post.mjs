import { finalizeEvent } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';
import { hexToBytes } from '@noble/hashes/utils';
import WebSocket from 'ws';

globalThis.WebSocket = WebSocket;

if (!process.env.NOSTR_SK) {
  console.error('Missing env var. Set NOSTR_SK (see .env.example)');
  process.exit(1);
}

const sk = hexToBytes(process.env.NOSTR_SK);
const content = process.argv[2];
if (!content) { console.error('Usage: node nostr_post.mjs "content"'); process.exit(1); }

const event = finalizeEvent({
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content
}, sk);

const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
let published = 0;

for (const url of relays) {
  try {
    const relay = await Relay.connect(url);
    await relay.publish(event);
    console.log(`✅ Published to ${url}`);
    published++;
    relay.close();
  } catch (e) {
    console.error(`❌ ${url}: ${e.message}`);
  }
}

console.log(`\nDone: ${published}/${relays.length} relays`);
process.exit(published > 0 ? 0 : 1);
