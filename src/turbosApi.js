// ── Turbos Finance API (Sui CL pools) ──
const TURBOS_BASE = 'https://api2.turbos.finance/pools';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Parse a Turbos Finance pool into normalized format.
 */
export function parseTurbosPool(raw) {
  const tickSpacing = Number(raw.tick_spacing || 0);
  if (tickSpacing <= 0) return null;

  const tvl = raw.liquidity_usd || 0;
  const apr = Number(raw.apr || 0);
  const feeApr = Number(raw.fee_apr || 0);
  const rewardApr = Number(raw.reward_apr || 0);
  const apr7d = Number(raw.apr_7d || 0);

  // Check active rewards
  const rewardInfos = raw.reward_infos || [];
  const activeRewards = rewardInfos.filter((r) =>
    Number(r.emissions_per_second || 0) > 0
  );

  const hasRealRewards = activeRewards.length > 0 || rewardApr > 0;

  // Extract reward token symbols from vault_coin_type
  const rewardTokens = activeRewards.length > 0
    ? activeRewards.map((r) => {
        const vct = r.vault_coin_type || '';
        // Extract last segment after :: e.g. "...::sui::SUI" -> "SUI"
        const parts = vct.split('::');
        return parts.length > 1 ? parts[parts.length - 1] : vct.slice(-8);
      }).join(', ')
    : '(fees only)';

  // Fee in bps -> percentage (100 = 1%)
  const feeBps = Number(raw.fee || 0);
  const feePct = feeBps / 100;

  // Range % from tickSpacing
  const rangePct = parseFloat(((1.0001 ** tickSpacing - 1) * 100).toFixed(2));

  const pair = `${raw.coin_symbol_a || '?'}/${raw.coin_symbol_b || '?'}`;

  return {
    id: `turbos-${raw.id}`,
    protocol: 'Turbos Finance',
    type: raw.type || '',
    pair,
    chain: 'Sui',
    poolAddr: raw.pool_id || '',
    tickSpacing,
    rangePct,
    feePct,
    tvl,
    apr: parseFloat(apr.toFixed(2)),
    feeApr: parseFloat(feeApr.toFixed(2)),
    rewardApr: parseFloat(rewardApr.toFixed(2)),
    apr7d: parseFloat(apr7d.toFixed(2)),
    hasRealRewards,
    rewardTokens,
    volume24h: Number(raw.volume_24h_usd || 0),
    volume7d: Number(raw.volume_7d_usd || 0),
    liquidity: Number(raw.liquidity || 0),
    unlocked: raw.unlocked !== false,
    underlying: [
      { symbol: raw.coin_symbol_a || '', address: raw.coin_type_a || '' },
      { symbol: raw.coin_symbol_b || '', address: raw.coin_type_b || '' },
    ],
  };
}

/**
 * Fetch Turbos Finance CL pools (paginated).
 */
export async function fetchTurbosPools(maxPages = 7) {
  const allPools = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = `${TURBOS_BASE}?page=${page}&pageSize=100&sort=volume_24h_usd&includeRisky=false&direction=desc&includeLowLiquidity=false`;
      const data = await fetchJSON(url);
      const pools = data?.result || [];

      if (pools.length === 0) break;

      for (const raw of pools) {
        const pool = parseTurbosPool(raw);
        if (pool) allPools.push(pool);
      }

      const total = data?.total || 0;
      if (page * 100 >= total) break;
    } catch (err) {
      console.error(`Turbos page ${page} error:`, err);
    }

    if (page < maxPages) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return allPools;
}
