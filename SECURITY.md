# Security

## Scope

HyperAgent reads Hyperliquid API data and signs explicitly requested order, cancellation, and leverage actions locally. It does not enforce trading limits, monitor a portfolio, or control the permissions of an external agent runtime. A process with access to `HL_PRIVATE_KEY` can exercise the signer's permissions.

## Credentials and execution

- Prefer a dedicated API wallet approved for the intended account and network. Query the actual trading account's address, not the API wallet address.
- Keep private keys in a protected environment or secret store. Do not include them in prompts, command arguments, issue reports, screenshots, or logs.
- `.env` files are ignored by Git but are still readable by processes with filesystem access. Load them explicitly and limit local access.
- Use keyless access for public data and account reads. `--dry-run` previews validated actions without signing or submitting them.
- Live trade and cancel commands submit immediately. Verify the network, target account, market, side, price, and size before submitting.
- If a write request times out, check the exchange state before retrying. A missing response does not establish that the action failed.
- Serialize calls sharing a signer, or use a separate API wallet for independent signing processes to avoid nonce collisions. Follow [Hyperliquid's nonce and API-wallet guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets).

The CLI has no withdrawal, transfer, account-mode migration, or wallet-approval command. This describes its interface, not what a compromised signing key or host can do elsewhere.

## Reporting a vulnerability

Use the repository's [private vulnerability reporting page](https://github.com/federiconuss/hyperagent/security/advisories/new) if it is enabled. If it is unavailable, open a minimal issue requesting a private contact channel without publishing exploit details or sensitive data.

Include affected versions, a concise impact description, and reproduction steps using test fixtures or testnet. Do not include private keys or test an exploit against accounts you do not control.
