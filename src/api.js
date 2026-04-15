// ── Frontend API - calls local backend ──

const API_BASE = '/api';
const TOKEN_KEY = 'vfat_token';

let onAuthFail = null;

export function setOnAuthFail(cb) {
  onAuthFail = cb;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function fetchJSON(url) {
  const token = getToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    if (onAuthFail) onAuthFail();
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Chain ID -> { name, defiLlamaChain }
export const CHAINS = {
  8453: { name: 'Base', defiLlamaChain: 'base' },
  56: { name: 'BSC', defiLlamaChain: 'bsc' },
  43114: { name: 'Avalanche', defiLlamaChain: 'avax' },
  137: { name: 'Polygon', defiLlamaChain: 'polygon' },
  10: { name: 'Optimism', defiLlamaChain: 'optimism' },
  146: { name: 'Sonic', defiLlamaChain: 'sonic' },
  999: { name: 'Hype', defiLlamaChain: 'hyperliquid' },
  143: { name: 'Monad', defiLlamaChain: 'monad' },
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
  return fetchJSON(`${API_BASE}/refresh/${source}`);
}

/**
 * Get backend cache status.
 */
export async function fetchStatus() {
  return fetchJSON(`${API_BASE}/status`);
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

// ── RSI calculation ──

export function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(1));
}

export async function fetchRSI(chainId, tokenAddress) {
  const prices = await getTokenPriceHistory(chainId, tokenAddress, 24);
  if (prices.length < 15) return null;
  return calcRSI(prices.map((p) => p.price), 14);
}

export async function batchFetchRSI(pools, maxConcurrent = 3) {
  const rsiMap = new Map();
  const exotic = {};
  const seen = new Set();
  for (const p of pools) {
    const token = getExoticToken(p);
    if (!token?.address) continue;
    const key = `${p.chainId}-${token.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    exotic[p.id] = { chainId: p.chainId, address: token.address, key };
  }
  const entries = Object.entries(exotic);
  let i = 0;
  async function processNext() {
    while (i < entries.length) {
      const [poolId, info] = entries[i++];
      try {
        const rsi = await fetchRSI(info.chainId, info.address);
        if (rsi !== null) rsiMap.set(poolId, rsi);
      } catch { /* skip */ }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const workers = Array.from({ length: Math.min(maxConcurrent, entries.length) }, () => processNext());
  await Promise.all(workers);
  return rsiMap;
}
