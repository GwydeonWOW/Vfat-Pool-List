// ── Frontend API - calls local backend ──

const API_BASE = '/api';
let onAuthFail = null;

export function setOnAuthFail(cb) {
  onAuthFail = cb;
}

export function getToken() {
  return true;
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    if (onAuthFail) onAuthFail();
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Chain ID -> { name, defiLlamaChain, explorer }
export const CHAINS = {
  8453: { name: 'Base', defiLlamaChain: 'base', explorer: 'https://basescan.org' },
  56: { name: 'BSC', defiLlamaChain: 'bsc', explorer: 'https://bscscan.com' },
  43114: { name: 'Avalanche', defiLlamaChain: 'avax', explorer: 'https://snowtrace.io' },
  137: { name: 'Polygon', defiLlamaChain: 'polygon', explorer: 'https://polygonscan.com' },
  10: { name: 'Optimism', defiLlamaChain: 'optimism', explorer: 'https://optimistic.etherscan.io' },
  146: { name: 'Sonic', defiLlamaChain: 'sonic', explorer: 'https://sonicscan.org' },
  999: { name: 'Hype', defiLlamaChain: 'hyperliquid', explorer: 'https://www.hyperscan.com' },
  143: { name: 'Monad', defiLlamaChain: 'monad', explorer: 'https://monadvision.com' },
};

export const MAJOR_TOKENS = [
  'WETH', 'ETH', 'USDC', 'USDT', 'WBTC', 'cbBTC', 'tBTC', 'BTCB',
  'WBNB', 'BNB', 'DAI', 'USD1',
];

/**
 * Fetch VFat pools from local backend (pre-cached).
 */
export async function fetchAllPools() {
  const data = await fetchJSON(`${API_BASE}/vfat`);
  return data.pools || [];
}

export async function fetchProviderPools(provider) {
  const data = await fetchJSON(`${API_BASE}/${provider}`);
  return data;
}

/**
 * Fetch Raydium pools from local backend.
 */
export async function fetchRaydiumPools() {
  const data = await fetchJSON(`${API_BASE}/raydium`);
  return data.pools || [];
}

/**
 * Fetch Turbos pools from local backend.
 */
export async function fetchTurbosPools() {
  const data = await fetchJSON(`${API_BASE}/turbos`);
  return data.pools || [];
}

/**
 * Trigger a manual refresh on the backend.
 */
export async function refreshBackend(source) {
  const res = await fetch(`${API_BASE}/providers/${source}/refresh`, { method: 'POST', credentials: 'same-origin' });
  if (res.status === 401) { if (onAuthFail) onAuthFail(); throw new Error('Session expired'); }
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `API error: ${res.status}`); }
  return res.json();
}

export async function fetchWatchlist() { return fetchJSON(`${API_BASE}/watchlist`); }
export async function addWatchlist(poolId) {
  const res = await fetch(`${API_BASE}/watchlist`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ poolId }) });
  if (!res.ok) throw new Error('Could not add favorite');
  return res.json();
}
export async function removeWatchlist(poolId) {
  const res = await fetch(`${API_BASE}/watchlist/${encodeURIComponent(poolId)}`, { method: 'DELETE', credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not remove favorite');
  return res.json();
}
export async function comparePools(poolIds) { return fetchJSON(`${API_BASE}/compare?poolIds=${poolIds.map(encodeURIComponent).join(',')}`); }

/**
 * Get backend cache status.
 */
export async function fetchStatus() {
  return fetchJSON(`${API_BASE}/status`);
}

/**
 * Analyze a pool: get holders and pool info.
 */
export async function analyzePool(chainId, address) {
  return fetchJSON(`${API_BASE}/pool-analysis?chainId=${chainId}&address=${encodeURIComponent(address)}`);
}

// ── DeFiLlama price charts (still client-side) ──

const priceCache = new Map();

export function getExoticToken(pool) {
  for (const u of pool.underlying) {
    if (!MAJOR_TOKENS.includes(u.symbol)) return u;
  }
  return pool.underlying[1] || pool.underlying[0] || null;
}

export async function getTokenPriceHistory(chainId, tokenAddress, spanHours = 24) {
  const chainName = CHAINS[chainId]?.defiLlamaChain;
  if (!chainName || !tokenAddress) return [];

  const cacheKey = `${chainId}-${tokenAddress}-${spanHours}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey);

  const attempts = [];
  if (spanHours <= 1) {
    attempts.push({ span: 1, period: '5m' }, { span: 2, period: '15m' }, { span: 4, period: '1h' });
  } else if (spanHours <= 24) {
    attempts.push({ span: 24, period: '1h' }, { span: 48, period: '1h' }, { span: 24, period: '4h' }, { span: 72, period: '4h' });
  } else {
    attempts.push({ span: 168, period: '4h' }, { span: 168, period: '1d' }, { span: 720, period: '1d' });
  }

  for (const { span, period } of attempts) {
    try {
      const res = await fetch(
        `https://coins.llama.fi/chart/${chainName}:${tokenAddress}?span=${span}&period=${period}`
      );
      if (!res.ok) continue;
      const data = await res.json();
      const coinKey = `${chainName}:${tokenAddress}`;
      const coinData = data.coins?.[coinKey];
      if (!coinData?.prices?.length) continue;
      const cutoff = Date.now() / 1000 - spanHours * 3600;
      const prices = coinData.prices
        .filter((p) => p.price && p.price > 0 && p.timestamp >= cutoff)
        .map((p) => ({ time: p.timestamp, price: p.price }))
        .sort((a, b) => a.time - b.time);
      if (prices.length >= 2) {
        priceCache.set(cacheKey, prices);
        return prices;
      }
    } catch { continue; }
  }
  return [];
}

export const TIMEFRAMES = {
  hour: '1h',
  day: '24h',
  week: '7d',
};
