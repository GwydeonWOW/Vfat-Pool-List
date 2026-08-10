import { useEffect, useState } from 'react';
import { comparePools } from './api';
import { formatUsd } from './PoolTable';

const rows = [
  ['Opportunity score', p => p._risk?.total ?? '-'], ['Estimated net/day', p => p._risk ? formatUsd(p._risk.estimatedNetDaily) : '-'],
  ['Estimated gross/day', p => p._risk ? formatUsd(p._risk.estimatedGrossDaily) : '-'],
  ['Pool rewards/day', p => p._risk?.poolRewardsDaily != null ? formatUsd(p._risk.poolRewardsDaily) : '-'],
  ['Estimated exits/day', p => p._risk?.estimatedExitsPerDay ?? '-'], ['Rebalance cost/day', p => p._risk ? formatUsd(p._risk.rebalanceCostDaily) : '-'],
  ['Meets $30/day', p => p._risk?.meetsTarget ? 'Yes' : 'No'], ['Confidence', p => p._risk ? `${p._risk.confidence}%` : '-'],
  ['APR', p => `${p.apr || 0}%`], ['Fee APR', p => `${p.feeApr || 0}%`], ['Reward APR', p => `${p.rewardApr || 0}%`],
  ['TVL', p => formatUsd(p.tvl)], ['Volume 24h', p => formatUsd(p.volume24h)],
  ['Volume/TVL', p => p.tvl ? (p.volume24h / p.tvl).toFixed(2) : '-'], ['Fee', p => `${p.feePct || 0}%`],
  ['Data quality', p => p.dataQuality || 'unknown'],
];

export default function CompareView({ poolIds, profile, onRemove }) {
  const [pools, setPools] = useState([]); const [error, setError] = useState('');
  useEffect(() => {
    if (poolIds.length < 2) { setPools([]); return; }
    comparePools(poolIds).then(data => setPools((data.pools || []).map(p => ({ ...p, _risk: p.riskScores?.[profile] })))).catch(e => setError(e.message));
  }, [poolIds, profile]);
  if (poolIds.length < 2) return <div className="loading">Select between 2 and 4 pools using the Compare checkbox.</div>;
  return <section className="compare-view"><h2>Pool comparison · {profile}</h2>{error && <div className="error">{error}</div>}
    <div className="pool-table-wrapper"><table className="pool-table compare-table"><thead><tr><th>Metric</th>{pools.map(p => <th key={p.id}>{p.pair}<button className="icon-action" onClick={() => onRemove(p.id)} aria-label={`Remove ${p.pair}`}>×</button><small>{p.protocol} · {p.chain || p.chainId}</small></th>)}</tr></thead>
      <tbody>{rows.map(([label, value]) => <tr key={label}><th>{label}</th>{pools.map(p => <td key={p.id}>{value(p)}</td>)}</tr>)}</tbody></table></div>
    {pools.map(p => p._risk && <details key={p.id} className="risk-details"><summary>{p.pair}: opportunity breakdown</summary>{Object.entries(p._risk.components).map(([k,v]) => <span key={k}>{k}: {Number(v).toFixed(1)}</span>)}</details>)}
  </section>;
}
