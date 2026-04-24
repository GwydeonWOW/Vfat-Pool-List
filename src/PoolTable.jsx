import { useState, Fragment } from 'react';
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

// ── VFat cell renderer ──

function renderVfatCell(pool, key, rsiData) {
  const chainName = CHAINS[pool.chainId]?.name || `Chain ${pool.chainId}`;
  switch (key) {
    case 'expand': return null;
    case 'vfname':
      return (
        <td>
          <div className="pool-name">{pool.vfname || pool.pair}</div>
          <div className="pool-dex">{chainName}{pool.hasGauge ? ' 🏆' : ''}</div>
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
    case 'protocol': return <td className="protocol">{pool.protocol}</td>;
    case 'apr':
      return (
        <td className={aprColor(pool.apr)}>
          <strong>{pool.apr}%</strong>
          {pool.stakingApr > 0 && <div className="apr-detail">Staking: {pool.stakingApr}%</div>}
        </td>
      );
    case 'maxApr': return <td>{pool.maxApr > 0 ? `${pool.maxApr}%` : '-'}</td>;
    case 'tvl': return <td className="tvl">{formatUsd(pool.tvl)}</td>;
    case 'rangePct': return <td className="range">{pool.rangePct}%</td>;
    case 'tickSpacing': return <td>{pool.tickSpacing}</td>;
    case 'rewardsWeek':
      return (
        <td>
          <div>{formatUsd(pool.rewardsWeek)}</div>
          {!pool.hasRealRewards && <div className="fees-only-label">fees only</div>}
          {pool.hasRealRewards && pool.realRewardsWeek > 0 && (
            <div className="rewards-detail"><span className="rewards-token">+{formatUsd(pool.realRewardsWeek)}</span></div>
          )}
        </td>
      );
    case 'inRangeRatio':
      return <td className={ratioColor(pool.inRangeRatio)}>{pool.inRangeRatio}%</td>;
    case 'rsi': {
      const rsi = rsiData?.get(pool.id);
      return <td className={`rsi ${rsiColor(rsi)}`}>{rsi != null ? rsi : '-'}</td>;
    }
    default: return <td>{pool[key] != null ? pool[key] : '-'}</td>;
  }
}

// ── Raydium cell renderer ──

function renderRaydiumCell(pool, key) {
  switch (key) {
    case 'expand': return null;
    case 'pair':
      return (
        <td>
          <div className="pool-name">{pool.pair}</div>
          <div className="pool-dex">Solana{pool.farmCount > 0 ? ' 🏆' : ''}</div>
          <div className="pool-addrs"><CopyAddr address={pool.poolAddr} label="Pool" /></div>
        </td>
      );
    case 'score':
      return (
        <td className={`score ${pool.score >= 200 ? 'positive' : pool.score >= 50 ? 'apr-mid' : 'score'}`}>
          <strong>{pool.score}</strong>
        </td>
      );
    case 'protocol': return <td className="protocol">{pool.protocol}</td>;
    case 'apr':
      return (
        <td className={aprColor(pool.apr)}>
          <strong>{pool.apr}%</strong>
          <div className="apr-detail">fee: {pool.feeApr}%</div>
        </td>
      );
    case 'rewardApr':
      return (
        <td className={pool.hasRealRewards ? 'positive' : ''}>
          {pool.rewardApr > 0 ? <strong>{pool.rewardApr}%</strong> : <span className="fees-only-label">-</span>}
          {pool.rewardTokens !== '(fees only)' && <div className="apr-detail">{pool.rewardTokens}</div>}
        </td>
      );
    case 'tvl': return <td className="tvl">{formatUsd(pool.tvl)}</td>;
    case 'volume7d': return <td className="tvl">{formatUsd(pool.volume7d)}</td>;
    case 'rangePct': return <td className="range">{pool.rangePct}%</td>;
    case 'feePct': return <td>{pool.feePct}%</td>;
    case 'tickSpacing': return <td>{pool.tickSpacing}</td>;
    default: return <td>{pool[key] != null ? pool[key] : '-'}</td>;
  }
}

// ── Turbos cell renderer ──

function renderTurbosCell(pool, key) {
  switch (key) {
    case 'expand': return null;
    case 'pair':
      return (
        <td>
          <div className="pool-name">{pool.pair}</div>
          <div className="pool-dex">Sui</div>
          <div className="pool-addrs"><CopyAddr address={pool.poolAddr} label="Pool" /></div>
        </td>
      );
    case 'score':
      return (
        <td className={`score ${pool.score >= 200 ? 'positive' : pool.score >= 50 ? 'apr-mid' : 'score'}`}>
          <strong>{pool.score}</strong>
        </td>
      );
    case 'protocol': return <td className="protocol">{pool.protocol}</td>;
    case 'apr':
      return (
        <td className={aprColor(pool.apr)}>
          <strong>{pool.apr}%</strong>
          <div className="apr-detail">fee: {pool.feeApr}%</div>
        </td>
      );
    case 'apr7d':
      return <td>{pool.apr7d > 0 ? `${pool.apr7d}%` : '-'}</td>;
    case 'rewardApr':
      return (
        <td className={pool.hasRealRewards ? 'positive' : ''}>
          {pool.rewardApr > 0 ? <strong>{pool.rewardApr}%</strong> : <span className="fees-only-label">-</span>}
          {pool.rewardTokens !== '(fees only)' && <div className="apr-detail">{pool.rewardTokens}</div>}
        </td>
      );
    case 'tvl': return <td className="tvl">{formatUsd(pool.tvl)}</td>;
    case 'volume24h': return <td className="tvl">{formatUsd(pool.volume24h)}</td>;
    case 'rangePct': return <td className="range">{pool.rangePct}%</td>;
    case 'feePct': return <td>{pool.feePct}%</td>;
    case 'tickSpacing': return <td>{pool.tickSpacing}</td>;
    default: return <td>{pool[key] != null ? pool[key] : '-'}</td>;
  }
}

// ── Column definitions ──

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
  { key: 'score', label: 'Score', sortable: true },
  { key: 'apr', label: 'APR %', sortable: true },
  { key: 'rewardApr', label: 'Reward APR', sortable: true },
  { key: 'tvl', label: 'TVL', sortable: true },
  { key: 'volume7d', label: 'Vol 7d', sortable: true },
  { key: 'rangePct', label: 'Range %', sortable: true },
  { key: 'feePct', label: 'Fee %', sortable: true },
  { key: 'tickSpacing', label: 'Tick', sortable: true },
];

