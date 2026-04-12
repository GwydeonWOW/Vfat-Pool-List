const BASE = '/api';

async function fetchJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getNetworks() {
  const data = await fetchJSON('/networks');
  return data.data.map((n) => ({
    id: n.id,
    name: n.attributes.name,
  }));
}

export async function getTrendingPools(networkId) {
  const data = await fetchJSON(`/networks/${networkId}/trending_pools`);
  return data.data.map(normalizePool);
}

export async function getPools(networkId, page = 1) {
  const data = await fetchJSON(`/networks/${networkId}/pools?page=${page}`);
  return {
    pools: data.data.map(normalizePool),
    hasNext: !!data.links?.next,
  };
}

export async function getOHLCV(networkId, poolAddress, timeframe = 'hour') {
  const data = await fetchJSON(
    `/networks/${networkId}/pools/${poolAddress}/ohlcv/${timeframe}?limit=168`
  );
  // data.data.attributes.ohlcv_list is array of [timestamp, open, high, low, close, volume]
  return data.data?.attributes?.ohlcv_list || [];
}

function normalizePool(pool) {
  const a = pool.attributes;
  return {
    id: pool.id,
    address: a.address,
    name: a.name,
    poolCreatedAt: a.pool_created_at,
    baseTokenPriceUsd: parseFloat(a.base_token_price_usd) || 0,
    quoteTokenPriceUsd: parseFloat(a.quote_token_price_usd) || 0,
    priceChangeM5: parseFloat(a.price_change_percentage?.m5) || 0,
    priceChangeH1: parseFloat(a.price_change_percentage?.h1) || 0,
    priceChangeH6: parseFloat(a.price_change_percentage?.h6) || 0,
    priceChangeH24: parseFloat(a.price_change_percentage?.h24) || 0,
    volumeUsdH24: parseFloat(a.volume_usd?.h24) || 0,
    volumeUsdH6: parseFloat(a.volume_usd?.h6) || 0,
    reserveInUsd: parseFloat(a.reserve_in_usd) || 0,
    fdvUsd: parseFloat(a.fdv_usd) || 0,
    marketCapUsd: parseFloat(a.market_cap_usd) || 0,
    transactionsH24: a.transactions?.h24
      ? (parseInt(a.transactions.h24.buys) || 0) + (parseInt(a.transactions.h24.sells) || 0)
      : 0,
    buysH24: parseInt(a.transactions?.h24?.buys) || 0,
    sellsH24: parseInt(a.transactions?.h24?.sells) || 0,
    baseToken: a.base_token_price_usd && pool.relationships?.base_token?.data
      ? { address: pool.relationships.base_token.data.id.split('_')[0] }
      : {},
    quoteToken: pool.relationships?.quote_token?.data
      ? { address: pool.relationships.quote_token.data.id.split('_')[0] }
      : {},
    dex: pool.relationships?.dex?.data?.id || '',
    networkId: pool.relationships?.network?.data?.id || '',
  };
}

// Map timeframe label to API timeframe param
export const TIMEFRAMES = {
  '1m': 'minute',
  '1h': 'hour',
  '1d': 'day',
};
