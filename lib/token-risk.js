const CORE_SYMBOLS = new Set([
  'ETH', 'WETH', 'BTC', 'WBTC', 'CBBTC', 'TBTC', 'BTCB',
  'BNB', 'WBNB', 'SOL', 'WSOL', 'SUI',
  'USDC', 'USDC.E', 'USDT', 'USDT.E', 'DAI', 'FRAX', 'LUSD', 'USD1', 'USDG', 'USDE', 'SUSDE',
]);

function symbolKey(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

export function isCoreToken(symbol) {
  return CORE_SYMBOLS.has(symbolKey(symbol));
}

export function calculateTokenRisk(pool, history = [], now = Date.now()) {
  const tokens = (pool.underlying || [])
    .filter((token) => token?.symbol && !isCoreToken(token.symbol))
    .map((token) => ({ symbol: token.symbol, address: token.address || '' }));
  if (!tokens.length) return { level: 'none', warnings: [], tokens: [] };

  const warnings = [];
  const currentPrice = Number(pool.price);
  const recent = history
    .filter((row) => row.timestamp >= now - 6.5 * 3600000 && row.timestamp <= now && Number(row.price) > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  const baseline = recent[0];
  const elapsedHours = baseline ? (now - baseline.timestamp) / 3600000 : 0;

  if (currentPrice > 0 && baseline && elapsedHours >= 2) {
    const changePct = (currentPrice / Number(baseline.price) - 1) * 100;
    const magnitude = Math.abs(changePct);
    if (magnitude >= 50) {
      warnings.push({
        code: 'extreme_move', level: 'high', changePct: Number(changePct.toFixed(1)), hours: Number(elapsedHours.toFixed(1)),
        message: `${tokens[0].symbol} moved ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% in ${elapsedHours.toFixed(1)}h; high correction and out-of-range risk.`,
      });
    } else if (magnitude >= 25) {
      warnings.push({
        code: 'rapid_move', level: 'medium', changePct: Number(changePct.toFixed(1)), hours: Number(elapsedHours.toFixed(1)),
        message: `${tokens[0].symbol} moved ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% in ${elapsedHours.toFixed(1)}h; use extra caution.`,
      });
    }
  }

  const isSolana = String(pool.chain || '').toLowerCase() === 'solana' || pool.provider === 'raydium';
  const evmScannerChain = {
    1: 'eth',
    56: 'bnb',
  }[Number(pool.chainId || pool.chain)];
  const enrichedTokens = tokens.map((token) => ({
    ...token,
    reviewUrl: !token.address ? null
      : isSolana ? `https://rugcheck.xyz/tokens/${encodeURIComponent(token.address)}`
        : evmScannerChain ? `https://de.fi/scanner/contract/${encodeURIComponent(token.address)}?chainId=${evmScannerChain}` : null,
    reviewProvider: isSolana && token.address ? 'Rugcheck' : evmScannerChain && token.address ? 'De.Fi' : null,
  }));
  const level = warnings.some((warning) => warning.level === 'high')
    ? 'high'
    : warnings.some((warning) => warning.level === 'medium') ? 'medium' : 'none';
  return { level, warnings, tokens: enrichedTokens };
}
