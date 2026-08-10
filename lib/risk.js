export const RISK_VERSION = '2.1';
export const DEFAULT_CAPITAL = 400;
export const DAILY_PROFIT_TARGET = 30;

export const PROFILE_ASSUMPTIONS = {
  conservative: { realization: 0.65, exitMultiplier: 1.3, slippageBps: 45 },
  balanced: { realization: 0.78, exitMultiplier: 1, slippageBps: 35 },
  aggressive: { realization: 0.9, exitMultiplier: 0.75, slippageBps: 25 },
};

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const CHAIN_GAS_USD = { 1: 5, 10: 0.12, 56: 0.15, 137: 0.08, 143: 0.08, 146: 0.05, 999: 0.1, 8453: 0.12, 43114: 0.2 };

function estimateExitsPerDay(pool, history, now) {
  const prices = history.filter(x => x.timestamp && now - x.timestamp <= 7 * 86400000 && Number(x.price) > 0);
  if (prices.length >= 4) {
    const elapsedDays = Math.max((prices.at(-1).timestamp - prices[0].timestamp) / 86400000, 1 / 24);
    const pathPct = prices.slice(1).reduce((sum, row, i) => sum + Math.abs(Math.log(row.price / prices[i].price)) * 100, 0) / elapsedDays;
    return clamp(pathPct / Math.max(Number(pool.rangePct) || 0.25, 0.25) * 0.5, 0, 12);
  }
  if (Number.isFinite(Number(pool.inRangeRatio))) {
    return clamp(0.5 + (100 - Number(pool.inRangeRatio)) / 20, 0.5, 6);
  }
  return 2;
}

function gasCost(pool) {
  if (pool.chain === 'solana') return 0.02;
  if (pool.chain === 'sui') return 0.03;
  return CHAIN_GAS_USD[pool.chainId] ?? 0.5;
}

export function calculateRiskScores(pool, history = [], now = Date.now(), capital = DEFAULT_CAPITAL, target = DAILY_PROFIT_TARGET) {
  const positionCapital = Math.max(1, Number(capital) || DEFAULT_CAPITAL);
  const dailyTarget = Math.max(1, Number(target) || DAILY_PROFIT_TARGET);
  const potentialApr = Math.max(Number(pool.maxApr) || 0, Number(pool.apr) || 0);
  const aprGrossDaily = positionCapital * potentialApr / 36500;
  const poolRewardsDaily = Number(pool.rewardsWeek) > 0 ? Number(pool.rewardsWeek) / 7 : null;
  const poolIncentivesDaily = Number(pool.realRewardsWeek) > 0 ? Number(pool.realRewardsWeek) / 7 : 0;
  const poolFeesDaily = Number(pool.feesWeek) > 0 ? Number(pool.feesWeek) / 7 : 0;
  const isPancakeV3 = pool.type === 'PANCAKE_SWAP_V3';
  const competitionLiquidity = Number(pool.rewardedLiquidity) > 0
    ? Number(pool.rewardedLiquidity)
    : Number(pool.inRangeLiquidity) > 0
      ? Number(pool.inRangeLiquidity) * (isPancakeV3 ? 0.4 : 1)
      : Number(pool.activeLiquidity) || Number(pool.tvl) || 0;
  const estimatedPositionShare = competitionLiquidity > 0
    ? positionCapital / (competitionLiquidity + positionCapital)
    : 0;
  const shareLimitedGross = poolRewardsDaily == null ? aprGrossDaily : poolRewardsDaily * estimatedPositionShare;
  const capacityLimitedGross = pool.isKilled ? 0 : Math.min(aprGrossDaily, shareLimitedGross);
  const baseExits = estimateExitsPerDay(pool, history, now);
  const validHistory = history.filter(x => x.timestamp && now - x.timestamp <= 30 * 86400000);
  const historyDays = validHistory.length ? (now - validHistory[0].timestamp) / 86400000 : 0;
  const dataConfidence = clamp(25 + Math.min(historyDays / 7, 1) * 50 + (poolRewardsDaily != null ? 25 : 0));
  const liquidityShare = positionCapital / Math.max(Number(pool.tvl) || positionCapital, positionCapital);
  const liquidityPenalty = liquidityShare > 0.1 ? clamp((liquidityShare - 0.1) * 150) : 0;

  const scores = {};
  for (const [profile, assumptions] of Object.entries(PROFILE_ASSUMPTIONS)) {
    const exitsPerDay = baseExits * assumptions.exitMultiplier;
    const costPerExit = gasCost(pool) + positionCapital * assumptions.slippageBps / 10000;
    const rebalanceCostDaily = exitsPerDay * costPerExit;
    const downtimeFraction = clamp(exitsPerDay * 12 / 1440, 0, 0.25);
    const realizedGrossDaily = capacityLimitedGross * assumptions.realization * (1 - downtimeFraction);
    const netDaily = Math.max(0, realizedGrossDaily - rebalanceCostDaily);
    const meetsTarget = netDaily >= dailyTarget;
    // Open-ended scale: 100 = target, 150 ≈ 2x target, 200 ≈ 4x target.
    // Below target, the score remains in the 0-99 range.
    const opportunityScore = meetsTarget
      ? 100 + 50 * Math.log2(netDaily / dailyTarget) + dataConfidence / 20
      : clamp(netDaily / dailyTarget * 99, 0, 99);
    const adjustedScore = opportunityScore - liquidityPenalty;
    const total = meetsTarget ? Math.max(100, adjustedScore) : clamp(adjustedScore, 0, 99);

    scores[profile] = {
      total: Number(total.toFixed(2)),
      estimatedNetDaily: Number(netDaily.toFixed(2)),
      estimatedGrossDaily: Number(realizedGrossDaily.toFixed(2)),
      poolRewardsDaily: poolRewardsDaily == null ? null : Number(poolRewardsDaily.toFixed(2)),
      poolIncentivesDaily: Number(poolIncentivesDaily.toFixed(2)),
      poolFeesDaily: Number(poolFeesDaily.toFixed(2)),
      incentiveDependent: poolIncentivesDaily > 0 && poolFeesDaily === 0,
      estimatedPositionShare: Number((estimatedPositionShare * 100).toFixed(2)),
      competitionLiquidity: Number(competitionLiquidity.toFixed(2)),
      estimatedExitsPerDay: Number(exitsPerDay.toFixed(1)),
      rebalanceCostDaily: Number(rebalanceCostDaily.toFixed(2)),
      potentialApr: Number(potentialApr.toFixed(2)),
      capital: positionCapital,
      target: dailyTarget,
      meetsTarget,
      confidence: Number(dataConfidence.toFixed(1)),
      provisional: historyDays < 1,
      components: { opportunity: Number(opportunityScore.toFixed(1)), liquidityPenalty: Number(liquidityPenalty.toFixed(1)), realization: assumptions.realization * 100, positionShare: Number((estimatedPositionShare * 100).toFixed(2)) },
      version: RISK_VERSION,
    };
  }
  return scores;
}
