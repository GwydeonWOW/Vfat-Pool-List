import { describe, expect, it } from 'vitest';
import { normalizeUp33Pool } from '../lib/up33.js';

describe('UP33 adapter', () => {
  it('derives 24h fee APR and CL range from the public subgraph', () => {
    const pool = normalizeUp33Pool({
      id: '0xpool', tickSpacing: '60', tick: '10', totalValueLockedUSD: '10000',
      token0: { id: '0xa', symbol: 'WETH' }, token1: { id: '0xb', symbol: 'UP' },
    }, [{ volumeUSD: '1000', feesUSD: '3' }, { volumeUSD: '2000', feesUSD: '6' }]);
    expect(pool.pair).toBe('WETH/UP');
    expect(pool.volume24h).toBe(3000);
    expect(pool.fees24h).toBe(9);
    expect(pool.apr).toBeCloseTo(32.85, 2);
    expect(pool.rangePct).toBeCloseTo(0.6, 2);
  });
});
