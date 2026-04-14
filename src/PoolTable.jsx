import { useState, useMemo, Fragment } from 'react';
import { CHAINS } from './api';
import PoolChart from './PoolChart';

// ── Shared utilities ──

export function formatUsd(num) {
  if (!num || num === 0) return '$0';
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
  return '$' + num.toFixed(2);
}

export function aprColor(apr) {
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

// ── VFat score calculation ──

function calcVfatScore(pool) {
  let score = pool.apr;

  if (pool.hasRealRewards) {
    score *= 1.5;
  } else {
    score *= 0.6;
  }

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

// ── Generic score for Raydium/Turbos ──

function calcGenericScore(pool) {
  let score = pool.apr;

  if (pool.hasRealRewards) {
    score *= 1.5;
  } else {
    score *= 0.6;
  }

  if (pool.rangePct >= 1 && pool.rangePct <= 5) score *= 1.1;
  else if (pool.rangePct > 10) score *= 0.8;

  if (pool.tvl >= 100000) score *= 1.1;
  else if (pool.tvl < 10000) score *= 0.8;

  return parseFloat(score.toFixed(1));
}

// ── Cell renderers ──

function renderVfatCell(pool, key, rsiData) {
  const chainName = CHAINS[pool.chainId]?.name || `Chain ${pool.chainId}`;

  switch (key) {
    case 'expand':
      return null;
    case 'vfname':
      return (
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
      );
    case 'score':
      return (
        <td className={`score ${pool.score >= 200 ? 'positive' : pool.score >= 50 ? 'apr-mid' : 'score'}`}>
          <strong>{pool.score}</strong>
        </td>
      );
    case 'apr':
      return (
        <td className={aprColor(pool.apr)}>
          <strong>{pool.apr}%</strong>
          {pool.stakingApr > 0 && (
            <div className="apr-detail">Staking: {pool.stakingApr}%</div>
          )}
        </td>
      );
    case 'maxApr':
      return <td>{pool.maxApr > 0 ? `${pool.maxApr}%` : '-'}</td>;
    case 'tvl':
      return <td className="tvl">{formatUsd(pool.tvl)}</td>;
    case 'rangePct':
      return <td className="range">{pool.rangePct}%</td>;
    case 'tickSpacing':
      return <td>{pool.tickSpacing}</td>;
    case 'rewardsWeek':
      return (
        <td>
          <div>{formatUsd(pool.rewardsWeek)}</div>
          {!pool.hasRealRewards && <div className="fees-only-label">fees only</div>}
          {pool.hasRealRewards && pool.realRewardsWeek > 0 && (
            <div className="rewards-detail">
              <span className="rewards-token">+{formatUsd(pool.realRewardsWeek)}</span>
            </div>
          )}
        </td>
      );
    case 'inRangeRatio':
      return <td className={ratioColor(pool.inRangeRatio)}>{pool.inRangeRatio}%</td>;
    case 'rsi': {
      const rsi = rsiData?.get(pool.id);
      return (
        <td className={`rsi ${rsiColor(rsi)}`}>
          {rsi != null ? rsi : '-'}
        </td>
      );
    }
    case 'protocol':
      return <td className="protocol">{pool.protocol}</td>;
    default:
      return <td>{pool[key] != null ? pool[key] : '-'}</td>;
  }
}

function renderGenericCell(pool, key) {
  switch (key) {
    case 'expand':
      return null;
    case 'pair':
      return (
        <td>
          <div className="pool-name">{pool.pair}</div>
          <div className="pool-dex">{pool.chain}</div>
          <div className="pool-addrs">
            <CopyAddr address={pool.poolAddr} label="Pool" />
          </div>
        </td>
      );
    case 'score':
      return (
        <td className={`score ${pool.score >= 200 ? 'positive' : pool.score >= 50 ? 'apr-mid' : 'score'}`}>
          <strong>{pool.score}</strong>
        </td>
      );
    case 'protocol':
      return <td className="protocol">{pool.protocol}</td>;
    case 'apr':
      return (
        <td className={aprColor(pool.apr)}>
          <strong>{pool.apr}%</strong>
        </td>
      );
    case 'feeApr':
      return <td>{pool.feeApr}%</td>;
    case 'rewardApr':
      return (
        <td className={pool.hasRealRewards ? 'positive' : ''}>
          {pool.rewardApr > 0 ? `${pool.rewardApr}%` : '-'}
        </td>
      );
    case 'tvl':
      return <td className="tvl">{formatUsd(pool.tvl)}</td>;
    case 'rangePct':
      return <td className="range">{pool.rangePct}%</td>;
    case 'tickSpacing':
      return <td>{pool.tickSpacing}</td>;
    case 'feePct':
      return <td>{pool.feePct}%</td>;
    case 'rewardTokens':
      return (
        <td>
          <div className="reward-token-list">{pool.rewardTokens}</div>
        </td>
      );
    case 'volume24h':
      return <td className="tvl">{formatUsd(pool.volume24h)}</td>;
    case 'farmCount':
      return <td>{pool.farmCount > 0 ? pool.farmCount : '-'}</td>;
    default:
      return <td>{pool[key] != null ? pool[key] : '-'}</td>;
  }
}

// ── Column definitions per source ──

export const VFAT_COLUMNS = [
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

export const RAYDIUM_COLUMNS = [
  { key: 'expand', label: '', sortable: false },
  { key: 'pair', label: 'Pool', sortable: true },
  { key: 'protocol', label: 'Protocol', sortable: false },
  { key: 'score', label: 'Score', sortable: true },
  { key: 'apr', label: 'APR %', sortable: true },
  { key: 'rewardApr', label: 'Reward APR', sortable: true },
  { key: 'tvl', label: 'TVL', sortable: true },
  { key: 'volume24h', label: 'Vol 24h', sortable: true },
  { key: 'rangePct', label: 'Range %', sortable: true },
  { key: 'feePct', label: 'Fee %', sortable: true },
  { key: 'tickSpacing', label: 'Tick', sortable: true },
  { key: 'rewardTokens', label: 'Rewards', sortable: false },
];

export const TURBOS_COLUMNS = [
  { key: 'expand', label: '', sortable: false },
  { key: 'pair', label: 'Pool', sortable: true },
  { key: 'protocol', label: 'Protocol', sortable: false },
  { key: 'score', label: 'Score', sortable: true },
  { key: 'apr', label: 'APR %', sortable: true },
  { key: 'rewardApr', label: 'Reward APR', sortable: true },
  { key: 'tvl', label: 'TVL', sortable: true },
  { key: 'volume24h', label: 'Vol 24h', sortable: true },
  { key: 'rangePct', label: 'Range %', sortable: true },
  { key: 'feePct', label: 'Fee %', sortable: true },
  { key: 'tickSpacing', label: 'Tick', sortable: true },
  { key: 'rewardTokens', label: 'Rewards', sortable: false },
];

// ── Generic PoolTable ──

export default function PoolTable({ pools, columns, rsiData, source = 'vfat' }) {
  const [sortKey, setSortKey] = useState('score');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedId, setExpandedId] = useState(null);

  const calcFn = source === 'vfat' ? calcVfatScore : calcGenericScore;

  const poolsWithScore = useMemo(() => {
    return pools.map((p) => ({
      ...p,
      score: calcFn(p),
    }));
  }, [pools, calcFn]);

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

  const renderCell = source === 'vfat' ? renderVfatCell : renderGenericCell;

  return (
    <div className="pool-table-wrapper">
      <table className="pool-table">
        <thead>
          <tr>
            {columns.map((col) => (
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
              <Fragment key={pool.id}>
                <tr
                  className={`pool-row${isExpanded ? ' expanded' : ''}`}
                  onClick={() => toggleExpand(pool.id)}
                >
                  {columns.map((col) => (
                    <Fragment key={col.key}>
                      {col.key === 'expand' ? (
                        <td className="expand-cell">
                          <span className={`expand-arrow${isExpanded ? ' open' : ''}`}>▶</span>
                        </td>
                      ) : (
                        renderCell(pool, col.key, rsiData)
                      )}
                    </Fragment>
                  ))}
                </tr>
                {isExpanded && source === 'vfat' && (
                  <tr className="chart-row">
                    <td colSpan={columns.length}>
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