export const TURBOS_COLUMNS = [
  { key: 'expand', label: '', sortable: false },
  { key: 'pair', label: 'Pool', sortable: true },
  { key: 'score', label: 'Score', sortable: true },
  { key: 'apr', label: 'APR %', sortable: true },
  { key: 'rewardApr', label: 'Reward APR', sortable: true },
  { key: 'apr7d', label: 'APR 7d', sortable: true },
  { key: 'tvl', label: 'TVL', sortable: true },
  { key: 'volume24h', label: 'Vol 24h', sortable: true },
  { key: 'rangePct', label: 'Range %', sortable: true },
  { key: 'feePct', label: 'Fee %', sortable: true },
  { key: 'tickSpacing', label: 'Tick', sortable: true },
];

// ── Renderers map ──

const RENDERERS = {
  vfat: renderVfatCell,
  raydium: renderRaydiumCell,
  turbos: renderTurbosCell,
};

// ── PoolTable: PURE RENDERING COMPONENT ──
// Single table, chart as <tr>. With pagination (30 rows) React handles this fine.

export default function PoolTable({ pools, columns, rsiData, source = 'vfat', onSort, sortKey, sortDir }) {
  const [expandedId, setExpandedId] = useState(null);

  const renderCell = RENDERERS[source] || renderRaydiumCell;

  const toggleExpand = (poolId) => {
    setExpandedId((prev) => (prev === poolId ? null : poolId));
  };

  // Build rows: pool row + optional chart row
  const rows = [];
  for (const pool of pools) {
    const isExpanded = expandedId === pool.id;

    rows.push(
      <tr
        key={pool.id}
        className={`pool-row${isExpanded ? ' expanded' : ''}`}
        onClick={() => toggleExpand(pool.id)}
      >
        {columns.map((col) => (
          col.key === 'expand' ? (
            <td key={col.key} className="expand-cell">
              <span className={`expand-arrow${isExpanded ? ' open' : ''}`}>▶</span>
            </td>
          ) : (
            <Fragment key={col.key}>
              {renderCell(pool, col.key, rsiData)}
            </Fragment>
          )
        ))}
      </tr>
    );

    if (isExpanded && source === 'vfat') {
      rows.push(
        <tr key={`${pool.id}-chart`} className="chart-row">
          <td colSpan={columns.length}>
            <PoolChart pool={pool} />
          </td>
        </tr>
      );
    }
  }

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
                      ? sortDir === 'desc' ? 'sorted-desc' : 'sorted-asc'
                      : ''
                    : ''
                }
                onClick={() => col.sortable && onSort && onSort(col.key)}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows}
        </tbody>
      </table>
    </div>
  );
}
