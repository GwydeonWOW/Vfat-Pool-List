import { useState, useEffect, useCallback } from 'react';
import { CHAINS, fetchAllPools, fetchRaydiumPools, fetchTurbosPools, fetchProviderPools, refreshBackend, fetchStatus, setOnAuthFail, fetchWatchlist, addWatchlist, removeWatchlist } from './api';
import PoolTable, { VFAT_COLUMNS, RAYDIUM_COLUMNS, TURBOS_COLUMNS } from './PoolTable';
import Login, { isAuthenticated, clearAuth } from './Auth';
import PoolAnalysis from './PoolAnalysis';
import WatchlistView from './WatchlistView';
import CompareView from './CompareView';

const TABS = [
  { key: 'vfat', label: 'VFat' },
  { key: 'raydium', label: 'Raydium' },
  { key: 'turbos', label: 'Turbos Finance' },
  { key: 'uniswap', label: 'Uniswap' },
  { key: 'orca', label: 'Orca' },
  { key: 'cetus', label: 'Cetus' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'compare', label: 'Compare' },
  { key: 'analysis', label: 'Pool Analysis' },
];

const chainEntries = Object.entries(CHAINS);
const PAGE_SIZE = 30;

// ── Scoring functions ──

function calcVfatScore(pool) {
  let score = pool.apr;
  if (pool.hasRealRewards) score *= 1.5; else score *= 0.6;
  const inRangeFactor = pool.inRangeRatio / 100;
  if (inRangeFactor >= 0.7) score *= 1.0;
  else if (inRangeFactor >= 0.4) score *= 0.7;
  else if (inRangeFactor >= 0.2) score *= 0.4;
  else score *= 0.15;
  if (pool.rangePct >= 1 && pool.rangePct <= 5) score *= 1.1;
  else if (pool.rangePct > 10) score *= 0.8;
  if (pool.hasGauge) score *= 1.15;
  if (pool.tvl >= 100000) score *= 1.1;
  else if (pool.tvl < 10000) score *= 0.8;
  const maxApr = pool.maxApr || 0;
  if (maxApr > 4800) score *= 1.3;
  else if (maxApr > 3200) score *= 1.0;
  else if (maxApr > 0) score *= 0.7;
  return parseFloat(score.toFixed(1));
}

function calcGenericScore(pool) {
  let score = pool.apr;
  if (pool.hasRealRewards) score *= 1.5; else score *= 0.6;
  if (pool.rangePct >= 1 && pool.rangePct <= 5) score *= 1.1;
  else if (pool.rangePct > 10) score *= 0.8;
  if (pool.tvl >= 100000) score *= 1.1;
  else if (pool.tvl < 10000) score *= 0.8;
  return parseFloat(score.toFixed(1));
}

const SCORERS = {
  vfat: calcVfatScore,
  raydium: calcGenericScore,
  turbos: calcGenericScore,
};

