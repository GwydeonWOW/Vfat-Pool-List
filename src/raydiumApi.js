// ── Raydium API (Solana CL pools) ──
const RAYDIUM_BASE = 'https://api-v3.raydium.io/pools/info/list';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Parse a Raydium pool into normalized format.
 */
export function parseRaydiumPool(raw) {
  const mintA = raw.mintA || {};
  const mintB = raw.mintB || {};
  const config = raw.config || {};
  const week = raw.week || {};
  const day = raw.day || {};

  const tickSpacing = config.tickSpacing;
  if (!tickSpacing || tickSpacing <= 0) return null;

  const tvl = raw.tvl || 0;
  const apr = week.apr || day.apr || 0;
  const feeApr = week.feeApr || day.feeApr || 0;
  const rewardAprs = week.rewardApr || day.rewardApr || [];

  // Calculate total reward APR
  const totalRewardApr = rewardAprs.reduce((s, r) => s + (r || 0), 0);

  // Check for active rewards (farm ongoing or rewardApr > 0)
  const rewardInfos = raw.rewardDefaultInfos || [];
  const activeRewards = rewardInfos.filter((r) => {
    const perSec = Number(r.perSecond || 0);
    return perSec > 0;
  });

  const hasRealRewards = activeRewards.length > 0 || totalRewardApr > 0;

  const rewardTokens = activeRewards.length > 0
    ? [...new Set(activeRewards.map((r) => r.mint?.symbol || '?'))].join(', ')
    : '(fees only)';

  // Range % from tickSpacing
  const rangePct = parseFloat(((1.0001 ** tickSpacing - 1) * 100).toFixed(2));

  // Price range
  const price = raw.price || 0;
  const priceMin = week.priceMin || 0;
  const priceMax = week.priceMax || 0;

  // Fee rate as percentage
  const feeRate = raw.feeRate || 0;
  const feePct = feeRate * 100;

  const pair = `${mintA.symbol || '?'}/${mintB.symbol || '?'}`;
  const farmCount = raw.farmOngoingCount || 0;

  return {
    id: raw.id,
    protocol: 'Raydium',
    type: raw.type || '',
    pair,
    chain: 'Solana',
    poolAddr: raw.id,
    tickSpacing,
    rangePct,
    feePct,
    tvl,
    apr: parseFloat(apr.toFixed(2)),
    feeApr: parseFloat(feeApr.toFixed(2)),
    rewardApr: parseFloat(totalRewardApr.toFixed(2)),
    hasRealRewards,
    rewardTokens,
    price,
    priceMin,
    priceMax,
    farmCount,
    volume24h: day.volume || 0,
    volume7d: week.volume || 0,
    underlying: [
      { symbol: mintA.symbol || '', address: mintA.address || '', price: mintA.price || 0 },
      { symbol: mintB.symbol || '', address: mintB.address || '', price: mintB.price || 0 },
    ],
  };
}

/**
 * Fetch Raydium concentrated liquidity pools (paginated).
 */
export async function fetchRaydiumPools(poolType = 'concentrated', maxPages = 5) {
  const allPools = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = `${RAYDIUM_BASE}?poolType=${poolType}&poolSortField=default&sortType=desc&pageSize=1000&page=${page}`;
      const data = await fetchJSON(url);
      const pools = data?.data?.data || [];

      if (pools.length === 0) break;

      for (const raw of pools) {
        const pool = parseRaydiumPool(raw);
        if (pool) allPools.push(pool);
      }

      if (!data?.data?.hasNextPage) break;
    } catch (err) {
      console.error(`Raydium page ${page} error:`, err);
    }

    // Small delay between pages
    if (page < maxPages) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return allPools;
}
