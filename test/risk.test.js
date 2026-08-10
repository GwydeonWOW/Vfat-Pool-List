import { describe, expect, it } from 'vitest';
import { calculateRiskScores, PROFILE_ASSUMPTIONS } from '../lib/risk.js';

describe('risk score', () => {
  it('returns bounded, versioned scores for every profile', () => {
    const now = Date.now();
    const history = Array.from({ length: 10 }, (_, i) => ({ timestamp: now - (9 - i) * 86400000, tvl: 100000 + i * 100, apr: 40 + i, price: 1 + i / 100 }));
    const result = calculateRiskScores({ tvl: 100000, apr: 50, feeApr: 30, volume24h: 50000 }, history, now);
    expect(Object.keys(result)).toEqual(Object.keys(PROFILE_ASSUMPTIONS));
    for (const score of Object.values(result)) {
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.version).toBe('2.1');
    }
  });

  it('marks a cold-start pool provisional', () => {
    expect(calculateRiskScores({ tvl: 1000, apr: 10 }, []).balanced.provisional).toBe(true);
  });

  it('never promotes a pool capped below the $30 daily target', () => {
    const lowCapacity = calculateRiskScores({ chainId: 8453, tvl: 50000, apr: 6000, maxApr: 6000, rewardsWeek: 175, inRangeLiquidity: 100, rangePct: 2, inRangeRatio: 80 }, []).balanced;
    const profitable = calculateRiskScores({ chainId: 56, tvl: 50000, apr: 5000, maxApr: 5000, rewardsWeek: 1440, inRangeLiquidity: 588, rangePct: 2, inRangeRatio: 35 }, []).balanced;
    expect(lowCapacity.poolRewardsDaily).toBe(25);
    expect(lowCapacity.meetsTarget).toBe(false);
    expect(lowCapacity.total).toBeLessThan(100);
    expect(profitable.estimatedNetDaily).toBeGreaterThan(30);
    expect(profitable.total).toBeGreaterThan(100);
    expect(profitable.total).toBeGreaterThan(lowCapacity.total);
  });

  it('uses an open scale to distinguish pools above the target', () => {
    const base = { chainId: 56, tvl: 50000, maxApr: 20000, rewardsWeek: 10000, inRangeLiquidity: 100, rangePct: 2, inRangeRatio: 50 };
    const atTarget = calculateRiskScores({ ...base, maxApr: 4000 }, []).aggressive;
    const high = calculateRiskScores(base, []).aggressive;
    expect(high.total).toBeGreaterThan(100);
    expect(high.total).toBeGreaterThan(atTarget.total);
  });

  it('prioritizes CL-named farms without promoting an unprofitable pool above 100', () => {
    const base = { chainId: 8453, tvl: 50000, maxApr: 9000, rewardsWeek: 1500, inRangeLiquidity: 500, rangePct: 2, inRangeRatio: 50 };
    const regular = calculateRiskScores({ ...base, vfname: 'WETH/TOKEN' }, []).balanced;
    const concentrated = calculateRiskScores({ ...base, vfname: 'CL200-WETH/TOKEN' }, []).balanced;
    expect(concentrated.concentratedFarmBonus).toBe(12);
    expect(concentrated.total).toBeGreaterThan(regular.total);

    const weak = calculateRiskScores({ ...base, vfname: 'CL200-WETH/TOKEN', maxApr: 100, rewardsWeek: 10 }, []).balanced;
    expect(weak.total).toBeLessThan(100);
  });

  it('limits max APR by the position share of rewarded liquidity', () => {
    const result = calculateRiskScores({ chainId: 8453, type: 'AERO_SLIPSTREAM_GAUGE', tvl: 27214, apr: 232.5, maxApr: 8937, rewardsWeek: 1005, realRewardsWeek: 1005, feesWeek: 0, rewardedLiquidity: 586, rangePct: 2, inRangeRatio: 2.2 }, []).balanced;
    expect(result.estimatedPositionShare).toBeCloseTo(40.57, 1);
    expect(result.estimatedGrossDaily).toBeLessThan(50);
    expect(result.estimatedGrossDaily).toBeGreaterThan(0);
    expect(result.poolFeesDaily).toBe(0);
    expect(result.poolIncentivesDaily).toBeGreaterThan(140);
    expect(result.incentiveDependent).toBe(true);
  });
});
