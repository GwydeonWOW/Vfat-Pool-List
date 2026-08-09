export const RISK_VERSION = '1.0';

export const PROFILE_WEIGHTS = {
  conservative: { returns: 20, liquidity: 20, efficiency: 10, stability: 20, volatility: 20, incentives: 5, confidence: 5 },
  balanced: { returns: 30, liquidity: 15, efficiency: 15, stability: 15, volatility: 15, incentives: 5, confidence: 5 },
  aggressive: { returns: 45, liquidity: 10, efficiency: 15, stability: 10, volatility: 5, incentives: 10, confidence: 5 },
};

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const logScore = (value, low, high) => clamp((Math.log10(Math.max(value, 1)) - low) / (high - low) * 100);

function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

export function calculateRiskScores(pool, history = [], now = Date.now()) {
  const valid = history.filter((x) => x.timestamp && now - x.timestamp <= 30 * 86400000);
  const prices = valid.map((x) => Number(x.price)).filter((x) => x > 0);
  const aprs = valid.map((x) => Number(x.apr)).filter(Number.isFinite);
  const tvls = valid.map((x) => Number(x.tvl)).filter((x) => x > 0);
  const returns = clamp(Math.log10(Math.max(1, pool.apr || 0) + 1) / Math.log10(1001) * 100);
  const liquidity = logScore(pool.tvl || 0, 4, 8);
  const efficiency = clamp(Math.log10(1 + (pool.volume24h || 0) / Math.max(pool.tvl || 1, 1)) / Math.log10(11) * 100);
  const aprVariation = aprs.length > 2 ? stdDev(aprs) / Math.max(1, Math.abs(aprs.reduce((a,b)=>a+b,0) / aprs.length)) : 1;
  const tvlVariation = tvls.length > 2 ? stdDev(tvls) / Math.max(1, tvls.reduce((a,b)=>a+b,0) / tvls.length) : 1;
  const stability = aprs.length > 2 && tvls.length > 2 ? clamp(100 - (aprVariation * 55 + tvlVariation * 45) * 100) : 50;
  const priceReturns = prices.slice(1).map((p, i) => Math.log(p / prices[i])).filter(Number.isFinite);
  const annualizedVol = priceReturns.length > 2 ? stdDev(priceReturns) * Math.sqrt(365 * 96) : 2;
  const volatility = priceReturns.length > 2 ? clamp(100 - annualizedVol * 50) : 50;
  const feeShare = (pool.apr || 0) > 0 ? (pool.feeApr || 0) / pool.apr : 0;
  const incentives = clamp(40 + feeShare * 60 - ((pool.hasRealRewards && !pool.rewardApr) ? 20 : 0));
  const oldest = valid[0]?.timestamp || now;
  const days = (now - oldest) / 86400000;
  const coverage = Math.min(1, valid.length / (30 * 96));
  const confidence = clamp(Math.min(days / 30, 1) * 60 + coverage * 40);
  const components = { returns, liquidity, efficiency, stability, volatility, incentives, confidence };
  const scores = {};
  for (const [profile, weights] of Object.entries(PROFILE_WEIGHTS)) {
    const rawTotal = Object.entries(weights).reduce((sum, [key, weight]) => sum + components[key] * weight / 100, 0);
    const total = rawTotal * (0.7 + 0.3 * confidence / 100);
    scores[profile] = { total: Number(total.toFixed(1)), components, confidence: Number(confidence.toFixed(1)), provisional: days < 7, version: RISK_VERSION };
  }
  return scores;
}
