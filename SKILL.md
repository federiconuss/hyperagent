---
name: hyperagent
description: Set up and use HyperAgent to connect an agent to Hyperliquid, read account and market data, and submit specified spot or perpetual orders and cancellations. Use for Hyperliquid API operations, not trading strategy or autonomous portfolio management.
---

# HyperAgent

HyperAgent exposes individual Hyperliquid API operations. It provides no strategy, trading persona, execution schedule, risk policy, or autonomous decision loop. Use the operation and parameters authorized by the caller; this reference grants no additional authority.

## Set up the tools

When the caller gives you this file or its URL and asks to connect to Hyperliquid, handle the setup in your execution environment. The caller does not need to clone the repository or install dependencies manually. This file describes the tools; the executable scripts come from [the HyperAgent repository](https://github.com/federiconuss/hyperagent).

You need a terminal, a writable workspace, and network access to GitHub, the npm registry, and Hyperliquid. A chat-only environment cannot run this connector. If execution tools are unavailable, explain the missing capability without claiming a connection was established.

1. Check `node --version`, `npm --version`, and `git --version`. Reuse an available Node.js 22+ runtime. If Node or npm is missing or incompatible, prepare a compatible runtime with the environment's supported installation tools and permissions; keep changes scoped to the task where possible. Report a blocker only if the environment cannot provide it.
2. Reuse a compatible v2 checkout containing `package.json`, `hl-markets.mjs`, and `lib/`. If you received only this Markdown file or a URL, obtain the complete released toolset in your workspace. For a new directory:

   ```bash
   git clone --branch v2.0.0 --depth 1 https://github.com/federiconuss/hyperagent.git hyperagent
   cd hyperagent
   ```

   Choose an unused destination if `hyperagent` already exists; preserve existing work and configuration. If Git is unavailable, download and extract the [v2.0.0 source archive](https://github.com/federiconuss/hyperagent/archive/refs/tags/v2.0.0.tar.gz) instead.
3. From the repository root, run `npm ci --ignore-scripts`, then `node hl-markets.mjs --help` to verify the local command. An existing installation can be reused when it matches the lockfile.
4. Verify API access with a public market-data query on the caller's selected network. If none is specified for a setup-only request, use testnet:

   ```bash
   HL_NETWORK=testnet node hl-markets.mjs --market perp
   ```

   This example uses POSIX shell syntax; set `HL_NETWORK` using the equivalent mechanism in other shells. Setup requires no account address, `.env` file, signing key, or live order. Confirm that the query succeeds and returns market metadata as JSON before reporting a working connection.
5. Report the tool location, selected network, and whether the read succeeded. Continue with the requested operation when setup is part of that task; a setup-only request ends after verification.

## Runtime and configuration

Run commands from the prepared repository root. Use `node --env-file=.env <script>.mjs ...` when an environment file is configured. Commands do not load `.env` themselves. Use `--help` for the current argument contract.

- `HL_NETWORK`: `mainnet` or `testnet`; defaults to mainnet. The example environment file selects testnet.
- `HL_ACCOUNT`: actual trading account address for account queries, not the API wallet's signer address. Query address precedence is `--user ADDRESS`, then `HL_VAULT_ADDRESS`, then `HL_ACCOUNT`.
- `HL_PRIVATE_KEY`: signing key for live exchange actions; prefer an approved API wallet. Public reads and dry runs need no private key.
- `HL_VAULT_ADDRESS`: optional target vault or subaccount for exchange actions and account queries.

Read the repository's `README.md` for configuration details and examples, or use the [online runtime documentation](https://github.com/federiconuss/hyperagent/blob/v2.0.0/README.md) if only this file is available. When persistent configuration is needed, create `.env` from `.env.example` only if no `.env` already exists. Use the environment's secret configuration for signing keys; do not ask the caller to paste a private key into chat. Never include a private key in a command argument or output.

`HL_ACCOUNT` only affects reads. Ordinary exchange actions target the signer's account or the account that approved the API wallet; `HL_VAULT_ADDRESS` selects a vault or subaccount target.

## Available operations

| Command | Operation |
| --- | --- |
| `node hl-info.mjs '<JSON>'` | Read `/info` using a Hyperliquid request body, such as `{"type":"allMids"}` or `{"type":"spotMeta"}`. |
| `node hl-account.mjs [--user ADDRESS] [--dex NAME]` | Read abstraction mode, balances, positions, and open orders. |
| `node hl-markets.mjs --market spot\|perp [--dex NAME]` | Discover valid markets and identifiers on the selected network. |
| `node hl-orderbook.mjs <coin> --market spot\|perp [--dex NAME]` | Read the raw L2 order book snapshot. |
| `node hl-trade.mjs <coin> <isBuy> <limitPx> <sz> [reduceOnly] [flags]` | Submit an order with explicit side, price, and size. |
| `node hl-cancel.mjs <coin> <oid> --market spot\|perp [--dex NAME] [--dry-run]` | Cancel the specified order. |

Data and execution commands produce JSON on stdout; failures write JSON to stderr and exit nonzero. Parse exchange results; successful submission does not necessarily mean an order filled. After an uncertain write result, query order status or open orders before retrying, because an accepted action may have lost its response. Serialize calls sharing a signer or use separate approved API wallets for independent processes to avoid nonce collisions.

## Account data

`hl-account` detects the account mode with `userAbstraction`. For unified accounts and portfolio margin, use `spotClearinghouseState` as the source of balances and holds. Do not add perpetual account-value fields to those balances. Standard accounts retain separate spot and per-DEX perpetual balances. Legacy or unresolved modes retain raw ledgers without a combined total.

Perpetual positions cover only the selected DEX, which defaults to the native DEX. Selecting `--dex` does not change the account mode or aggregate positions across all DEXs. For raw requests, use the account's actual address and follow the [official info schema](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).

## Orders and cancellations

Resolve the requested market with `hl-markets` on the selected network. Spot pair IDs differ from token IDs; spot and perpetual order actions use different asset mappings even when account balances are unified. The CLI defaults to `--market perp`.

Use exact perpetual symbols or `DEX:SYMBOL` for builder markets. Spot accepts the metadata name, `BASE/QUOTE`, or `@pairIndex`; ambiguous names are rejected.

For orders, `isBuy=true` means buy and `false` means sell. `limitPx` is in quote units per base unit; `sz` is in base units. `reduceOnly` defaults to `false` and restricts a perpetual order to reducing a position when set to `true`.

Supported flags:

- `--market spot|perp`, and `--dex NAME` for builder-deployed perpetuals.
- `--dry-run` previews validated actions without signing or submission. It still fetches metadata and is not a fill or margin simulation.
- `--ioc` for price-bounded immediate-or-cancel execution; partial fills are possible.
- `--alo` for post-only orders. Without a time-in-force flag, limit orders use GTC.
- `--trigger PX` and `--tpsl tp|sl` are required together for a perpetual market-on-trigger order (`isMarket: true`). They cannot be combined with `--ioc` or `--alo`; `reduceOnly` remains explicit.
- `--leverage N` requires either `--cross` or `--isolated`, and the margin flags require `--leverage`. Otherwise existing settings remain unchanged.

Spot does not accept triggers, `reduceOnly=true`, or leverage/margin flags. Prices and sizes are validated against market metadata without rounding; exponent notation is not accepted.

Trade and cancel commands without `--dry-run` submit immediately. Use the caller's existing authorization; the reference does not require an extra approval workflow or authorize ongoing trading. A leverage update is separate from order submission and can succeed even if the order subsequently fails. Errors preserve `completedActions` when a prior action succeeded, plus `failedAction`; inspect account state before retrying. Trade and cancel output includes the network and `vaultAddress` (`null` for ordinary account actions).

The toolkit has no withdrawal, transfer, account-mode switching, or wallet-approval command. Market data and order book output contain no entry, exit, or position-sizing recommendations.
