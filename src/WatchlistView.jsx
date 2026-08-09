import { useEffect, useState } from 'react';
import { fetchWatchlist } from './api';
import PoolTable, { TURBOS_COLUMNS } from './PoolTable';

export default function WatchlistView({ onRemove, compareIds, onCompare }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const load = () => fetchWatchlist().then(data => setItems(data.items || [])).catch(err => setError(err.message));
  useEffect(load, []);
  const remove = async id => { await onRemove(id); await load(); };
  const pools = items.map(x => x.pool).filter(Boolean);
  return <section className="watchlist-view">
    <h2>Watchlist</h2>
    {error && <div className="error">{error}</div>}
    {items.some(x => x.unavailable) && <div className="analysis-warning">Some saved pools are temporarily unavailable and remain saved.</div>}
    {pools.length ? <PoolTable pools={pools} columns={TURBOS_COLUMNS} source="generic" favoriteIds={new Set(items.map(x => x.pool_id))} compareIds={compareIds} onFavorite={remove} onCompare={onCompare} /> : <div className="loading">No favorite pools yet.</div>}
  </section>;
}
