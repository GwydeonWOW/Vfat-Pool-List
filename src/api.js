// ── VFat API (pool listing) ──
const VFAT_BASE = 'https://api.vfat.io/v4/farms';

// Chain ID -> { name, defiLlamaChain }
export const CHAINS = {
  8453: { name: 'Base', defiLlamaChain: 'base' },
  56: { name: 'BSC', defiLlamaChain: 'bsc' },
  1: { name: 'Ethereum', defiLlamaChain: 'ethereum' },
  42161: { name: 'Arbitrum', defiLlamaChain: 'arbitrum' },
  137: { name: 'Polygon', defiLlamaChain: 'polygon' },
  10: { name: 'Optimism', defiLlamaChain: 'optimism' },
  43114: { name: 'Avalanche', defiLlamaChain: 'avax' },
  250: { name: 'Fantom', defiLlamaChain: 'fantom' },
  59144: { name: 'Linea', defiLlamaChain: 'linea' },
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
  for (const r of farm.rewards || []) {
    if (r.rewardsPerSecond !== '0') {
      rewardSyms.push(r.rewardToken?.symbol || '?');
    }
  }

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
