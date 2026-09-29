# HyperAgent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)

A skill for connecting AI agents to [Hyperliquid](https://hyperliquid.xyz), backed by lightweight command-line tools that applications and terminal users can also use.

Read account and market data, inspect order books, and submit explicitly specified spot and perpetual orders. Commands return JSON and connect directly to Hyperliquid's public API. HyperAgent contains no trading strategy, model runtime, autonomous execution loop, or position-sizing policy.

## Features

- Read-only access to the `/info` API, with account and market discovery commands.
- Account reporting that distinguishes unified accounts, portfolio margin, and standard accounts.
- Spot, validator-operated perpetuals, and builder-deployed perpetual markets.
- Limit, immediate-or-cancel, post-only, and trigger orders; order cancellation.
- Mainnet and testnet, local signing, and dry runs for exchange actions.

## Quick start

Give your agent [SKILL.md](https://github.com/federiconuss/hyperagent/blob/master/SKILL.md), either as a file or a link, and ask it to prepare the tools:

```text
Read https://raw.githubusercontent.com/federiconuss/hyperagent/master/SKILL.md
Set up HyperAgent in your environment and verify the connection by reading
public perpetual-market data on Hyperliquid testnet.
```

The agent follows the skill to obtain the released scripts, prepare dependencies, and verify API access. It needs terminal access, a writable workspace, and internet access. **Node.js 22+ and npm run in the agent's environment**; the agent handles setup using that environment's available tools and permissions. Sending the file to a chat-only assistant does not provide execution tools.

Public market data requires no account or private key. For account queries, provide the trading account's public address. For live order execution, configure a signer through the agent environment's secret settings; keep private keys out of chat.

### Manual CLI setup

For direct terminal use, install **Node.js 22 or later** and npm, then run:

```bash
git clone https://github.com/federiconuss/hyperagent.git
cd hyperagent
npm ci
cp .env.example .env

# Public market data; no wallet or private key required.
node --env-file=.env hl-markets.mjs --market perp
node --env-file=.env hl-markets.mjs --market spot
node --env-file=.env hl-info.mjs '{"type":"allMids"}'
```

The example `.env` selects **testnet**. Environment files are loaded only when you pass `--env-file=.env`; the scripts do not load them automatically. Existing shell environment variables take precedence over the file. If `HL_NETWORK` is unset, the CLI uses **mainnet**.

To query your account, set `HL_ACCOUNT` in `.env`, then run:

```bash
node --env-file=.env hl-account.mjs
```

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `HL_NETWORK` | No | `mainnet` or `testnet`; defaults to `mainnet`. |
| `HL_ACCOUNT` | Account queries | Actual trading account address. `hl-account --user ADDRESS` overrides it. |
| `HL_PRIVATE_KEY` | Live trade/cancel | Signing key, preferably an approved Hyperliquid API wallet. |
| `HL_VAULT_ADDRESS` | No | Vault or subaccount target for exchange actions; also the default account-query target when set. |

For account reads, address precedence is `--user`, then `HL_VAULT_ADDRESS`, then `HL_ACCOUNT`. An API wallet signs for an account; its address is not the address to query for balances or positions. Configure the actual target account and an authorized signer. See [Hyperliquid's API wallet documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets).

`HL_ACCOUNT` affects reads only. Ordinary exchange actions target the signer's account or the account that approved the API wallet; `HL_VAULT_ADDRESS` selects a vault or subaccount target.

## Commands

Run any command with `--help` for usage. Data and execution commands write JSON results to stdout; failures write a JSON error to stderr and exit nonzero.

| Command | Purpose |
| --- | --- |
| `hl-info.mjs '<JSON>'` | Send a read-only request to `/info`. |
| `hl-account.mjs [--user ADDRESS] [--dex NAME]` | Retrieve account mode, balances, positions, and open orders. |
| `hl-markets.mjs --market spot\|perp [--dex NAME]` | Discover markets and their identifiers. |
| `hl-orderbook.mjs <coin> [flags]` | Retrieve the market's L2 order book snapshot. |
| `hl-trade.mjs <coin> <isBuy> <limitPx> <sz> [reduceOnly] [flags]` | Place one order with the supplied parameters. |
| `hl-cancel.mjs <coin> <oid> [flags]` | Cancel one order by its order ID. |

### Account modes and balances

Hyperliquid account unification changes how balances are reported; spot and perpetual markets still have distinct asset identifiers. `hl-account` queries `userAbstraction` to detect the account's current mode.

| Account mode | Balance interpretation |
| --- | --- |
| Unified account | `spotClearinghouseState` is authoritative for balances and holds shared by spot and perpetuals. |
| Portfolio margin | `spotClearinghouseState` is authoritative for the unified portfolio's balances and holds. |
| Standard | Spot and perpetual balances remain separate; perpetual balances are scoped to their DEX. |

Do not add a unified account's spot balance to its perpetual account-value fields: that can double-count collateral. Perpetual state is still queried for positions. The account response identifies its balance source and includes raw API state. Legacy DEX-abstraction and unresolved default modes retain raw ledgers without inventing a combined balance.

Account positions cover the selected perpetual DEX, which defaults to the native DEX. `--dex NAME` selects a builder-deployed DEX; it does not switch the account's abstraction mode. This is not a consolidated report of positions on every DEX. See the official [account abstraction modes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes).

### Read data

```bash
# The account's default perpetual DEX and spot state.
node --env-file=.env hl-account.mjs

# Builder-deployed markets; replace NAME with a DEX on the selected network.
node --env-file=.env hl-markets.mjs --market perp --dex NAME

# Raw L2 order book snapshot.
node --env-file=.env hl-orderbook.mjs BTC --market perp

# Raw spot metadata.
node --env-file=.env hl-info.mjs '{"type":"spotMeta"}'
```

Use the identifiers returned by `hl-markets` for the selected network. Perpetual symbols use exact names, such as `BTC` or `DEX:SYMBOL`. Spot markets accept their metadata name, `BASE/QUOTE`, or `@pairIndex`; ambiguous names are rejected. Spot pair indices differ from token indices and can differ between mainnet and testnet. Order and cancellation commands resolve these to the exchange's [asset IDs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids).

`hl-orderbook` returns `{network, market, book}` with the raw L2 snapshot. Prices are in quote units and sizes in base units. The snapshot covers a limited number of levels; it does not represent all available liquidity.

### Place or cancel an order

The following examples preview exchange actions on testnet. **Without `--dry-run`, trade and cancel commands submit signed actions immediately.** A dry run fetches metadata and validates the request without signing or submitting it; it does not simulate margin checks or execution.

```bash
# Buy 0.001 BTC perpetual contracts at a limit price of 60,000.
HL_NETWORK=testnet node hl-trade.mjs BTC true 60000 0.001 --market perp --dry-run

# Immediate-or-cancel: match at or better than the supplied price.
HL_NETWORK=testnet node hl-trade.mjs BTC true 60000 0.001 --market perp --ioc --dry-run

# A spot limit order. Choose a pair listed on the selected network.
HL_NETWORK=testnet node hl-trade.mjs PURR/USDC true 0.1 100 --market spot --dry-run

# Cancel a perpetual order; replace the order ID with an actual one.
HL_NETWORK=testnet node hl-cancel.mjs BTC 1234567890 --market perp --dry-run
```

For `hl-trade`, `isBuy` is `true` for a buy and `false` for a sell. `limitPx` is in quote units per base unit; `sz` is in base units. The optional `reduceOnly` positional argument is `true` or `false`, defaulting to `false`. Perpetual buys and sells may open, reduce, or reverse a position depending on the existing position and `reduceOnly`.

| Flag | Applies to | Behavior |
| --- | --- | --- |
| `--market spot\|perp` | Trade, cancel, order book, markets | Select market type; defaults to `perp`. |
| `--dex NAME` | Perpetual commands and account | Select a builder-deployed perpetual DEX; incompatible with spot. |
| `--dry-run` | Trade, cancel | Preview validated actions without submitting them. |
| `--ioc` | Trade | Immediate-or-cancel; may fill partially, canceling the remainder. |
| `--alo` | Trade | Post-only limit order. |
| `--trigger PX` | Perpetual trade | Market-on-trigger order; requires `--tpsl`. |
| `--tpsl tp\|sl` | Perpetual trade | Take-profit or stop-loss type; requires `--trigger`. |
| `--leverage N` | Perpetual trade | Explicitly update leverage; requires `--cross` or `--isolated`. |
| `--cross` / `--isolated` | Perpetual trade | Margin mode; requires `--leverage`. |

The default is a good-till-canceled limit order. IoC execution is bounded by `limitPx`, so it is not an unbounded market order. Prices and sizes must satisfy the market's [tick and lot size rules](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size).

`--ioc` and `--alo` are mutually exclusive and cannot be combined with trigger orders. Trigger orders use `isMarket: true`; their `reduceOnly` setting remains explicit. Spot orders do not accept triggers, `reduceOnly=true`, or leverage/margin flags. Decimal inputs are validated without rounding; exponent notation is not accepted.

Leverage and margin settings are unchanged unless explicitly requested. A leverage update and order placement are separate exchange actions: a successful update is not rolled back if the order fails. In that case, the error includes `completedActions` and `failedAction`; inspect the account state before retrying. Trade and cancel results include the selected network and `vaultAddress` (`null` for ordinary account actions).

## Use with an AI agent

Start with [SKILL.md](https://github.com/federiconuss/hyperagent/blob/master/SKILL.md). It includes setup instructions so the agent can prepare the CLI when the repository is not already available. For runtimes that install skills as folders, keep the full repository together so the skill and its scripts remain available.

The calling application controls which commands the agent may run and supplies any trading decisions or authorization policy. Preparing the tools is separate from running exchange actions; loading the skill does not grant permission to trade.

**Recommended optional model:** [Claude Opus 5.5](https://www.anthropic.com/claude/opus) (`claude-opus-5-5`). Choose it in your agent runtime; HyperAgent is model-independent and does not call an LLM API or require an LLM API key.

## Security and scope

- Public market data and account queries require no signing key. Keep read-only integrations keyless.
- Prefer a dedicated, approved API wallet for signing. Keep private keys out of prompts, command arguments, logs, and version control.
- `.env` is ignored by Git. Protect it locally; anyone who can read the signing key may exercise its permissions.
- Exchange requests are signed locally and sent to the selected Hyperliquid API. Private keys are not included in request bodies.
- The CLI has no withdrawal, transfer, account-mode migration, or API-wallet approval commands. It also supplies no portfolio limits or automatic position management.
- Check order status after uncertain network results before resubmitting a write; a lost response does not prove an order was rejected.
- Serialize exchange calls sharing a signer, or use separate approved API wallets for independent processes, to avoid nonce collisions.

See [SECURITY.md](SECURITY.md) for reporting guidance and [Hyperliquid's exchange API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint) for action semantics.

## Development

```bash
npm ci
npm test
npm run check
```

Tests use fixtures and mocked requests; they do not place live orders. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Breaking changes from the strategy-oriented v1 toolkit are listed in [CHANGELOG.md](CHANGELOG.md).

### API references

- [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Spot metadata and account state](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot)
- [Perpetual metadata and account state](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)
- [Exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)

## License

[MIT](LICENSE) © Federico Nussbaumer.
