export function normalizeUp33Pool(pool, hourlyRows = []) {
  const tvl = Number(pool.totalValueLockedUSD || 0);
  const volume24h = hourlyRows.reduce((sum, row) => sum + Number(row.volumeUSD || 0), 0);
  const fees24h = hourlyRows.reduce((sum, row) => sum + Number(row.feesUSD || 0), 0);
  const feeApr = tvl > 0 ? fees24h / tvl * 365 * 100 : 0;
  const feePct = volume24h > 0 ? fees24h / volume24h * 100 : 0;
  const tickSpacing = Number(pool.tickSpacing || 0);
  const token0 = pool.token0 || {};
  const token1 = pool.token1 || {};
  return {
    address: pool.id,
    chainId: 4663,
    chain: 'robinhood',
    protocol: 'UP33',
    type: 'UP33_CL',
    pair: `${token0.symbol || '?'}/${token1.symbol || '?'}`,
    underlying: [token0, token1].map((token) => ({
      symbol: token.symbol || '?', address: token.id || '', name: token.name || '', price: 0,
    })),
    tickSpacing,
    currentTick: Number(pool.tick || 0),
    sqrtPrice: pool.sqrtPrice || null,
    rangePct: Number(((1.0001 ** tickSpacing - 1) * 100).toFixed(2)),
    tvl: Number(tvl.toFixed(2)),
    apr: Number(feeApr.toFixed(2)),
    feeApr: Number(feeApr.toFixed(2)),
    rewardApr: 0,
    feesWeek: Number((fees24h * 7).toFixed(2)),
    rewardsWeek: Number((fees24h * 7).toFixed(2)),
    realRewardsWeek: 0,
    hasRealRewards: false,
    volume24h: Number(volume24h.toFixed(2)),
    fees24h: Number(fees24h.toFixed(2)),
    feePct: Number(feePct.toFixed(4)),
    dataQuality: hourlyRows.length >= 20 ? 'verified' : 'partial',
  };
}
