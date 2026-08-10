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
      expect(score.total).toBeLessThanOrEqual(100);
      expect(score.version).toBe('2.0');
    }
  });

  it('marks a cold-start pool provisional', () => {
    expect(calculateRiskScores({ tvl: 1000, apr: 10 }, []).balanced.provisional).toBe(true);
  });

  it('never promotes a pool capped below the $30 daily target', () => {
    const lowCapacity = calculateRiskScores({ chainId: 8453, tvl: 50000, apr: 6000, maxApr: 6000, rewardsWeek: 175, rangePct: 2, inRangeRatio: 80 }, []).balanced;
    const profitable = calculateRiskScores({ chainId: 56, tvl: 50000, apr: 5000, maxApr: 5000, rewardsWeek: 1050, rangePct: 2, inRangeRatio: 35 }, []).balanced;
    expect(lowCapacity.poolRewardsDaily).toBe(25);
    expect(lowCapacity.meetsTarget).toBe(false);
    expect(lowCapacity.total).toBeLessThan(50);
    expect(profitable.estimatedNetDaily).toBeGreaterThan(30);
    expect(profitable.total).toBeGreaterThan(lowCapacity.total);
  });
});
