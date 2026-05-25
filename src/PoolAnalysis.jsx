import { useState } from 'react';
import { CHAINS, analyzePool } from './api';
import { formatUsd } from './PoolTable';

const chainEntries = Object.entries(CHAINS);

export default function PoolAnalysis() {
  const [chainId, setChainId] = useState(8453);
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleAnalyze = async () => {
    const trimmed = address.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await analyzePool(chainId, trimmed);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAnalyze();
  };

  const pool = result?.pool;
  const holders = result?.holders;

  return (
    <div className="pool-analysis">
      <div className="analysis-input">
        <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))} className="chain-select">
          {chainEntries.map(([id, info]) => (
            <option key={id} value={id}>{info.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Pool or farm contract address (0x...)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={handleKeyDown}
          className="address-input"
        />
        <button onClick={handleAnalyze} disabled={loading || !address.trim()} className="analyze-btn">
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {error && <div className="error">Error: {error}</div>}

      {loading && (
        <div className="analysis-loading">
          <div className="loading-spinner" />
          <span>Fetching positions for {CHAINS[chainId]?.name || `Chain ${chainId}`}... This may take up to 30s on first load.</span>
        </div>
      )}

      {result && !loading && (
        <div className="analysis-results">
          {/* Pool info card */}
          <div className="pool-info-card">
            <h3>{pool?.pair || 'Unknown Pool'}</h3>
            <div className="pool-info-grid">
              {pool?.protocol && <div className="info-item"><span className="label">Protocol</span><span>{pool.protocol}</span></div>}
              {pool?.type && <div className="info-item"><span className="label">Type</span><span>{pool.type}</span></div>}
              {pool?.tvl > 0 && <div className="info-item"><span className="label">TVL</span><span className="tvl">{formatUsd(pool.tvl)}</span></div>}
              {pool?.apr > 0 && <div className="info-item"><span className="label">APR</span><span className="apr-highlight">{pool.apr}%</span></div>}
              {pool?.stakingApr > 0 && <div className="info-item"><span className="label">Staking APR</span><span>{pool.stakingApr}%</span></div>}
              {pool?.rangePct > 0 && <div className="info-item"><span className="label">Range</span><span>{pool.rangePct}%</span></div>}
              {pool?.tickSpacing > 0 && <div className="info-item"><span className="label">Tick Spacing</span><span>{pool.tickSpacing}</span></div>}
              {pool?.rewardsWeek > 0 && <div className="info-item"><span className="label">Rewards/wk</span><span>{formatUsd(pool.rewardsWeek)}</span></div>}
              {pool?.inRangeRatio > 0 && <div className="info-item"><span className="label">In-Range</span><span>{pool.inRangeRatio}%</span></div>}
              {pool?.underlying?.length > 0 && (
                <div className="info-item">
                  <span className="label">Tokens</span>
                  <span>{pool.underlying.map((u) => u.symbol).join(' / ')}</span>
                </div>
              )}
              {pool?.poolAddr && (
                <div className="info-item">
                  <span className="label">Pool</span>
                  <a href={`${CHAINS[chainId]?.explorer || '#'}/address/${pool.poolAddr}`} target="_blank" rel="noopener noreferrer" className="addr-link">
                    {pool.poolAddr.slice(0, 8)}...{pool.poolAddr.slice(-6)}
                  </a>
                </div>
              )}
              {pool?.farmAddr && (
                <div className="info-item">
                  <span className="label">Farm</span>
                  <a href={`${CHAINS[chainId]?.explorer || '#'}/address/${pool.farmAddr}`} target="_blank" rel="noopener noreferrer" className="addr-link">
                    {pool.farmAddr.slice(0, 8)}...{pool.farmAddr.slice(-6)}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Holders summary */}
          <div className="holders-summary">
            <div className="holders-stat">
              <span className="stat-value">{holders?.total || 0}</span>
              <span className="stat-label">Holders</span>
            </div>
            <div className="holders-stat">
              <span className="stat-value tvl">{formatUsd(holders?.totalValue || 0)}</span>
              <span className="stat-label">Total Value</span>
            </div>
          </div>

          {/* Top holders table */}
          {holders?.top?.length > 0 ? (
            <div className="holders-table-wrapper">
              <table className="holders-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Address</th>
                    <th>Value</th>
                    <th>% of Pool</th>
                    <th>Positions</th>
                  </tr>
                </thead>
                <tbody>
                  {holders.top.map((h) => (
                    <tr key={h.address}>
                      <td className="rank">{h.rank}</td>
                      <td>
                        <a
                          href={`${CHAINS[chainId]?.explorer || '#'}/address/${h.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="addr-link"
                        >
                          {h.address.slice(0, 8)}...{h.address.slice(-6)}
                        </a>
                      </td>
                      <td className="tvl">{formatUsd(h.value)}</td>
                      <td className="pct-bar-cell">
                        <div className="pct-bar-track">
                          <div className="pct-bar-fill" style={{ width: `${Math.min(h.pct, 100)}%` }} />
                        </div>
                        <span className="pct-text">{h.pct}%</span>
                      </td>
                      <td>{h.positions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="no-holders">No positions found for this pool.</div>
          )}
        </div>
      )}
    </div>
  );
}
