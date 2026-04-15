import { useState, useEffect, useCallback, useRef } from 'react';
import { CHAINS, fetchAllPools, fetchRaydiumPools, fetchTurbosPools, refreshBackend, fetchStatus } from './api';
import { batchFetchRSI } from './api';
import PoolTable, { VFAT_COLUMNS, RAYDIUM_COLUMNS, TURBOS_COLUMNS } from './PoolTable';
import Login, { isLoggedIn, logout } from './Auth';

const TABS = [
  { key: 'vfat', label: 'VFat' },
  { key: 'raydium', label: 'Raydium' },
  { key: 'turbos', label: 'Turbos Finance' },
];

const chainEntries = Object.entries(CHAINS);

export default function App() {
  const [authenticated, setAuthenticated] = useState(isLoggedIn());
  const [activeTab, setActiveTab] = useState('vfat');

  // Data
  const [vfatPools, setVfatPools] = useState([]);
  const [raydiumPools, setRaydiumPools] = useState([]);
  const [turbosPools, setTurbosPools] = useState([]);
  const [rsiData, setRsiData] = useState(new Map());
  const [rsiLoading, setRsiLoading] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshAgo, setRefreshAgo] = useState(null);

  // VFat chain filter
  const [selectedChains, setSelectedChains] = useState([8453, 56, 43114, 146]);

  // Filters
  const [minTvl, setMinTvl] = useState(5000);
  const [maxTvl, setMaxTvl] = useState(10000000);
  const [minApr, setMinApr] = useState(100);
  const [minRange, setMinRange] = useState(0.5);
  const [maxRange, setMaxRange] = useState(10);
  const [minRewardsWeek, setMinRewardsWeek] = useState(1000);
  const [showFilters, setShowFilters] = useState(false);

  const rsiAbortRef = useRef(false);

  // Fetch last refresh time from backend
  const loadRefreshStatus = useCallback(async () => {
    try {
      const status = await fetchStatus();
      const source = status[activeTab];
      if (source) setRefreshAgo(source.age);
    } catch { /* ignore */ }
  }, [activeTab]);

  // Update refresh age display every 30s
  useEffect(() => {
    loadRefreshStatus();
    const interval = setInterval(loadRefreshStatus, 30000);
    return () => clearInterval(interval);
  }, [loadRefreshStatus]);

  // ── Load from backend ──

  const loadData = useCallback(async (tab) => {
    setLoading(true);
    setError(null);
    try {
      let pools;
      if (tab === 'vfat') {
        pools = await fetchAllPools();
        setVfatPools(pools);
      } else if (tab === 'raydium') {
        pools = await fetchRaydiumPools();
        setRaydiumPools(pools);
      } else {
        pools = await fetchTurbosPools();
        setTurbosPools(pools);
      }
      // Use backend timestamp as lastUpdated
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshBackend(activeTab);
      await loadData(activeTab);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  // Load data on tab change
  useEffect(() => {
    setSearch('');
    setError(null);
    loadData(activeTab);
  }, [activeTab, loadData]);

  // Filter VFat pools when chain selection changes
  useEffect(() => {
    if (activeTab === 'vfat') loadData('vfat');
  }, [selectedChains]);

  // RSI fetch for VFat
  useEffect(() => {
    if (activeTab !== 'vfat' || loading || vfatPools.length === 0) return;
    rsiAbortRef.current = false;
    const aborted = () => rsiAbortRef.current;

    const topPools = [...vfatPools]
      .sort((a, b) => b.apr - a.apr)
      .slice(0, 80);

    setRsiLoading(true);
    batchFetchRSI(topPools, 3).then((rsiMap) => {
      if (!aborted()) {
        setRsiData(rsiMap);
        setRsiLoading(false);
      }
    });
    return () => { rsiAbortRef.current = true; };
  }, [vfatPools, loading, activeTab]);

  if (!authenticated) {
    return <Login onLogin={() => setAuthenticated(true)} />;
  }

  // ── Chain toggles ──

  const toggleChain = (chainId) => {
    setSelectedChains((prev) =>
      prev.includes(chainId) ? prev.filter((c) => c !== chainId) : [...prev, chainId]
    );
  };

  const toggleAllChains = () => {
    setSelectedChains((prev) =>
      prev.length === chainEntries.length ? [] : chainEntries.map(([id]) => Number(id))
    );
  };

  // ── Filters ──

  const currentPools = loading ? []
    : activeTab === 'vfat'
      ? vfatPools.filter((p) => selectedChains.includes(p.chainId))
      : activeTab === 'raydium' ? raydiumPools : turbosPools;

  const effectiveMinApr = activeTab === 'vfat' ? minApr : 0;
  const searchLower = search.toLowerCase();

  const filteredPools = currentPools.filter((p) => {
    if (searchLower) {
      const haystack = [
        p.pair, p.vfname, p.protocol, p.type, p.chain,
        ...p.underlying.map((u) => u.symbol),
        p.poolAddr, p.farmAddr,
      ].join(' ').toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }
    if (p.tvl < minTvl) return false;
    if (p.tvl > maxTvl) return false;
    if (p.apr < effectiveMinApr) return false;
    if (p.rangePct < minRange || p.rangePct > maxRange) return false;
    if (activeTab === 'vfat' && p.rewardsWeek < minRewardsWeek) return false;
    return true;
  });

  const poolCount = filteredPools.length;
  const currentColumns = activeTab === 'vfat' ? VFAT_COLUMNS
    : activeTab === 'raydium' ? RAYDIUM_COLUMNS : TURBOS_COLUMNS;

  return (
    <div className="app">
      <header className="header">
        <h1>VFat Pool Analyzer</h1>
        <div className="controls">
          {refreshAgo != null && (
            <span className="refresh-age">
              Data: {refreshAgo < 60 ? `${refreshAgo}s` : `${Math.floor(refreshAgo/60)}m`} ago
            </span>
          )}
          <button onClick={handleRefresh} disabled={loading || refreshing} className="refresh-btn">
            {refreshing ? 'Refreshing...' : loading ? 'Loading...' : 'Refresh'}
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className="filter-toggle-btn">
            Filters {showFilters ? '▲' : '▼'}
          </button>
          <button onClick={() => { logout(); setAuthenticated(false); }} className="logout-btn">
            Logout
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="search-bar">
        <input
          type="text"
          placeholder="Search by token, pool name, protocol, or address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        {search && <button className="search-clear" onClick={() => setSearch('')}>✕</button>}
      </div>

      {/* Chain selector (VFat only) */}
      {activeTab === 'vfat' && (
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
      )}

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
            {activeTab === 'vfat' && (
              <label>
                Min APR: %
                <input type="number" value={minApr} onChange={(e) => setMinApr(Number(e.target.value))} />
              </label>
            )}
          </div>
          <div className="filter-row">
            <label>
              Range: %
              <input type="number" step="0.1" value={minRange} onChange={(e) => setMinRange(Number(e.target.value))} />
              -
              <input type="number" step="0.1" value={maxRange} onChange={(e) => setMaxRange(Number(e.target.value))} />
            </label>
            {activeTab === 'vfat' && (
              <label>
                Min Rewards/week: $
                <input type="number" value={minRewardsWeek} onChange={(e) => setMinRewardsWeek(Number(e.target.value))} />
              </label>
            )}
          </div>
        </div>
      )}

      {error && <div className="error">Error: {error}</div>}

      <div className="pool-count">
        {loading
          ? `Loading ${activeTab === 'vfat' ? 'VFat' : activeTab === 'raydium' ? 'Raydium' : 'Turbos'} pools...`
          : `${poolCount} pools found (of ${currentPools.length} total)`}
        {activeTab === 'vfat' && !loading && (
          <span>{rsiLoading ? ' | Loading RSI...' : ` | RSI: ${rsiData.size} pools`}</span>
        )}
      </div>

      {loading ? (
        <div className="loading">Fetching pools from server cache...</div>
      ) : (
        <PoolTable pools={filteredPools} columns={currentColumns} rsiData={rsiData} source={activeTab} />
      )}
    </div>
  );
}
