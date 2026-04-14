// ── VFat API (pool listing) ──
const VFAT_BASE = 'https://api.vfat.io/v4/farms';

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

export const CL_TYPES = [
  'AERO_SLIPSTREAM_GAUGE',
  'PANCAKE_SWAP_V3',
  'UNISWAP_V3',
  'UNISWAP_V4',
  'THENA_V3',
  'BMX_V4_FARM',
];

export const MAJOR_TOKENS = [
  'WETH', 'ETH', 'USDC', 'USDT', 'WBTC', 'cbBTC', 'tBTC', 'BTCB',
  'WBNB', 'BNB', 'DAI', 'USD1',
];

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Fetch farms from VFat API for a given chain.
 * Returns raw array of farm objects.
 */
export async function fetchVFatFarms(chainId) {
  return fetchJSON(`${VFAT_BASE}?chainId=${chainId}`);
}

/**
 * Parse a VFat farm into a normalized CL pool object.
 * Returns null if not a CL pool or doesn't meet criteria.
 */
export function parsePool(farm, clTypes = CL_TYPES) {
  const ftype = farm.type || '';
  if (!clTypes.includes(ftype)) return null;

  const pool = farm.pool || {};
  const snap = farm.snapshot || {};
  const tickSpacing = pool.tickSpacing;

  if (!tickSpacing || tickSpacing <= 0) return null;

  const apr = snap.apr;
  if (apr == null || apr <= 0) return null;

  const poolLiq = snap.poolLiquidity || 0;
  const inRangeLiq = snap.inRangeLiquidity || 0;
  const activeLiq = snap.activeLiquidity || 0;
  const inRangeRatio = poolLiq > 0 ? (inRangeLiq / poolLiq * 100) : 0;

  const underlying = pool.underlying || [];
  const symbols = underlying.map((u) => u.symbol || '');
  const stakingApr = snap.stakingApr || 0;
  const lpApr = snap.lpApr || 0;
  const maxApr = snap.maxApr || 0;
  const rewardsWeek = snap.rewardsPerWeek || 0;

  const rewardSyms = [];
  let realRewardsWeek = 0;
  for (const r of farm.rewards || []) {
    const rps = r.rewardsPerSecond;
    if (rps && rps !== '0' && rps !== 0) {
      const token = r.rewardToken || {};
      const price = token.price || 0;
      const decimals = token.decimals || 18;
      const weeklyAmount = (Number(rps) / (10 ** decimals)) * price * 604800;
      realRewardsWeek += weeklyAmount;
      rewardSyms.push(token.symbol || '?');
    }
  }
  const hasRealRewards = realRewardsWeek > 0;
  const feesWeek = Math.max(0, rewardsWeek - realRewardsWeek);

  const protocol = farm.protocol?.name || '?';

  // Range percentage from tick spacing
  const rangePct = parseFloat(((1.0001 ** tickSpacing - 1) * 100).toFixed(2));

  // Build display name
  const pair = symbols.join('/');
  let vfname = pair;
  if (ftype === 'AERO_SLIPSTREAM_GAUGE') vfname = `CL${tickSpacing}-${pair}`;
  else if (ftype === 'PANCAKE_SWAP_V3') vfname = `${pair} (PCS V3)`;
  else if (ftype === 'UNISWAP_V3') vfname = `${pair} (Uni V3)`;
  else if (ftype === 'UNISWAP_V4') vfname = `${pair} (Uni V4)`;
  else if (ftype === 'THENA_V3') vfname = `${pair} (Thena)`;
  else if (ftype === 'BMX_V4_FARM') vfname = `${pair} (BMX V4)`;

  return {
    id: `${farm.chainId}-${farm.address}`,
    chainId: farm.chainId,
    protocol,
    type: ftype,
    pair,
    vfname,
    poolAddr: pool.address,
    farmAddr: farm.address,
    tickSpacing,
    rangePct,
    fee: pool.fee,
    currentFee: pool.currentFee,
    apr: parseFloat(apr.toFixed(2)),
    stakingApr: parseFloat(stakingApr.toFixed(2)),
    lpApr: parseFloat((lpApr || 0).toFixed(2)),
    maxApr: parseFloat((maxApr || 0).toFixed(2)),
    tvl: parseFloat(poolLiq.toFixed(2)),
    inRangeLiquidity: parseFloat(inRangeLiq.toFixed(2)),
    inRangeRatio: parseFloat(inRangeRatio.toFixed(1)),
    activeLiquidity: parseFloat(activeLiq.toFixed(2)),
    rewardsWeek: parseFloat(rewardsWeek.toFixed(2)),
    realRewardsWeek: parseFloat(realRewardsWeek.toFixed(2)),
    feesWeek: parseFloat(feesWeek.toFixed(2)),
    hasRealRewards,
    rewardTokens: rewardSyms.length > 0 ? [...new Set(rewardSyms)].sort().join(', ') : '(fees only)',
    hasGauge: stakingApr > 0,
    underlying: underlying.map((u) => ({
      symbol: u.symbol || '',
      address: u.address || '',
      price: u.price || 0,
      name: u.name || '',
    })),
  };
}

