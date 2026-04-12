import { useState, useMemo } from 'react';
import PoolChart from './PoolChart';

const COLUMNS = [
  { key: 'expand', label: '', sortable: false },
  { key: 'name', label: 'Pool', sortable: true },
  { key: 'baseTokenPriceUsd', label: 'Price', sortable: true },
  { key: 'priceChangeH24', label: '24h %', sortable: true },
  { key: 'priceChangeH1', label: '1h %', sortable: true },
  { key: 'volumeUsdH24', label: 'Volume 24h', sortable: true },
  { key: 'reserveInUsd', label: 'TVL', sortable: true },
  { key: 'transactionsH24', label: 'Txns 24h', sortable: true },
  { key: 'fdvUsd', label: 'FDV', sortable: true },
];

function formatNumber(num) {
  if (!num || num === 0) return '$0';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
  return '$' + num.toFixed(2);
}

function formatPrice(price) {
  if (!price || price === 0) return '$0';
  if (price < 0.00001) return '$' + price.toExponential(2);
  if (price < 1) return '$' + price.toFixed(6);
  if (price < 1000) return '$' + price.toFixed(4);
  return '$' + price.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercent(pct) {
  if (!pct && pct !== 0) return '-';
  const sign = pct >= 0 ? '+' : '';
  return sign + pct.toFixed(2) + '%';
}

export default function PoolTable({ pools, networkId }) {
  const [sortKey, setSortKey] = useState('volumeUsdH24');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedId, setExpandedId] = useState(null);

  const sortedPools = useMemo(() => {
    return [...pools].sort((a, b) => {
      const aVal = a[sortKey] || 0;
      const bVal = b[sortKey] || 0;
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [pools, sortKey, sortDir]);

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const toggleExpand = (poolId) => {
    setExpandedId((prev) => (prev === poolId ? null : poolId));
  };

  return (
    <table className="pool-table">
      <thead>
        <tr>
          {COLUMNS.map((col) => (
            <th
              key={col.key}
              className={
                col.sortable
                  ? sortKey === col.key
                    ? sortDir === 'desc'
                      ? 'sorted-desc'
                      : 'sorted-asc'
                    : ''
                  : ''
              }
              onClick={() => col.sortable && handleSort(col.key)}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedPools.map((pool) => {
          const isExpanded = expandedId === pool.id;
          return (
            <>
              <tr
                key={pool.id}
                className={`pool-row${isExpanded ? ' expanded' : ''}`}
                onClick={() => toggleExpand(pool.id)}
              >
                <td className="expand-cell">
                  <span className={`expand-arrow${isExpanded ? ' open' : ''}`}>▶</span>
                </td>
                <td>
                  <div className="pool-name">{pool.name || 'Unknown'}</div>
                  <div className="pool-dex">{pool.dex}</div>
                </td>
                <td className="price">{formatPrice(pool.baseTokenPriceUsd)}</td>
                <td className={pool.priceChangeH24 >= 0 ? 'positive' : 'negative'}>
                  {formatPercent(pool.priceChangeH24)}
                </td>
                <td className={pool.priceChangeH1 >= 0 ? 'positive' : 'negative'}>
                  {formatPercent(pool.priceChangeH1)}
                </td>
                <td>{formatNumber(pool.volumeUsdH24)}</td>
                <td>{formatNumber(pool.reserveInUsd)}</td>
                <td>
                  <span className="tx-info">
                    <span className="tx-buys">{pool.buysH24}</span>
                    {' / '}
                    <span className="tx-sells">{pool.sellsH24}</span>
                  </span>
                </td>
                <td>{formatNumber(pool.fdvUsd)}</td>
              </tr>
              {isExpanded && (
                <tr key={`${pool.id}-chart`} className="chart-row">
                  <td colSpan={COLUMNS.length}>
                    <PoolChart pool={pool} networkId={networkId} />
                  </td>
                </tr>
              )}
            </>
          );
        })}
      </tbody>
    </table>
  );
}
