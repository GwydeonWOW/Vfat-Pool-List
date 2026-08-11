import { describe, expect, it } from 'vitest';
import { calculateTokenRisk, isCoreToken } from '../lib/token-risk.js';

describe('token risk warnings', () => {
  it('ignores core assets', () => {
    expect(isCoreToken('WBNB')).toBe(true);
    expect(calculateTokenRisk({ underlying: [{ symbol: 'USDT' }, { symbol: 'WETH' }] }).warnings).toEqual([]);
  });

  it('flags a 60% move within six hours as high risk', () => {
    const now = Date.now();
    const pool = { price: 1.6, underlying: [{ symbol: 'VELVET', address: '0xvelvet' }, { symbol: 'WBNB' }] };
    const result = calculateTokenRisk(pool, [{ timestamp: now - 6 * 3600000, price: 1 }], now);
    expect(result.level).toBe('high');
    expect(result.warnings[0].changePct).toBe(60);
  });

  it('adds Rugcheck links only to non-core Solana tokens', () => {
    const result = calculateTokenRisk({ chain: 'solana', underlying: [{ symbol: 'BONK', address: 'bonkMint' }, { symbol: 'SOL', address: 'solMint' }] });
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].reviewUrl).toContain('rugcheck.xyz/tokens/bonkMint');
  });

  it.each([[1, 'eth'], [56, 'bnb']])('adds a De.Fi contract scan on EVM chain %s', (chainId, scannerChain) => {
    const result = calculateTokenRisk({ chainId, underlying: [{ symbol: 'VELVET', address: '0xvelvet' }, { symbol: 'WBNB' }] });
    expect(result.tokens[0].reviewProvider).toBe('De.Fi');
    expect(result.tokens[0].reviewUrl).toBe(`https://de.fi/scanner/contract/0xvelvet?chainId=${scannerChain}`);
  });
});