/**
 * Fetch all CL pools for multiple chains from VFat.
 */
export async function fetchAllPools(chainIds, clTypes = CL_TYPES) {
  const allPools = [];

  for (const chainId of chainIds) {
    try {
      const farms = await fetchVFatFarms(chainId);
      for (const farm of farms) {
        const pool = parsePool(farm, clTypes);
        if (pool) allPools.push(pool);
      }
    } catch (err) {
      console.error(`Error fetching chain ${chainId}:`, err);
    }
  }

  return allPools;
}

// ── DeFiLlama price charts ──

const priceCache = new Map();

/**
 * Find the "exotic" (non-major) token in a pool.
 */
export function getExoticToken(pool) {
  for (const u of pool.underlying) {
    if (!MAJOR_TOKENS.includes(u.symbol)) return u;
  }
  return pool.underlying[1] || pool.underlying[0] || null;
}

/**
 * Fetch token price history from DeFiLlama.
 * Tries multiple period/span combos if the first returns no data.
 * Returns array of { time, price } sorted by time.
 */
export async function getTokenPriceHistory(chainId, tokenAddress, spanHours = 24) {
  const chainName = CHAINS[chainId]?.defiLlamaChain;
  if (!chainName || !tokenAddress) return [];

  const cacheKey = `${chainId}-${tokenAddress}-${spanHours}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey);

  // Try different period/span combos, from most granular to least
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

      // Filter to only the requested time range
      const cutoff = Date.now() / 1000 - spanHours * 3600;
      const prices = coinData.prices
        .filter((p) => p.price && p.price > 0 && p.timestamp >= cutoff)
        .map((p) => ({ time: p.timestamp, price: p.price }))
        .sort((a, b) => a.time - b.time);

      if (prices.length >= 2) {
        priceCache.set(cacheKey, prices);
        return prices;
      }
    } catch {
      continue;
    }
  }

  return [];
}

export const TIMEFRAMES = {
  hour: '1h',
  day: '24h',
  week: '7d',
};

// ── RSI calculation ──

/**
 * Calculate RSI from price array.
 * @param {number[]} prices - array of prices (chronological order)
 * @param {number} period - RSI period (default 14)
 * @returns {number|null} RSI value (0-100) or null if not enough data
 */
export function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed averages for remaining data
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

/**
 * Fetch RSI for a pool's exotic token using 24h price data.
 * Returns RSI value (0-100) or null.
 */
export async function fetchRSI(chainId, tokenAddress) {
  const prices = await getTokenPriceHistory(chainId, tokenAddress, 24);
  if (prices.length < 15) return null;
  const priceValues = prices.map((p) => p.price);
  return calcRSI(priceValues, 14);
}

/**
 * Batch fetch RSI for multiple pools (with rate limiting).
 * Returns Map of poolId -> rsi.
 */
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
      } catch {
        // skip
      }
      // Small delay to avoid hammering DeFiLlama
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrent, entries.length) }, () => processNext());
  await Promise.all(workers);
  return rsiMap;
}
