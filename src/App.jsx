import { useState, useEffect, useCallback, useRef } from 'react';
import { CHAINS, fetchAllPools, batchFetchRSI } from './api';
import { fetchRaydiumPools } from './raydiumApi';
import { fetchTurbosPools } from './turbosApi';
import PoolTable, { VFAT_COLUMNS, RAYDIUM_COLUMNS, TURBOS_COLUMNS } from './PoolTable';

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const TABS = [
  { key: 'vfat', label: 'VFat' },
  { key: 'raydium', label: 'Raydium' },
  { key: 'turbos', label: 'Turbos Finance' },
];

function loadCache(tabKey) {
  try {
    const raw = localStorage.getItem(`vfat_cache_${tabKey}`);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (Date.now() - cache.timestamp > CACHE_TTL) return null;
    return cache;
  } catch {
    return null;
  }
}

function saveCache(tabKey, data) {
  try {
    localStorage.setItem(`vfat_cache_${tabKey}`, JSON.stringify({
      timestamp: Date.now(),
      data,
    }));
  } catch {
    // localStorage full
  }
}

const chainEntries = Object.entries(CHAINS);

export default function App() {
  const [activeTab, setActiveTab] = useState('vfat');

  // VFat state
  const [selectedChains, setSelectedChains] = useState([8453, 56, 43114, 146]);
  const [vfatPools, setVfatPools] = useState([]);
  const [rsiData, setRsiData] = useState(new Map());
  const [rsiLoading, setRsiLoading] = useState(false);

  // Raydium state
  const [raydiumPools, setRaydiumPools] = useState([]);

  // Turbos state
  const [turbosPools, setTurbosPools] = useState([]);

  // Shared state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  // Filters
  const [minTvl, setMinTvl] = useState(5000);
  const [maxTvl, setMaxTvl] = useState(10000000);
  const [minApr, setMinApr] = useState(100);
  const [minRange, setMinRange] = useState(0.5);
  const [maxRange, setMaxRange] = useState(10);
  const [minRewardsWeek, setMinRewardsWeek] = useState(1000);
  const [showFilters, setShowFilters] = useState(false);

  const rsiAbortRef = useRef(false);
  const refreshTimerRef = useRef(null);

  // ── Data loading ──

  const loadVfat = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    setRsiData(new Map());
    rsiAbortRef.current = true;

    if (!forceRefresh) {
      const cached = loadCache('vfat');
      if (cached) {
        setVfatPools(cached.data);
        setLastUpdated(cached.timestamp);
        setLoading(false);
        return;
      }
    }

    try {
      const data = await fetchAllPools(selectedChains);
      setVfatPools(data);
      setLastUpdated(Date.now());
      saveCache('vfat', data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedChains]);

  const loadRaydium = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);

    if (!forceRefresh) {
      const cached = loadCache('raydium');
      if (cached) {
        setRaydiumPools(cached.data);
        setLastUpdated(cached.timestamp);
        setLoading(false);
        return;
      }
    }

    try {
      const data = await fetchRaydiumPools('concentrated', 5);
      setRaydiumPools(data);
      setLastUpdated(Date.now());
      saveCache('raydium', data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTurbos = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);

    if (!forceRefresh) {
      const cached = loadCache('turbos');
      if (cached) {
        setTurbosPools(cached.data);
        setLastUpdated(cached.timestamp);
        setLoading(false);
        return;
      }
    }

    try {
      const data = await fetchTurbosPools(7);
      setTurbosPools(data);
      setLastUpdated(Date.now());
      saveCache('turbos', data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data on tab change
  useEffect(() => {
    setSearch('');
    setError(null);
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (activeTab === 'vfat') loadVfat();
    else if (activeTab === 'raydium') loadRaydium();
    else if (activeTab === 'turbos') loadTurbos();

    // Auto-refresh every 15 min
    refreshTimerRef.current = setInterval(() => {
      if (activeTab === 'vfat') loadVfat(true);
      else if (activeTab === 'raydium') loadRaydium(true);
      else if (activeTab === 'turbos') loadTurbos(true);
    }, CACHE_TTL);

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [activeTab, loadVfat, loadRaydium, loadTurbos]);

  // Reload VFat when chains change
  useEffect(() => {
    if (activeTab === 'vfat') loadVfat();
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

  const handleRefresh = () => {
    if (activeTab === 'vfat') loadVfat(true);
    else if (activeTab === 'raydium') loadRaydium(true);
    else if (activeTab === 'turbos') loadTurbos(true);
  };

  // ── Chain toggles (VFat only) ──

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

  // ── Time display ──

  const timeSinceUpdate = () => {
    if (!lastUpdated) return '';
    const secs = Math.floor((Date.now() - lastUpdated) / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  // ── Current pools and filters ──

  const currentPools = activeTab === 'vfat' ? vfatPools
    : activeTab === 'raydium' ? raydiumPools
    : turbosPools;

  // Adjust default filters per source
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

  // ── Tab-specific columns ──

  const currentColumns = activeTab === 'vfat' ? VFAT_COLUMNS
    : activeTab === 'raydium' ? RAYDIUM_COLUMNS
    : TURBOS_COLUMNS;

  return (
    <div className="app">
      <header className="header">
        <h1>VFat Pool Analyzer</h1>
        <div className="controls">
          <button onClick={handleRefresh} disabled={loading} className="refresh-btn">
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className="filter-toggle-btn">
            Filters {showFilters ? '▲' : '▼'}
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
        {search && (
          <button className="search-clear" onClick={() => setSearch('')}>✕</button>
        )}
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
        {lastUpdated && !loading && (
          <span className="last-updated"> | Updated {timeSinceUpdate()}</span>
        )}
      </div>

      {loading && currentPools.length === 0 ? (
        <div className="loading">Fetching pools...</div>
      ) : (
        <PoolTable
          pools={filteredPools}
          columns={currentColumns}
          rsiData={rsiData}
          source={activeTab}
        />
      )}
    </div>
  );
}
