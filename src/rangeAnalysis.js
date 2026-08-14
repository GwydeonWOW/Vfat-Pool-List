function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function analyzeBestPriceRange(points, rangeWidthPct = 0.6, lookbackHours = 24) {
  const valid = (points || [])
    .filter((point) => Number(point?.time) > 0 && Number(point?.price) > 0)
    .map((point) => ({ time: Number(point.time), price: Number(point.price) }))
    .sort((a, b) => a.time - b.time);
  if (valid.length < 2) return null;

  const latestTime = valid.at(-1).time;
  const startTime = latestTime - Math.max(1, lookbackHours) * 3600;
  const temporal = valid.filter((point) => point.time >= startTime);
  if (temporal.length < 2) return null;

  const widthPct = Math.max(0.01, Number(rangeWidthPct) || 0.6);
  const widthMultiplier = 1 + widthPct / 100;
  const halfMultiplier = Math.sqrt(widthMultiplier);
  const prices = temporal.map((point) => point.price).sort((a, b) => a - b);
  let right = 0;
  let best = null;

  for (let left = 0; left < prices.length; left += 1) {
    if (right < left) right = left;
    const maxPrice = prices[left] * widthMultiplier;
    while (right + 1 < prices.length && prices[right + 1] <= maxPrice) right += 1;
    const count = right - left + 1;
    const low = prices[left];
    const high = prices[right];
    const spanPct = (high / low - 1) * 100;
    if (!best || count > best.count || (count === best.count && spanPct < best.spanPct)) {
      best = { count, low, high, spanPct };
    }
  }

  const center = Math.sqrt(best.low * best.high);
  const lower = center / halfMultiplier;
  const upper = center * halfMultiplier;
  const inside = temporal.map((point) => point.price >= lower && point.price <= upper);
  let exits = 0; let reentries = 0; let longestRun = 0; let run = 0;
  for (let index = 0; index < inside.length; index += 1) {
    if (inside[index]) { run += 1; longestRun = Math.max(longestRun, run); } else run = 0;
    if (index > 0 && inside[index - 1] && !inside[index]) exits += 1;
    if (index > 0 && !inside[index - 1] && inside[index]) reentries += 1;
  }

  let currentRun = 0;
  for (let index = inside.length - 1; index >= 0 && inside[index]; index -= 1) currentRun += 1;
  const intervals = temporal.slice(1).map((point, index) => point.time - temporal[index].time).filter((seconds) => seconds > 0);
  const intervalHours = median(intervals) / 3600;
  const occupancyPct = inside.filter(Boolean).length / inside.length * 100;
  const currentPrice = temporal.at(-1).price;
  const currentInside = currentPrice >= lower && currentPrice <= upper;
  const distancePct = currentPrice < lower
    ? (lower - currentPrice) / currentPrice * 100
    : currentPrice > upper ? (currentPrice - upper) / currentPrice * 100 : 0;

  let stability = 'unstable';
  if (currentInside && occupancyPct >= 70 && exits <= 3) stability = 'stable';
  else if ((currentInside && occupancyPct >= 45) || distancePct <= widthPct) stability = 'caution';

  return {
    lower, upper, center, widthPct,
    occupancyPct, outsidePct: 100 - occupancyPct,
    exits, reentries, currentInside, distancePct,
    longestInsideHours: longestRun * intervalHours,
    currentInsideHours: currentRun * intervalHours,
    observations: temporal.length,
    lookbackHours: Math.min(lookbackHours, (latestTime - temporal[0].time) / 3600),
    stability,
  };
}