export default function App() {
  const [authenticated, setAuthenticated] = useState(null);

  useEffect(() => { isAuthenticated().then(setAuthenticated); }, []);

  // Register auth fail callback (no page reload)
  useEffect(() => {
    setOnAuthFail(() => () => setAuthenticated(false));
  }, []);

  const [activeTab, setActiveTab] = useState('vfat');

  // Data
  const [vfatPools, setVfatPools] = useState([]);
  const [raydiumPools, setRaydiumPools] = useState([]);
  const [turbosPools, setTurbosPools] = useState([]);
  const [extraPools, setExtraPools] = useState({ uniswap: [], orca: [], cetus: [] });
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [compareIds, setCompareIds] = useState([]);
  const [riskProfile, setRiskProfile] = useState(() => localStorage.getItem('risk_profile') || 'balanced');

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshAgo, setRefreshAgo] = useState(null);

  // Pagination
  const [page, setPage] = useState(1);

  // VFat chain filter
  const [selectedChains, setSelectedChains] = useState([8453, 56, 43114, 137, 10, 146, 999, 143]);

  // Sort state
  const [sortKey, setSortKey] = useState('score');
  const [sortDir, setSortDir] = useState('desc');

  // Filters
  const [minTvl, setMinTvl] = useState(15000);
  const [maxTvl, setMaxTvl] = useState(10000000);
  const [minApr, setMinApr] = useState(100);
  const [minRange, setMinRange] = useState(0.5);
  const [maxRange, setMaxRange] = useState(10);
  const [minRewardsWeek, setMinRewardsWeek] = useState(1000);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch last refresh time from backend
  const loadRefreshStatus = useCallback(async () => {
    try {
      const status = await fetchStatus();
      const source = status[activeTab];
      setRefreshAgo(source ? source.age : null);
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
    if (['analysis', 'watchlist', 'compare'].includes(tab)) return;
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
      } else if (tab === 'turbos') {
        pools = await fetchTurbosPools();
        setTurbosPools(pools);
      } else {
        const data = await fetchProviderPools(tab);
        pools = data.pools || [];
        setExtraPools(prev => ({ ...prev, [tab]: pools }));
      }
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = async () => {
    if (['analysis', 'watchlist', 'compare'].includes(activeTab)) return;
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
    setPage(1);
    loadData(activeTab);
  }, [activeTab, loadData]);

  const loadFavorites = useCallback(async () => {
    try { const data = await fetchWatchlist(); setFavoriteIds(new Set((data.items || []).map(x => x.pool_id))); } catch {}
  }, []);
  useEffect(() => { if (authenticated) loadFavorites(); }, [authenticated, loadFavorites]);

  if (authenticated == null) return <div className="loading">Checking session...</div>;
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

  // ── ALL filtering, scoring, and sorting happens HERE ──

  const rawPools = loading ? []
    : activeTab === 'vfat'
      ? vfatPools.filter((p) => selectedChains.includes(p.chainId))
      : activeTab === 'raydium' ? raydiumPools
        : activeTab === 'turbos' ? turbosPools : (extraPools[activeTab] || []);

  const searchLower = search.toLowerCase();
  const afterSearch = searchLower
    ? rawPools.filter((p) => {
        const haystack = [
          p.pair, p.vfname, p.protocol, p.type,
          ...(p.underlying || []).map((u) => u.symbol),
          p.poolAddr, p.farmAddr,
        ].join(' ').toLowerCase();
        return haystack.includes(searchLower);
      })
    : rawPools;

  // Filters always apply; showFilters only controls panel visibility.
  const effectiveMinApr = activeTab === 'vfat' ? minApr : 0;
  const afterFilters = afterSearch.filter((p) => {
    if (p.tvl < minTvl || p.tvl > maxTvl) return false;
    if (p.apr < effectiveMinApr) return false;
    if (p.rangePct < minRange || p.rangePct > maxRange) return false;
    if (activeTab === 'vfat' && p.rewardsWeek < minRewardsWeek) return false;
    return true;
  });

  const calcFn = SCORERS[activeTab] || calcGenericScore;
  const scored = afterFilters.map((p) => ({ ...p, _risk: p.riskScores?.[riskProfile], score: p.riskScores?.[riskProfile]?.total ?? calcFn(p) }));
  const sorted = [...scored].sort((a, b) => {
    const aVal = a[sortKey] ?? 0;
    const bVal = b[sortKey] ?? 0;
    if (typeof aVal === 'string') {
      return sortDir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
    }
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagePools = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  const filteredCount = sorted.length;
  const totalPools = rawPools.length;

  // Reset page when filters change
  const handleSearch = (val) => { setSearch(val); setPage(1); };
  const handleSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
    setPage(1);
  };

  const currentColumns = activeTab === 'vfat' ? VFAT_COLUMNS
    : activeTab === 'raydium' ? RAYDIUM_COLUMNS : TURBOS_COLUMNS;

  const toggleFavorite = async (poolId) => {
    const wasFavorite = favoriteIds.has(poolId);
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(poolId); else next.add(poolId);
      return next;
    });
    try {
      if (wasFavorite) await removeWatchlist(poolId); else await addWatchlist(poolId);
    } catch (err) {
      setFavoriteIds(prev => {
        const next = new Set(prev);
        if (wasFavorite) next.add(poolId); else next.delete(poolId);
        return next;
      });
      setError(err.message);
      throw err;
    }
  };
  const toggleCompare = (poolId) => setCompareIds(prev => prev.includes(poolId) ? prev.filter(id => id !== poolId) : prev.length < 4 ? [...prev, poolId] : prev);

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
          <select aria-label="Risk profile" value={riskProfile} onChange={e => { setRiskProfile(e.target.value); localStorage.setItem('risk_profile', e.target.value); }} className="chain-select">
            <option value="conservative">Conservative</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option>
          </select>
          <button onClick={handleRefresh} disabled={loading || refreshing || ['analysis','watchlist','compare'].includes(activeTab)} className="refresh-btn">
            {refreshing ? 'Refreshing...' : loading ? 'Loading...' : 'Refresh'}
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className="filter-toggle-btn">
            Filters {showFilters ? '▲' : '▼'}
          </button>
          <button onClick={() => { clearAuth(); setAuthenticated(false); }} className="logout-btn">
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
      {!['analysis','watchlist','compare'].includes(activeTab) && (
      <div className="search-bar">
        <input
          type="text"
          placeholder="Search by token, pool name, protocol, or address..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="search-input"
        />
        {search && <button className="search-clear" onClick={() => handleSearch('')}>✕</button>}
      </div>
      )}

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

      {/* Pool Analysis tab */}
      {activeTab === 'analysis' ? (
        <PoolAnalysis />
      ) : activeTab === 'watchlist' ? (
        <WatchlistView profile={riskProfile} onRemove={toggleFavorite} compareIds={compareIds} onCompare={toggleCompare} />
      ) : activeTab === 'compare' ? (
        <CompareView poolIds={compareIds} profile={riskProfile} onRemove={toggleCompare} />
      ) : (
      <>
      {/* Filters */}
      {showFilters && (
        <div className="filters">
          <div className="filter-row">
            <label>
              Min TVL: $
              <input type="number" value={minTvl} onChange={(e) => { setMinTvl(Number(e.target.value)); setPage(1); }} />
            </label>
            <label>
              Max TVL: $
              <input type="number" value={maxTvl} onChange={(e) => { setMaxTvl(Number(e.target.value)); setPage(1); }} />
            </label>
            {activeTab === 'vfat' && (
              <label>
                Min APR: %
                <input type="number" value={minApr} onChange={(e) => { setMinApr(Number(e.target.value)); setPage(1); }} />
              </label>
            )}
          </div>
          <div className="filter-row">
            <label>
                Tick interval: %
              <input type="number" step="0.1" value={minRange} onChange={(e) => { setMinRange(Number(e.target.value)); setPage(1); }} />
              -
              <input type="number" step="0.1" value={maxRange} onChange={(e) => { setMaxRange(Number(e.target.value)); setPage(1); }} />
            </label>
            {activeTab === 'vfat' && (
              <label>
                Min Rewards/week: $
                <input type="number" value={minRewardsWeek} onChange={(e) => { setMinRewardsWeek(Number(e.target.value)); setPage(1); }} />
              </label>
            )}
          </div>
        </div>
      )}

      {error && <div className="error">Error: {error}</div>}

      <div className="pool-count">
        {loading
          ? `Loading ${activeTab === 'vfat' ? 'VFat' : activeTab === 'raydium' ? 'Raydium' : 'Turbos'} pools...`
          : `${filteredCount} pools found (of ${totalPools} total)`}
      </div>

      {loading ? (
        <div className="loading">Fetching pools from server cache...</div>
      ) : (
        <>
          <PoolTable
            key={pagePools.map(p => p.id).join('|')}
            pools={pagePools}
            columns={currentColumns}
            source={activeTab}
            onSort={handleSort}
            sortKey={sortKey}
            sortDir={sortDir}
            favoriteIds={favoriteIds}
            compareIds={compareIds}
            onFavorite={toggleFavorite}
            onCompare={toggleCompare}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="page-btn"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span className="page-info">
                Page {safePage} / {totalPages}
                <span className="page-range"> ({pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, filteredCount)} of {filteredCount})</span>
              </span>
              <button
                className="page-btn"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
