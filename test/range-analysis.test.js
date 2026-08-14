import { describe, expect, it } from 'vitest';
import { analyzeBestPriceRange } from '../src/rangeAnalysis.js';

const hourly = (prices) => prices.map((price, index) => ({ time: 1_800_000_000 + index * 3600, price }));

describe('best price range analysis', () => {
  it('finds the densest percentage window and stable occupancy', () => {
    const result = analyzeBestPriceRange(hourly([100, 100.1, 100.2, 100.25, 100.3, 100.2]), 0.6, 24);
    expect(result.occupancyPct).toBe(100);
    expect(result.currentInside).toBe(true);
    expect(result.stability).toBe('stable');
  });

  it('flags a trending price outside the best historical cluster', () => {
    const result = analyzeBestPriceRange(hourly([100, 100.1, 100.2, 100.1, 103, 106]), 0.6, 24);
    expect(result.currentInside).toBe(false);
    expect(result.distancePct).toBeGreaterThan(5);
    expect(result.stability).toBe('unstable');
    expect(result.exits).toBe(1);
  });

  it('returns null without enough valid prices', () => {
    expect(analyzeBestPriceRange([{ time: 1, price: 1 }])).toBeNull();
  });
});
