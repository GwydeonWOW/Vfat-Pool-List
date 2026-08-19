import { useEffect, useMemo, useState } from 'react';
import { fetchWatchlist } from './api';
import PoolTable, { VFAT_COLUMNS, RAYDIUM_COLUMNS, TURBOS_COLUMNS, UP33_COLUMNS } from './PoolTable';

const TABLE_CONFIG = {
  vfat: { label: 'VFat', source: 'vfat', columns: VFAT_COLUMNS },
  raydium: { label: 'Raydium', source: 'raydium', columns: RAYDIUM_COLUMNS },
  turbos: { label: 'Turbos Finance', source: 'turbos', columns: TURBOS_COLUMNS },
  up33: { label: 'UP33', source: 'up33', columns: UP33_COLUMNS },
};

function tableConfig(pool) {
  return TABLE_CONFIG[pool.provider] || { label: pool.protocol || pool.provider || 'Other', source: 'generic', columns: TURBOS_COLUMNS };
}

function withSelectedRisk(pool, profile) {
  const risk = pool.riskScores?.[profile];
  return {
    ...pool,
    _risk: risk,
    score: risk?.total ?? 0,
    estimatedNetDaily: risk?.estimatedNetDaily ?? 0,
    poolRewardsDaily: risk?.poolRewardsDaily ?? null,
    poolFeesDaily: risk?.poolFeesDaily ?? 0,
    poolIncentivesDaily: risk?.poolIncentivesDaily ?? 0,
    estimatedExitsPerDay: risk?.estimatedExitsPerDay ?? null,
  };
}

export default function WatchlistView({ profile, onRemove, compareIds = [], onCompare }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchWatchlist()
      .then((data) => { if (active) { setItems(data.items || []); setError(''); } })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const remove = async (id) => {
    const previous = items;
    setItems((current) => current.filter((item) => item.pool_id !== id));
    try { await onRemove(id); }
    catch (err) { setItems(previous); setError(err.message); }
  };

  const groups = useMemo(() => {
    const grouped = new Map();
    for (const item of items) {
      if (!item.pool) continue;
      const pool = withSelectedRisk(item.pool, profile);
      const config = tableConfig(pool);
      const key = `${config.source}:${config.label}`;
      if (!grouped.has(key)) grouped.set(key, { config, pools: [] });
      grouped.get(key).pools.push(pool);
    }
    return [...grouped.values()];
  }, [items, profile]);

  const favoriteIds = new Set(items.map((item) => item.pool_id));
  return <section className="watchlist-view">
    <h2>Watchlist · {profile}</h2>
    {error && <div className="error">{error}</div>}
    {items.some((item) => item.unavailable) && <div className="analysis-warning">Some saved pools are temporarily unavailable and remain saved.</div>}
    {loading ? <div className="loading">Loading favorites...</div> : groups.length ? groups.map(({ config, pools }) => (
      <div className="watchlist-group" key={`${config.source}:${config.label}`}>
        <h3>{config.label}</h3>
        <PoolTable pools={pools} columns={config.columns} source={config.source} favoriteIds={favoriteIds} compareIds={compareIds} onFavorite={remove} onCompare={onCompare} />
      </div>
    )) : <div className="loading">No favorite pools yet.</div>}
  </section>;
}
