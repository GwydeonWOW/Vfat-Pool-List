import { describe, expect, it } from 'vitest';
import { calculateRiskScores, PROFILE_WEIGHTS } from '../lib/risk.js';

describe('risk score', () => {
  it('returns bounded, versioned scores for every profile', () => {
    const now = Date.now();
    const history = Array.from({ length: 10 }, (_, i) => ({ timestamp: now - (9 - i) * 86400000, tvl: 100000 + i * 100, apr: 40 + i, price: 1 + i / 100 }));
    const result = calculateRiskScores({ tvl: 100000, apr: 50, feeApr: 30, volume24h: 50000 }, history, now);
    expect(Object.keys(result)).toEqual(Object.keys(PROFILE_WEIGHTS));
    for (const score of Object.values(result)) {
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(100);
      expect(score.version).toBe('1.0');
    }
  });

  it('marks a cold-start pool provisional', () => {
    expect(calculateRiskScores({ tvl: 1000, apr: 10 }, []).balanced.provisional).toBe(true);
  });
});
