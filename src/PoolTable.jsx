import { useState, useMemo } from 'react';
import { CHAINS } from './api';
import PoolChart from './PoolChart';

const COLUMNS = [
  { key: 'expand', label: '', sortable: false },
  { key: 'vfname', label: 'Pool', sortable: true },
  { key: 'protocol', label: 'Protocol', sortable: true },
  { key: 'apr', label: 'APR %', sortable: true },
  { key: 'maxApr', label: 'Max APR', sortable: true },
  { key: 'tvl', label: 'TVL', sortable: true },
  { key: 'rangePct', label: 'Range %', sortable: true },
  { key: 'tickSpacing', label: 'Tick', sortable: true },
  { key: 'rewardsWeek', label: 'Rewards/wk', sortable: true },
  { key: 'inRangeRatio', label: 'In-Range %', sortable: true },
];

function formatUsd(num) {
  if (!num || num === 0) return '$0';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
  return '$' + num.toFixed(2);
}

function aprColor(apr) {
  if (apr >= 500) return 'apr-extreme';
  if (apr >= 200) return 'apr-high';
  if (apr >= 50) return 'apr-mid';
  return 'apr-low';
}

function ratioColor(ratio) {
  if (ratio >= 70) return 'positive';
  if (ratio >= 40) return 'ratio-mid';
  return 'negative';
}

export default function PoolTable({ pools }) {
  const [sortKey, setSortKey] = useState('apr');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedId, setExpandedId] = useState(null);

  const sortedPools = useMemo(() => {
    return [...pools].sort((a, b) => {
      const aVal = a[sortKey] || 0;
      const bVal = b[sortKey] || 0;
      if (typeof aVal === 'string') {
        return sortDir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
      }
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
          const chainName = CHAINS[pool.chainId]?.name || `Chain ${pool.chainId}`;
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
                  <div className="pool-name">{pool.vfname || pool.pair}</div>
                  <div className="pool-dex">
                    {chainName}
                    {pool.hasGauge ? ' 🏆' : ''}
                  </div>
                </td>
                <td className="protocol">{pool.protocol}</td>
                <td className={aprColor(pool.apr)}>
                  <strong>{pool.apr}%</strong>
                  {pool.stakingApr > 0 && (
                    <div className="apr-detail">Staking: {pool.stakingApr}%</div>
                  )}
                </td>
                <td>{pool.maxApr > 0 ? `${pool.maxApr}%` : '-'}</td>
                <td className="tvl">{formatUsd(pool.tvl)}</td>
                <td className="range">{pool.rangePct}%</td>
                <td>{pool.tickSpacing}</td>
                <td>{formatUsd(pool.rewardsWeek)}</td>
                <td className={ratioColor(pool.inRangeRatio)}>
                  {pool.inRangeRatio}%
                </td>
              </tr>
              {isExpanded && (
                <tr key={`${pool.id}-chart`} className="chart-row">
                  <td colSpan={COLUMNS.length}>
                    <PoolChart pool={pool} />
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
