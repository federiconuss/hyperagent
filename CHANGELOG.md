# Changelog

## Unreleased

- Make sharing `SKILL.md` with an agent the primary setup flow.
- Add agent setup instructions for obtaining the released CLI, preparing its runtime, and verifying public API access without credentials.
- Keep manual CLI installation as an alternative and clarify the execution capabilities required by the agent.

## 2.0.0 — 2026-09-29

HyperAgent becomes a neutral Hyperliquid CLI connector. This is a breaking change from the strategy-oriented v1 toolkit.

### Added

- Read-only `hl-info`, `hl-account`, and `hl-markets` commands.
- Spot and builder-deployed perpetual market support alongside validator-operated perpetuals.
- Account-abstraction detection and unified/portfolio balance reporting based on spot clearinghouse state.
- Testnet selection, exchange-action dry runs, and explicit vault/subaccount targeting.
- Shared API, asset-resolution, precision, and signing utilities with automated checks.
- Node.js 22+ requirement, contributor guidance, and security reporting documentation.

### Changed

- `SKILL.md` is now a tool reference; the caller supplies decisions and authorization.
- Commands return JSON suitable for agent and application integration.
- Order placement preserves leverage and margin mode unless explicitly updated.
- Order book output returns the raw L2 snapshot without trading recommendations or sizing estimates.
- README recommends Claude Opus 5.5 as an optional model in the calling agent runtime.

### Removed

- Trading persona, execution modes, autonomous execution loop, conviction sizing, and built-in strategy/risk rules.
- `hl-analysis.mjs`, `hl-events.mjs`, `events-crypto.json`, and `nostr_post.mjs`.
- FRED and Nostr environment settings and dependencies.

### Migrating from v1

1. Use Node.js 22+ and run `npm ci` to install the current dependency set.
2. Review `.env.example`. Set `HL_NETWORK` explicitly; an unset value still selects mainnet. Load `.env` with `node --env-file=.env` when needed.
3. Replace analysis/event-script callers with the specific read operations your application needs: `hl-info`, `hl-account`, and `hl-markets`.
4. Update output parsers for JSON and callers for the documented command arguments. Use `--market spot` for spot operations and current metadata for asset identifiers.
5. Remove assumptions that each trade resets leverage, installs protective orders, or follows a bundled strategy. Apply any desired policies in your calling application.
6. Preview intended orders and cancellations with `--dry-run` and validate integrations on testnet before using mainnet.

Source snapshots of earlier versions remain available through [Git tags](https://github.com/federiconuss/hyperagent/tags).
