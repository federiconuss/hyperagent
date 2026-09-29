# Contributing

HyperAgent is a small, model-independent Hyperliquid connector. Contributions should expose API operations and data without adding a trading strategy, autonomous loop, or portfolio-management policy.

## Local development

Use Node.js 22 or later.

```bash
git clone https://github.com/federiconuss/hyperagent.git
cd hyperagent
npm ci
npm test
npm run check
```

Run the automated suite without credentials. Tests should use fixtures or mocked network requests and must not place orders or require a funded wallet.

## Pull requests

- Describe the problem, resulting behavior, and relevant validation.
- Check changes against [Hyperliquid's official API documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api).
- Add focused coverage for changes to asset resolution, precision, signing, account modes, or exchange actions.
- Keep command output machine-readable and document changes to arguments or output schemas.
- Update the README, tool reference, and changelog when user-facing behavior changes.
- Commit `package-lock.json` when dependencies change. Do not commit `.env`, private keys, or live account fixtures.

Use testnet for any optional integration checks and state exactly what you tested. A testnet check does not establish mainnet compatibility or guarantee execution.

For bugs, include the Node.js version, sanitized command, selected network, and actual versus expected behavior. Report vulnerabilities according to [SECURITY.md](SECURITY.md).
