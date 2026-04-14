import { useState, useMemo, Fragment } from 'react';
import { CHAINS } from './api';
import PoolChart from './PoolChart';

const COLUMNS = [
  { key: 'expand', label: '', sortable: false },
  { key: 'vfname', label: 'Pool', sortable: true },
  { key: 'protocol', label: 'Protocol', sortable: true },
  { key: 'score', label: 'Score', sortable: true },
  { key: 'apr', label: 'APR %', sortable: true },
  { key: 'maxApr', label: 'Max APR', sortable: true },
  { key: 'tvl', label: 'TVL', sortable: true },
  { key: 'rangePct', label: 'Range %', sortable: true },
  { key: 'tickSpacing', label: 'Tick', sortable: true },
  { key: 'rewardsWeek', label: 'Rewards/wk', sortable: true },
  { key: 'inRangeRatio', label: 'In-Range %', sortable: true },
  { key: 'rsi', label: 'RSI', sortable: true },
];

function formatUsd(num) {
  if (!num || num === 0) return '$0';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
  return '$' + num.toFixed(2);
}

/**
 * Calculate risk-adjusted score:
 * - Base = APR
 * - Reward: high in-range ratio (stable position)
 * - Reward: moderate range (not too wide, not too tight)
 * - Reward: has gauge (staking rewards)
 * - Reward: high rewards/week
 * - Penalty: very low in-range ratio (position likely out of range)
 */
function calcScore(pool) {
  let score = pool.apr;

  // In-range ratio factor (0.0 to 1.0)
  const inRangeFactor = pool.inRangeRatio / 100;
  if (inRangeFactor >= 0.7) {
    score *= 1.0;
  } else if (inRangeFactor >= 0.4) {
    score *= 0.7;
  } else if (inRangeFactor >= 0.2) {
    score *= 0.4;
  } else {
    score *= 0.15;
  }

  // Range factor: sweet spot is 1-5%
  if (pool.rangePct >= 1 && pool.rangePct <= 5) {
    score *= 1.1;
  } else if (pool.rangePct > 10) {
    score *= 0.8;
  }

  // Gauge bonus (extra staking rewards = more sustainable)
  if (pool.hasGauge) {
    score *= 1.15;
  }

  // TVL factor: higher TVL = more established
  if (pool.tvl >= 100000) {
    score *= 1.1;
  } else if (pool.tvl < 10000) {
    score *= 0.8;
  }

  // Max APR factor: rewards potential when in tight range
  const maxApr = pool.maxApr || 0;
  if (maxApr > 4800) {
    score *= 1.3; // high ceiling = great potential
  } else if (maxApr > 3200) {
    score *= 1.0; // good range, no change
  } else if (maxApr > 0) {
    score *= 0.7; // low max = limited upside
  }

  return parseFloat(score.toFixed(1));
}

function aprColor(apr) {
  if (apr >= 500) return 'apr-extreme';
  if (apr >= 200) return 'apr-high';
  if (apr >= 50) return 'apr-mid';
  return 'apr-low';
}

function scoreColor(score) {
  if (score >= 200) return 'positive';
  if (score >= 50) return 'apr-mid';
  return 'score';
}

function ratioColor(ratio) {
  if (ratio >= 70) return 'positive';
  if (ratio >= 40) return 'ratio-mid';
  return 'negative';
}

function rsiColor(rsi) {
  if (rsi == null) return '';
  if (rsi >= 70) return 'rsi-high';
  if (rsi <= 30) return 'rsi-low';
  return 'rsi-mid';
}

function CopyAddr({ address, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!address) return null;

  return (
    <span className="copy-addr" onClick={handleCopy} title={`Click to copy ${label}`}>
      <span className="addr-label">{label}</span>
      <code>{address.slice(0, 6)}...{address.slice(-4)}</code>
      <span className="copy-icon">{copied ? '✓' : '📋'}</span>
    </span>
  );
}

export default function PoolTable({ pools, rsiData }) {
  const [sortKey, setSortKey] = useState('score');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedId, setExpandedId] = useState(null);

  // Pre-calculate scores and attach RSI for all pools
  const poolsWithScore = useMemo(() => {
    return pools.map((p) => ({
      ...p,
      score: calcScore(p),
      rsi: rsiData?.get(p.id) ?? null,
    }));
  }, [pools, rsiData]);

  const sortedPools = useMemo(() => {
    return [...poolsWithScore].sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      if (typeof aVal === 'string') {
        return sortDir === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
      }
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [poolsWithScore, sortKey, sortDir]);

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
    <div className="pool-table-wrapper">
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
            <Fragment key={pool.id}>
              <tr
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
                  <div className="pool-addrs">
                    <CopyAddr address={pool.farmAddr} label="Farm" />
                    <CopyAddr address={pool.poolAddr} label="Pool" />
                  </div>
                </td>
                <td className="protocol">{pool.protocol}</td>
                <td className={`score ${scoreColor(pool.score)}`}>
                  <strong>{pool.score}</strong>
                </td>
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
                <td>
                  <div>{formatUsd(pool.rewardsWeek)}</div>
                  {!pool.hasRealRewards && (
                    <div className="fees-only-label">fees only</div>
                  )}
                  {pool.hasRealRewards && pool.realRewardsWeek > 0 && (
                    <div className="rewards-detail">
                      <span className="rewards-token">+{formatUsd(pool.realRewardsWeek)}</span>
                    </div>
                  )}
                </td>
                <td className={ratioColor(pool.inRangeRatio)}>
                  {pool.inRangeRatio}%
                </td>
                <td className={`rsi ${rsiColor(pool.rsi)}`}>
                  {pool.rsi != null ? pool.rsi : '-'}
                </td>
              </tr>
              {isExpanded && (
                <tr className="chart-row">
                  <td colSpan={COLUMNS.length}>
                    <PoolChart pool={pool} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
