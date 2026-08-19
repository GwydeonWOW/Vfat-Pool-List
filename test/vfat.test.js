import { describe, expect, it } from 'vitest';
import { vfatPoolIdentity } from '../lib/vfat.js';

describe('VFat pool identity', () => {
  it('uses the pool hash to distinguish Uniswap V4 pools sharing one manager', () => {
    const base = { chainId: 4663, address: '0xmanager', type: 'UNISWAP_V4', pool: { address: '0xmanager' } };
    const first = vfatPoolIdentity({ ...base, pool: { ...base.pool, poolId: '0xhash1' } });
    const second = vfatPoolIdentity({ ...base, pool: { ...base.pool, poolId: '0xhash2' } });
    expect(first.id).not.toBe(second.id);
    expect(first.poolId).toBe('0xhash1');
  });
});
