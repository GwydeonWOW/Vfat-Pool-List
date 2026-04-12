import { useState, useEffect, useCallback } from 'react';
import { CHAINS, CL_TYPES, fetchAllPools } from './api';
import PoolTable from './PoolTable';

const chainEntries = Object.entries(CHAINS);

export default function App() {
  const [selectedChains, setSelectedChains] = useState([8453, 56]);
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [minTvl, setMinTvl] = useState(5000);
  const [maxTvl, setMaxTvl] = useState(10000000);
  const [minApr, setMinApr] = useState(100);
  const [minRange, setMinRange] = useState(0.5);
  const [maxRange, setMaxRange] = useState(10);
  const [minRewardsWeek, setMinRewardsWeek] = useState(1000);
  const [showFilters, setShowFilters] = useState(false);

  const loadPools = useCallback(async (chains) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllPools(chains);
      setPools(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPools([]);
    loadPools(selectedChains);
  }, [selectedChains, loadPools]);

  const toggleChain = (chainId) => {
    setSelectedChains((prev) =>
      prev.includes(chainId)
        ? prev.filter((c) => c !== chainId)
        : [...prev, chainId]
    );
  };

  const toggleAllChains = () => {
    setSelectedChains((prev) =>
      prev.length === chainEntries.length ? [] : chainEntries.map(([id]) => Number(id))
    );
  };

  // Apply filters
  const filteredPools = pools.filter((p) => {
    if (p.tvl < minTvl) return false;
    if (p.tvl > maxTvl) return false;
    if (p.apr < minApr) return false;
    if (p.rangePct < minRange || p.rangePct > maxRange) return false;
    if (p.rewardsWeek < minRewardsWeek) return false;
    return true;
  });

  const poolCount = filteredPools.length;

  return (
    <div className="app">
      <header className="header">
        <h1>VFat Pool Analyzer</h1>
        <div className="controls">
          <button onClick={() => loadPools(selectedChains)} disabled={loading} className="refresh-btn">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className="filter-toggle-btn">
            Filters {showFilters ? '▲' : '▼'}
          </button>
        </div>
      </header>

      {/* Chain selector */}
      <div className="chain-selector">
        <button onClick={toggleAllChains} className="chain-chip all-chip">
          {selectedChains.length === chainEntries.length ? 'Deselect All' : 'All Chains'}
        </button>
        {chainEntries.map(([id, info]) => (
          <button
            key={id}
            className={`chain-chip${selectedChains.includes(Number(id)) ? ' active' : ''}`}
            onClick={() => toggleChain(Number(id))}
          >
            {info.name}
          </button>
        ))}
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="filters">
          <div className="filter-row">
            <label>
              Min TVL: $
              <input type="number" value={minTvl} onChange={(e) => setMinTvl(Number(e.target.value))} />
            </label>
            <label>
              Max TVL: $
              <input type="number" value={maxTvl} onChange={(e) => setMaxTvl(Number(e.target.value))} />
            </label>
            <label>
              Min APR: %
              <input type="number" value={minApr} onChange={(e) => setMinApr(Number(e.target.value))} />
            </label>
          </div>
          <div className="filter-row">
            <label>
              Range: %
              <input type="number" step="0.1" value={minRange} onChange={(e) => setMinRange(Number(e.target.value))} />
              -
              <input type="number" step="0.1" value={maxRange} onChange={(e) => setMaxRange(Number(e.target.value))} />
            </label>
            <label>
              Min Rewards/week: $
              <input type="number" value={minRewardsWeek} onChange={(e) => setMinRewardsWeek(Number(e.target.value))} />
            </label>
          </div>
        </div>
      )}

      {error && <div className="error">Error: {error}</div>}

      <div className="pool-count">
        {loading
          ? `Loading pools for ${selectedChains.map((c) => CHAINS[c]?.name).join(', ')}...`
          : `${poolCount} pools found (of ${pools.length} total)`}
      </div>

      {loading && pools.length === 0 ? (
        <div className="loading">Fetching farms from VFat API...</div>
      ) : (
        <PoolTable pools={filteredPools} />
      )}
    </div>
  );
}
