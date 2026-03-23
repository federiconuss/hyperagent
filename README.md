# HyperAgent

[![GitHub release](https://img.shields.io/github/v/release/federiconuss/hyperagent)](https://github.com/federiconuss/hyperagent/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

CLI toolkit for trading perpetual futures on [Hyperliquid](https://hyperliquid.xyz). Includes multi-timeframe market analysis, order execution, order cancellation, and orderbook depth estimation.

Built to be operated by AI agents or manually from the terminal.

### How it works

HyperAgent is an **assisted decision stack**, not a fully autonomous bot. The scripts are deterministic tools that produce signals, scores, levels, and sizing suggestions. The **agent** (or human) is the decision layer on top — it interprets the data, applies judgment, and executes trades. See [`SKILL.md`](SKILL.md) for the full agent operating protocol.

**Recommended model:** Claude Opus 4.6 — best results in reasoning, risk management, and trade execution consistency.

### Session Init

When the agent loads the skill, it runs a startup checklist:

1. **FRED API Key check** — verifies if `FRED_API_KEY` is configured. If not, offers the free registration link ([fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html)). The system works without it, but macro event coverage is limited to hardcoded FOMC dates.
2. **Execution mode selection** — asks the operator to choose how the agent should operate.

### Execution Modes

| Mode | Behavior |
|---|---|
| **confirm-first** | Analyzes and proposes trades, but waits for operator approval before executing. Default mode. |
| **auto-execute** | Operates autonomously within hard limits and risk rules. Reports actions after execution. |
| **defensive-only** | Only manages existing positions (trail SL, close losers, fix missing orders). Never opens new entries. |

Hard limits (max exposure, max positions, SL/TP, drawdown pauses) apply in **all modes** — they are non-negotiable.

## Features

### `hl-analysis.mjs` — Market Analysis

Full top-down analysis engine that scans all Hyperliquid perps and outputs scored trade opportunities.

**Pipeline:**
1. **Account state** — balances, open positions, PnL, trailing stop-loss recommendations
2. **Order verification** — checks that every open position has SL and TP orders active
3. **BTC Daily (macro)** — regime classification, SMA50/200, EMA20/50, RSI, momentum, Fibonacci, ATR, BTC dominance
4. **BTC 4h (intermediate)** — directional confirmation, health warnings
5. **Token scan (Daily → 4h → 1h)** — scores every token with >$5M daily volume across 8 signal categories
6. **Sizing** — Kelly criterion adjusted by regime, ATR-based risk, and position count

**Regime classification:**

| Regime | Condition | Action |
|---|---|---|
| TRENDING_NORMAL | Trending + low vol | Full size |
| TRENDING_HIGHVOL | Trending + high vol | Small size |
| RANGING_NORMAL | Ranging + low vol | Mean revert |
| RANGING_HIGHVOL | Ranging + high vol | Sit out (conditional only) |

**Scoring signals:** daily RSI, daily trend (SMA/EMA/momentum), 4h RSI confirmation, funding rate, overextension, volume confirmation, BTC dominance, macro bias.

**Entry gate:** requires price proximity to a key level (Fibonacci, swing high/low) AND 1h candle rejection at that level before qualifying a trade.

```bash
node hl-analysis.mjs
```

### `hl-trade.mjs` — Order Placement

Places limit, IoC (market), trigger (stop-loss/take-profit) orders with EIP-712 signing.

```bash
# Limit order: BTC long 0.001 @ $60,000
node hl-trade.mjs BTC true 60000 0.001

# With leverage and isolated margin
node hl-trade.mjs ETH true 3500 0.1 --leverage 5

# Cross margin
node hl-trade.mjs SOL true 150 10 --leverage 3 --cross

# IoC (immediate-or-cancel / market)
node hl-trade.mjs BTC true 65000 0.001 --ioc

# Stop-loss trigger order
node hl-trade.mjs BTC true 58000 0.001 --trigger 57000 --tpsl sl

# Take-profit trigger order
node hl-trade.mjs BTC true 70000 0.001 --trigger 72000 --tpsl tp

# Reduce-only (close position)
node hl-trade.mjs BTC false 65000 0.001 true
```

**Arguments:**

| Position | Parameter | Description |
|---|---|---|
| 1 | `coin` | Asset name (BTC, ETH, SOL...) or numeric index |
| 2 | `isBuy` | `true` for long, `false` for short |
| 3 | `limitPx` | Limit price in USD |
| 4 | `sz` | Size in base asset units |
| 5 | `reduceOnly` | Optional. `true` to close existing position |

**Flags:**

| Flag | Description |
|---|---|
| `--leverage N` | Set leverage (default: 1) |
| `--cross` | Use cross margin (default: isolated) |
| `--ioc` | Immediate-or-cancel (market execution) |
| `--trigger N` | Trigger price for stop/TP orders |
| `--tpsl <tp\|sl>` | Trigger type: `tp` or `sl` (default: `sl`) |

### `hl-cancel.mjs` — Order Cancellation

```bash
node hl-cancel.mjs BTC 1234567890
```

| Position | Parameter | Description |
|---|---|---|
| 1 | `coin` | Asset name |
| 2 | `oid` | Order ID to cancel |

### `hl-orderbook.mjs` — Orderbook Depth & Slippage

Estimates market depth and slippage for a given asset and trade size.

```bash
# Basic depth check
node hl-orderbook.mjs SOL

# With size estimate
node hl-orderbook.mjs ETH 50000
```

**Output:** mid price, spread, bid/ask depth at 1%, slippage category (thick/normal/thin), estimated slippage percentage.

### `hl-events.mjs` — Event Risk Layer

Checks upcoming macro and crypto events, applies time-window rules, and outputs restrictions.

**Data sources (100% free, no trials):**
- **FRED API** (St. Louis Fed) — CPI, NFP, PCE, GDP, PPI release dates
- **FOMC 2026 dates** — hardcoded from federalreserve.gov
- **`events-crypto.json`** — manually maintained crypto events (unlocks, forks, listings)

```bash
node hl-events.mjs
```

**Output:**
```
=== EVENT RISK ===
Status: HIGH
Next: CPI in 4h 12m (Tier 1 — block)
Active restrictions:
  - BLOCK: CPI in 4h 12m
```

**Event tiers:**

| Tier | Events | Rule |
|---|---|---|
| 1 (critical) | FOMC, CPI, NFP, PCE | Block entries 6h before, reduce 3h after |
| 2 (secondary) | GDP, PPI | Reduce size 2h before, caution 1h after |
| 3 (asset) | Token unlocks, forks, listings | Per-event action from `events-crypto.json` |

Outputs a `EVENT_JSON:{...}` line for machine parsing by the agent.

### `nostr_post.mjs` — Nostr Publisher

Posts a text note (kind 1) to Nostr relays. Useful for broadcasting trade signals.

```bash
node nostr_post.mjs "BTC long entry at 62k, SL 59k, TP 68k"
```

## Setup

```bash
git clone https://github.com/federiconuss/hyperagent.git
cd hyperagent
npm install
```

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
HL_PRIVATE_KEY=0xYourPrivateKeyHere
HL_ACCOUNT=0xYourWalletAddressHere
FRED_API_KEY=YourFREDApiKey        # optional, see below
NOSTR_SK=YourNostrSecretKeyHex     # optional
```

**FRED API key (optional, for `hl-events.mjs`):** Register for free at [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html) — it's a US government service, 100% free, no trial, no credit card. Without it, `hl-events.mjs` still works with hardcoded FOMC dates and crypto events.

Then load the env vars before running any script. You can use [dotenv-cli](https://www.npmjs.com/package/dotenv-cli) or export them manually:

```bash
# Option A: dotenv-cli
npx dotenv -- node hl-analysis.mjs

# Option B: export manually
export HL_PRIVATE_KEY=0x...
export HL_ACCOUNT=0x...
node hl-analysis.mjs
```

## Dependencies

| Package | Purpose |
|---|---|
| `ethers` | EIP-712 signing and wallet management |
| `@msgpack/msgpack` | MessagePack encoding for Hyperliquid L1 actions |
| `nostr-tools` | Nostr event signing and relay publishing |
| `@noble/hashes` | Hex-to-bytes conversion for Nostr keys |
| `ws` | WebSocket client for Nostr relays |

## Architecture

All scripts are standalone Node.js ESM modules that communicate directly with the Hyperliquid API (`api.hyperliquid.xyz`) over HTTPS. No intermediate servers, no SDKs — just raw API calls and local EIP-712 signing.

```
hl-analysis.mjs    reads    /info API (candles, meta, clearinghouse, orders)
hl-events.mjs      reads    FRED API (macro dates) + events-crypto.json
hl-trade.mjs       signs    EIP-712 → posts to /exchange API
hl-cancel.mjs      signs    EIP-712 → posts to /exchange API
hl-orderbook.mjs   reads    /info API (l2Book)
nostr_post.mjs     signs    Nostr event → publishes to relays
```

Private keys never leave your machine. Only cryptographic signatures are transmitted.

## Security

- Private keys are loaded exclusively from environment variables
- No keys, addresses, or secrets are hardcoded in the source
- `.env` is gitignored — never committed to the repository
- All signing happens locally via EIP-712; only signatures are sent over the network
- Scripts are CLI-only with no exposed servers or open ports

## License

[MIT](LICENSE)
