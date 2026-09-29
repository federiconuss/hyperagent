function checkMetadata(entry, market) {
  const max = market === 'spot' ? 8 : 6;
  if (!Number.isInteger(entry.szDecimals) || entry.szDecimals < 0 || entry.szDecimals > max) {
    throw new Error('Invalid szDecimals in market metadata');
  }
}

export async function resolveMarket(client, input, { market = 'perp', dex = '' } = {}) {
  if (!['perp', 'spot'].includes(market)) throw new Error('--market must be perp or spot');
  if (typeof input !== 'string' || !input) throw new Error('A market symbol is required');
  if (market === 'spot') {
    if (dex) throw new Error('--dex applies only to perpetuals');
    const meta = await client.info({ type: 'spotMeta' });
    if (!Array.isArray(meta?.tokens) || !Array.isArray(meta?.universe)) throw new Error('Invalid spot metadata');
    const tokens = new Map(meta.tokens.map(token => [token.index, token]));
    const matches = meta.universe.flatMap(pair => {
      const [base, quote] = (pair.tokens ?? []).map(index => tokens.get(index));
      if (!base || !quote || !Number.isSafeInteger(pair.index) || pair.index < 0) return [];
      const name = `${base.name}/${quote.name}`;
      if (![pair.name, name, `@${pair.index}`].includes(input)) return [];
      checkMetadata(base, market);
      return [{ ...pair, asset: 10000 + pair.index, coin: pair.name, name, market, dex: '', szDecimals: base.szDecimals, base, quote }];
    });
    if (matches.length > 1) throw new Error(`Ambiguous spot symbol ${input}; use an exact @index from spot metadata`);
    if (!matches.length) throw new Error(`Unknown spot market: ${input}`);
    return matches[0];
  }

  const prefix = input.includes(':') ? input.split(':')[0] : '';
  if (prefix && dex && prefix !== dex) throw new Error('Symbol prefix conflicts with --dex');
  dex = dex || prefix;
  let offset = 0;
  if (dex) {
    const dexs = await client.info({ type: 'perpDexs' });
    if (!Array.isArray(dexs)) throw new Error('Invalid perpetual DEX metadata');
    const index = dexs.findIndex(entry => entry?.name === dex);
    if (index < 1) throw new Error(`Unknown builder perpetual DEX: ${dex}`);
    offset = 100000 + index * 10000;
  }
  const meta = await client.info(dex ? { type: 'meta', dex } : { type: 'meta' });
  if (!Array.isArray(meta?.universe)) throw new Error('Invalid perpetual metadata');
  const symbol = dex && !prefix ? `${dex}:${input}` : input;
  // Legacy numeric indexes are resolved against the selected DEX's metadata.
  const index = /^\d+$/.test(input) ? Number(input) : meta.universe.findIndex(entry => entry.name === symbol);
  const entry = Number.isSafeInteger(index) && index >= 0 ? meta.universe[index] : null;
  if (!entry) throw new Error(`Unknown perpetual market: ${input}`);
  checkMetadata(entry, market);
  return { ...entry, asset: offset + index, coin: entry.name, name: entry.name, market, dex };
}

export function positiveDecimal(value, label = 'Value') {
  const text = String(value);
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text)) || Number(text) <= 0) {
    throw new Error(`${label} must be a finite positive decimal (no exponent notation)`);
  }
  const [integer, fraction = ''] = text.split('.');
  const whole = integer.replace(/^0+/, '') || '0';
  const decimals = fraction.replace(/0+$/, '');
  return decimals ? `${whole}.${decimals}` : whole;
}

export function validateSize(value, market) {
  const size = positiveDecimal(value, 'Size');
  if ((size.split('.')[1]?.length ?? 0) > market.szDecimals) throw new Error(`Size exceeds ${market.szDecimals} decimal places`);
  return size;
}

export function validatePrice(value, market, label = 'Price') {
  const price = positiveDecimal(value, label);
  const fractional = price.split('.')[1] ?? '';
  const maxDecimals = (market.market === 'spot' ? 8 : 6) - market.szDecimals;
  if (fractional.length > maxDecimals) throw new Error(`${label} exceeds ${maxDecimals} decimal places`);
  // Integer prices are exempt from the five-significant-figure limit.
  if (fractional && price.replace('.', '').replace(/^0+/, '').length > 5) throw new Error(`${label} exceeds 5 significant figures`);
  return price;
}
