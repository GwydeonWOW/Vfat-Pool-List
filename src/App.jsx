import { useState, useEffect, useCallback } from 'react';
import { getNetworks, getTrendingPools, getPools } from './api';
import PoolTable from './PoolTable';

const DEFAULT_NETWORKS = [
  { id: 'eth', name: 'Ethereum' },
  { id: 'bsc', name: 'BNB Chain' },
  { id: 'polygon_pos', name: 'Polygon' },
  { id: 'arbitrum', name: 'Arbitrum' },
  { id: 'optimism', name: 'Optimism' },
  { id: 'base', name: 'Base' },
  { id: 'solana', name: 'Solana' },
  { id: 'avalanche', name: 'Avalanche' },
  { id: 'fantom', name: 'Fantom' },
  { id: 'linea', name: 'Linea' },
];

export default function App() {
  const [networks, setNetworks] = useState(DEFAULT_NETWORKS);
  const [selectedNetwork, setSelectedNetwork] = useState('eth');
  const [pools, setPools] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('trending'); // 'trending' or 'all'

  useEffect(() => {
    getNetworks().then(setNetworks).catch(() => {});
  }, []);

  const loadPools = useCallback(async (networkId, pageNum, poolMode) => {
    setLoading(true);
    setError(null);
    try {
      if (poolMode === 'trending') {
        const data = await getTrendingPools(networkId);
        setPools(data);
      } else {
        const result = await getPools(networkId, pageNum);
        setPools((prev) => (pageNum === 1 ? result.pools : [...prev, ...result.pools]));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    setPools([]);
    loadPools(selectedNetwork, 1, mode);
  }, [selectedNetwork, mode, loadPools]);

  const handleNetworkChange = (e) => {
    setSelectedNetwork(e.target.value);
  };

  const handleModeChange = (newMode) => {
    setMode(newMode);
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadPools(selectedNetwork, nextPage, mode);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>VFat Pool Analyzer</h1>
        <div className="controls">
          <select value={selectedNetwork} onChange={handleNetworkChange}>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <div className="mode-toggle">
            <button
              className={mode === 'trending' ? 'active' : ''}
              onClick={() => handleModeChange('trending')}
            >
              Trending
            </button>
            <button
              className={mode === 'all' ? 'active' : ''}
              onClick={() => handleModeChange('all')}
            >
              All Pools
            </button>
          </div>
        </div>
      </header>

      {error && <div className="error">Error: {error}</div>}

      {loading && pools.length === 0 ? (
        <div className="loading">Loading pools...</div>
      ) : (
        <>
          <PoolTable pools={pools} networkId={selectedNetwork} />
          {mode === 'all' && (
            <div className="load-more">
              <button onClick={handleLoadMore} disabled={loading}>
                {loading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
