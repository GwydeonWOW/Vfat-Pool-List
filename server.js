import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// ── Auth ──
const AUTH_FILE = join(__dirname, 'data', 'auth.json');

function getAuthConfig() {
  if (existsSync(AUTH_FILE)) {
    try { return JSON.parse(readFileSync(AUTH_FILE, 'utf-8')); } catch {}
  }
  return {
    username: process.env.AUTH_USER || 'admin',
    password: process.env.AUTH_PASS || 'changeme',
  };
}

function saveAuthConfig(config) {
  ensureDataDir();
  writeFileSync(AUTH_FILE, JSON.stringify(config), 'utf-8');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

const activeTokens = new Set();

// ── Data directory ──
const DATA_DIR = join(__dirname, 'data');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

// ── JSON file cache ──
function readCache(filename) {
  const filepath = join(DATA_DIR, filename);
  if (!existsSync(filepath)) return null;
  try {
    const raw = readFileSync(filepath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(filename, data) {
  ensureDataDir();
  const filepath = join(DATA_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data), 'utf-8');
}

// ── Fetch helper ──
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// ── VFat fetching ──
const VFAT_BASE = 'https://api.vfat.io/v4/farms';
const VFAT_CL_TYPES = [
  'AERO_SLIPSTREAM_GAUGE', 'PANCAKE_SWAP_V3', 'UNISWAP_V3',
  'UNISWAP_V4', 'THENA_V3', 'BMX_V4_FARM',
];

async function fetchVFatChain(chainId) {
  const farms = await fetchJSON(`${VFAT_BASE}?chainId=${chainId}`);
  const pools = [];
  for (const farm of farms) {
    const ftype = farm.type || '';
    if (!VFAT_CL_TYPES.includes(ftype)) continue;
    const pool = farm.pool || {};
    const tickSpacing = pool.tickSpacing;
    if (!tickSpacing || tickSpacing <= 0) continue;
    const snap = farm.snapshot || {};
    const apr = snap.apr;
    if (apr == null || apr <= 0) continue;

    const poolLiq = snap.poolLiquidity || 0;
    const inRangeLiq = snap.inRangeLiquidity || 0;
    const inRangeRatio = poolLiq > 0 ? (inRangeLiq / poolLiq * 100) : 0;
    const underlying = pool.underlying || [];
    const symbols = underlying.map((u) => u.symbol || '');
    const rewardsWeek = snap.rewardsPerWeek || 0;

    // Real rewards calc
    let realRewardsWeek = 0;
    const rewardSyms = [];
    for (const r of farm.rewards || []) {
      const rps = r.rewardsPerSecond;
      if (rps && rps !== '0' && rps !== 0) {
        const token = r.rewardToken || {};
        const price = token.price || 0;
        const decimals = token.decimals || 18;
        realRewardsWeek += (Number(rps) / (10 ** decimals)) * price * 604800;
        rewardSyms.push(token.symbol || '?');
      }
    }
    const hasRealRewards = realRewardsWeek > 0;

    const rangePct = parseFloat(((1.0001 ** tickSpacing - 1) * 100).toFixed(2));
    const pair = symbols.join('/');
    let vfname = pair;
    if (ftype === 'AERO_SLIPSTREAM_GAUGE') vfname = `CL${tickSpacing}-${pair}`;
    else if (ftype === 'PANCAKE_SWAP_V3') vfname = `${pair} (PCS V3)`;
    else if (ftype === 'UNISWAP_V3') vfname = `${pair} (Uni V3)`;
    else if (ftype === 'UNISWAP_V4') vfname = `${pair} (Uni V4)`;
    else if (ftype === 'THENA_V3') vfname = `${pair} (Thena)`;
    else if (ftype === 'BMX_V4_FARM') vfname = `${pair} (BMX V4)`;

    pools.push({
      id: `${farm.chainId}-${farm.address}`,
      chainId: farm.chainId,
      protocol: farm.protocol?.name || '?',
      type: ftype,
      pair, vfname,
      poolAddr: pool.address,
      farmAddr: farm.address,
      tickSpacing, rangePct,
      currentTick: pool.tick || null,
      sqrtPrice: pool.sqrtPrice || null,
      fee: pool.fee, currentFee: pool.currentFee,
      apr: parseFloat(apr.toFixed(2)),
      stakingApr: parseFloat((snap.stakingApr || 0).toFixed(2)),
      lpApr: parseFloat((snap.lpApr || 0).toFixed(2)),
      maxApr: parseFloat((snap.maxApr || 0).toFixed(2)),
      tvl: parseFloat(poolLiq.toFixed(2)),
      inRangeLiquidity: parseFloat(inRangeLiq.toFixed(2)),
      inRangeRatio: parseFloat(inRangeRatio.toFixed(1)),
      activeLiquidity: parseFloat((snap.activeLiquidity || 0).toFixed(2)),
      rewardsWeek: parseFloat(rewardsWeek.toFixed(2)),
      realRewardsWeek: parseFloat(realRewardsWeek.toFixed(2)),
      feesWeek: parseFloat(Math.max(0, rewardsWeek - realRewardsWeek).toFixed(2)),
      hasRealRewards,
      rewardTokens: rewardSyms.length > 0 ? [...new Set(rewardSyms)].sort().join(', ') : '(fees only)',
      hasGauge: (snap.stakingApr || 0) > 0,
      underlying: underlying.map((u) => ({
        symbol: u.symbol || '', address: u.address || '',
        price: u.price || 0, name: u.name || '',
      })),
    });
  }
  return pools;
}

async function refreshVFat() {
  const CHAINS = [8453, 56, 43114, 137, 10, 146, 999, 143];
  const allPools = [];
  for (const chainId of CHAINS) {
    try {
      console.log(`[VFat] Fetching chain ${chainId}...`);
      const pools = await fetchVFatChain(chainId);
      allPools.push(...pools);
      console.log(`[VFat] Chain ${chainId}: ${pools.length} pools`);
    } catch (err) {
      console.error(`[VFat] Chain ${chainId} error:`, err.message);
    }
  }
  const cache = { timestamp: Date.now(), pools: allPools };
  writeCache('vfat.json', cache);
  console.log(`[VFat] Total: ${allPools.length} pools cached`);
  return cache;
}

// ── Raydium fetching ──
async function refreshRaydium() {
  const allPools = [];
  for (let page = 1; page <= 5; page++) {
    try {
      console.log(`[Raydium] Fetching page ${page}...`);
      const data = await fetchJSON(
        `https://api-v3.raydium.io/pools/info/list?poolType=concentrated&poolSortField=default&sortType=desc&pageSize=1000&page=${page}`
      );
      const rawPools = data?.data?.data || [];
      if (rawPools.length === 0) break;

      for (const raw of rawPools) {
        const config = raw.config || {};
        const tickSpacing = config.tickSpacing;
        if (!tickSpacing || tickSpacing <= 0) continue;

        const week = raw.week || {};
        const day = raw.day || {};
        const apr = week.apr || day.apr || 0;
        const feeApr = week.feeApr || day.feeApr || 0;
        const rewardAprs = week.rewardApr || day.rewardApr || [];
        const totalRewardApr = rewardAprs.reduce((s, r) => s + (r || 0), 0);

        const rewardInfos = raw.rewardDefaultInfos || [];
        const activeRewards = rewardInfos.filter((r) => Number(r.perSecond || 0) > 0);
        const hasRealRewards = activeRewards.length > 0 || totalRewardApr > 0;
        const rewardTokens = activeRewards.length > 0
          ? [...new Set(activeRewards.map((r) => r.mint?.symbol || '?'))].join(', ')
          : '(fees only)';

        const rangePct = parseFloat(((1.0001 ** tickSpacing - 1) * 100).toFixed(2));
        const feeRate = raw.feeRate || 0;

        allPools.push({
          id: raw.id,
          protocol: 'Raydium',
          type: raw.type || '',
          pair: `${raw.mintA?.symbol || '?'}/${raw.mintB?.symbol || '?'}`,
          chain: 'Solana',
          poolAddr: raw.id,
          tickSpacing, rangePct,
          feePct: feeRate * 100,
          tvl: raw.tvl || 0,
          apr: parseFloat(apr.toFixed(2)),
          feeApr: parseFloat(feeApr.toFixed(2)),
          rewardApr: parseFloat(totalRewardApr.toFixed(2)),
          hasRealRewards, rewardTokens,
          price: raw.price || 0,
          volume24h: day.volume || 0,
          volume7d: week.volume || 0,
          farmCount: raw.farmOngoingCount || 0,
          underlying: [
            { symbol: raw.mintA?.symbol || '', address: raw.mintA?.address || '' },
            { symbol: raw.mintB?.symbol || '', address: raw.mintB?.address || '' },
          ],
        });
      }

      if (!data?.data?.hasNextPage) break;
    } catch (err) {
      console.error(`[Raydium] Page ${page} error:`, err.message);
    }
    if (page < 5) await new Promise((r) => setTimeout(r, 300));
  }
  const cache = { timestamp: Date.now(), pools: allPools };
  writeCache('raydium.json', cache);
  console.log(`[Raydium] Total: ${allPools.length} pools cached`);
  return cache;
}

// ── Turbos fetching ──
async function refreshTurbos() {
  const allPools = [];
  for (let page = 1; page <= 7; page++) {
    try {
      console.log(`[Turbos] Fetching page ${page}...`);
      const data = await fetchJSON(
        `https://api2.turbos.finance/pools?page=${page}&pageSize=100&sort=volume_24h_usd&includeRisky=false&direction=desc&includeLowLiquidity=false`
      );
      const rawPools = data?.result || [];
      if (rawPools.length === 0) break;

      for (const raw of rawPools) {
        const tickSpacing = Number(raw.tick_spacing || 0);
        if (tickSpacing <= 0) continue;

        const rewardInfos = raw.reward_infos || [];
        const activeRewards = rewardInfos.filter((r) => Number(r.emissions_per_second || 0) > 0);
        const rewardApr = Number(raw.reward_apr || 0);
        const hasRealRewards = activeRewards.length > 0 || rewardApr > 0;

        const rewardTokens = activeRewards.length > 0
          ? activeRewards.map((r) => {
              const vct = r.vault_coin_type || '';
              const parts = vct.split('::');
              return parts.length > 1 ? parts[parts.length - 1] : vct.slice(-8);
            }).join(', ')
          : '(fees only)';

        const rangePct = parseFloat(((1.0001 ** tickSpacing - 1) * 100).toFixed(2));
        const feeBps = Number(raw.fee || 0);

        allPools.push({
          id: `turbos-${raw.id}`,
          protocol: 'Turbos Finance',
          type: raw.type || '',
          pair: `${raw.coin_symbol_a || '?'}/${raw.coin_symbol_b || '?'}`,
          chain: 'Sui',
          poolAddr: raw.pool_id || '',
          tickSpacing, rangePct,
          feePct: feeBps / 100,
          tvl: raw.liquidity_usd || 0,
          apr: parseFloat(Number(raw.apr || 0).toFixed(2)),
          feeApr: parseFloat(Number(raw.fee_apr || 0).toFixed(2)),
          rewardApr: parseFloat(rewardApr.toFixed(2)),
          apr7d: parseFloat(Number(raw.apr_7d || 0).toFixed(2)),
          hasRealRewards, rewardTokens,
          volume24h: Number(raw.volume_24h_usd || 0),
          volume7d: Number(raw.volume_7d_usd || 0),
          liquidity: Number(raw.liquidity || 0),
          unlocked: raw.unlocked !== false,
          underlying: [
            { symbol: raw.coin_symbol_a || '', address: raw.coin_type_a || '' },
            { symbol: raw.coin_symbol_b || '', address: raw.coin_type_b || '' },
          ],
        });
      }

      const total = data?.total || 0;
      if (page * 100 >= total) break;
    } catch (err) {
      console.error(`[Turbos] Page ${page} error:`, err.message);
    }
    if (page < 7) await new Promise((r) => setTimeout(r, 300));
  }
  const cache = { timestamp: Date.now(), pools: allPools };
  writeCache('turbos.json', cache);
  console.log(`[Turbos] Total: ${allPools.length} pools cached`);
  return cache;
}

// ── Pool Analysis (info-api.vf.at) ──
const INFO_API = 'https://info-api.vf.at';
const POSITIONS_TTL = 15 * 60 * 1000;

async function infoFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Cache sickle positions per chain using hybrid approach
async function fetchAllSicklePositions(chainId) {
  const filename = `sickle-positions-${chainId}.json`;
  const cached = readCache(filename);
  if (cached && Date.now() - cached.timestamp < POSITIONS_TTL) return cached;

  console.log(`[Positions] Fetching positions for chain ${chainId}...`);

  // Step 1: Fast base from all-open-positions (covers ~99% of active positions)
  let basePositions = [];
  try {
    const allData = await infoFetch(`${INFO_API}/all-open-positions?chain_id=${chainId}`);
    basePositions = (allData.data || []).map((p) => ({
      sickle_address: p.sickle_address?.toLowerCase(),
      owner_address: (p.owner_address || p.sickle_address || '').toLowerCase(),
      token_id: p.token_id,
      type: p.type || '',
      staking_contract: p.staking_contract?.toLowerCase() || null,
      pool_address: null,
      farm_address: null,
      price: p.price || 0,
      protocol_name: p.protocol_name || '',
      underlying: (p.underlying_assets || []).map((u) => ({
        symbol: u.symbol || '',
        address: u.address?.toLowerCase() || '',
      })),
    }));
    console.log(`[Positions] Chain ${chainId}: ${basePositions.length} from all-open-positions`);
  } catch (err) {
    console.log(`[Positions] Chain ${chainId}: all-open-positions failed (${err.message}), using full scan`);
  }

  // Step 2: Get complete sickle list from v4 API
  const sicklesData = await fetchJSON('https://api.vfat.io/v4/sickles');
  const allSickles = sicklesData
    .filter((s) => s.chainId === chainId)
    .map((s) => ({ sickle: s.sickleAddress?.toLowerCase(), admin: s.adminAddress?.toLowerCase() }))
    .filter((s) => s.sickle);

  // Step 3: Find sickles NOT in base data — only query those
  const knownSickles = new Set(basePositions.map((p) => p.sickle_address).filter(Boolean));
  const missingSickles = allSickles.filter((s) => !knownSickles.has(s.sickle));

  console.log(`[Positions] Chain ${chainId}: ${missingSickles.length} sickles to query individually`);

  const extraPositions = [];
  let idx = 0;
  const CONCURRENCY = 50;

  async function processNext() {
    while (idx < missingSickles.length) {
      const { sickle, admin } = missingSickles[idx++];
      try {
        const data = await infoFetch(
          `${INFO_API}/open-positions-v2?chain_id=${chainId}&sickle_address=${sickle}`
        );
        const positions = data.data || [];
        for (const pos of positions) {
          if (pos.price > 0) {
            extraPositions.push({
              sickle_address: sickle,
              owner_address: admin || sickle,
              token_id: pos.token_id,
              type: pos.type || '',
              staking_contract: pos.staking_contract?.toLowerCase() || null,
              pool_address: pos.nft?.pool_address?.toLowerCase() || null,
              farm_address: pos.farm_address?.toLowerCase() || null,
              price: pos.price || 0,
              protocol_name: pos.protocol_name || '',
              underlying: (pos.underlying || []).map((u) => ({
                symbol: u.symbol || '',
                address: u.address?.toLowerCase() || '',
              })),
            });
          }
        }
      } catch {
        // Skip failed queries (rate limit, timeout, etc.)
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, missingSickles.length) },
    () => processNext()
  );
  await Promise.all(workers);

  // Merge: base + extras
  const allPositions = [...basePositions, ...extraPositions];
  const result = { timestamp: Date.now(), positions: allPositions };
  writeCache(filename, result);
  console.log(`[Positions] Chain ${chainId}: ${allPositions.length} total (${basePositions.length} base + ${extraPositions.length} extra from ${missingSickles.length} sickles)`);
  return result;
}

async function findPoolInfo(chainId, address) {
  const addr = address.toLowerCase();

  // 1. Try local vfat cache
  const vfat = readCache('vfat.json');
  if (vfat?.pools) {
    const found = vfat.pools.find(
      (p) => p.chainId === chainId &&
        (p.poolAddr?.toLowerCase() === addr || p.farmAddr?.toLowerCase() === addr)
    );
    if (found) return found;
  }

  // 2. Fallback: live lookup from vfat API (includes pools filtered out of cache)
  try {
    const farms = await fetchJSON(`${VFAT_BASE}?chainId=${chainId}`);
    for (const farm of farms) {
      const poolAddr = (farm.pool?.address || '').toLowerCase();
      const farmAddr = (farm.address || '').toLowerCase();
      if (poolAddr === addr || farmAddr === addr) {
        const pool = farm.pool || {};
        const snap = farm.snapshot || {};
        const underlying = pool.underlying || [];
        return {
          pair: underlying.map((u) => u.symbol || '').join('/'),
          protocol: farm.protocol?.name || '?',
          type: farm.type || '',
          tvl: snap.poolLiquidity || 0,
          apr: snap.apr || 0,
          stakingApr: snap.stakingApr || 0,
          rangePct: parseFloat(((1.0001 ** (pool.tickSpacing || 1) - 1) * 100).toFixed(2)),
          tickSpacing: pool.tickSpacing || 0,
          rewardsWeek: snap.rewardsPerWeek || 0,
          inRangeRatio: snap.poolLiquidity > 0 ? ((snap.inRangeLiquidity || 0) / snap.poolLiquidity * 100) : 0,
          poolAddr: pool.address || addr,
          farmAddr: farm.address || addr,
          underlying: underlying.map((u) => ({ symbol: u.symbol || '', address: u.address || '' })),
        };
      }
    }
  } catch (err) {
    console.log(`[findPoolInfo] Live lookup failed: ${err.message}`);
  }

  return null;
}

// Match positions to a pool using ALL strategies, combine results without duplicates
// When poolInfo is null, derives token pair from matched positions to find ALL holders
function filterPositionsForPool(positions, poolInfo, inputAddr) {
  const addr = inputAddr.toLowerCase();
  const poolAddr = poolInfo?.poolAddr?.toLowerCase();
  const farmAddr = poolInfo?.farmAddr?.toLowerCase();

  const seen = new Set();
  const results = [];

  function addUnique(pos) {
    const key = `${pos.sickle_address}-${pos.token_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(pos);
    }
  }

  // Phase 1: Direct address matching
  for (const p of positions) {
    if (p.pool_address && (p.pool_address === poolAddr || p.pool_address === addr)) addUnique(p);
    if (p.farm_address && (p.farm_address === farmAddr || p.farm_address === addr)) addUnique(p);
    if (p.staking_contract && (p.staking_contract === farmAddr || p.staking_contract === poolAddr || p.staking_contract === addr)) addUnique(p);
  }

  // Phase 2: Token pair matching
  // If poolInfo has tokens use those; otherwise derive from matched positions
  let poolTokens = null;
  if (poolInfo?.underlying?.length >= 2) {
    const tokens = poolInfo.underlying.map((u) => u.address?.toLowerCase()).filter(Boolean);
    if (tokens.length >= 2) poolTokens = new Set(tokens);
  }
  if (!poolTokens && results.length > 0) {
    // Derive token pair from first matched position
    const tokens = (results[0].underlying || []).map((u) => u.address?.toLowerCase()).filter(Boolean);
    if (tokens.length >= 2) poolTokens = new Set(tokens);
  }

  if (poolTokens && poolTokens.size >= 2) {
    for (const p of positions) {
      const posTokens = new Set(
        (p.underlying || []).map((a) => a.address?.toLowerCase()).filter(Boolean)
      );
      if ([...poolTokens].every((t) => posTokens.has(t))) addUnique(p);
    }
  }

  console.log(`[Filter] poolInfo=${!!poolInfo} poolAddr=${poolAddr} farmAddr=${farmAddr} addr=${addr} tokenMatch=${!!poolTokens} results=${results.length}`);
  return results;
}

// ── Auth routes ──

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const config = getAuthConfig();
  if (username === config.username && password === config.password) {
    const token = generateToken();
    activeTokens.add(token);
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/auth/change', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !activeTokens.has(auth.replace('Bearer ', ''))) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  saveAuthConfig({ username, password });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth) activeTokens.delete(auth.replace('Bearer ', ''));
  res.json({ ok: true });
});

// ── Auth middleware (protect /api routes except auth) ──

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  const auth = req.headers.authorization;
  if (!auth || !activeTokens.has(auth.replace('Bearer ', ''))) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// ── API routes ──

app.get('/api/vfat', (req, res) => {
  const cache = readCache('vfat.json');
  if (!cache) {
    return res.json({ timestamp: null, pools: [], stale: true });
  }
  res.json({ ...cache, stale: Date.now() - cache.timestamp > 15 * 60 * 1000 });
});

app.get('/api/raydium', (req, res) => {
  const cache = readCache('raydium.json');
  if (!cache) {
    return res.json({ timestamp: null, pools: [], stale: true });
  }
  res.json({ ...cache, stale: Date.now() - cache.timestamp > 15 * 60 * 1000 });
});

app.get('/api/turbos', (req, res) => {
  const cache = readCache('turbos.json');
  if (!cache) {
    return res.json({ timestamp: null, pools: [], stale: true });
  }
  res.json({ ...cache, stale: Date.now() - cache.timestamp > 15 * 60 * 1000 });
});

app.get('/api/status', (req, res) => {
  const vfat = readCache('vfat.json');
  const raydium = readCache('raydium.json');
  const turbos = readCache('turbos.json');
  res.json({
    vfat: vfat ? { pools: vfat.pools.length, age: Math.round((Date.now() - vfat.timestamp) / 1000) } : null,
    raydium: raydium ? { pools: raydium.pools.length, age: Math.round((Date.now() - raydium.timestamp) / 1000) } : null,
    turbos: turbos ? { pools: turbos.pools.length, age: Math.round((Date.now() - turbos.timestamp) / 1000) } : null,
  });
});

// Manual refresh endpoint (GET to avoid reverse proxy POST issues)
app.get('/api/refresh/:source', async (req, res) => {
  const source = req.params.source;
  try {
    let result;
    if (source === 'vfat') result = await refreshVFat();
    else if (source === 'raydium') result = await refreshRaydium();
    else if (source === 'turbos') result = await refreshTurbos();
    else return res.status(400).json({ error: 'Unknown source' });
    res.json({ ok: true, pools: result.pools.length, timestamp: result.timestamp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pre-cache sickle positions for a chain (background)
app.get('/api/cache-positions/:chainId', async (req, res) => {
  const chainId = Number(req.params.chainId);
  res.json({ ok: true, message: 'Started caching positions in background' });
  fetchAllSicklePositions(chainId).catch((err) => {
    console.error(`[CachePositions] Chain ${chainId} error:`, err.message);
  });
});

// Pool analysis endpoint — always fetches fresh data for the target pool
app.get('/api/pool-analysis', async (req, res) => {
  req.setTimeout(300000); // 5 min
  const chainId = Number(req.query.chainId);
  const address = (req.query.address || '').trim();
  if (!chainId || !address) {
    return res.status(400).json({ error: 'chainId and address are required' });
  }

  try {
    const poolInfo = await findPoolInfo(chainId, address);
    console.log(`[PoolAnalysis] Chain ${chainId}, address ${address}, pool found: ${!!poolInfo}`);

    // Step 1: Fast base from all-open-positions
    let basePositions = [];
    try {
      const allData = await infoFetch(`${INFO_API}/all-open-positions?chain_id=${chainId}`);
      basePositions = (allData.data || []).map((p) => ({
        sickle_address: p.sickle_address?.toLowerCase(),
        owner_address: (p.owner_address || p.sickle_address || '').toLowerCase(),
        token_id: p.token_id,
        type: p.type || '',
        staking_contract: p.staking_contract?.toLowerCase() || null,
        pool_address: null,
        farm_address: null,
        price: Number(p.price) || 0,
        protocol_name: p.protocol_name || '',
        underlying: (p.underlying_assets || []).map((u) => ({
          symbol: u.symbol || '',
          address: u.address?.toLowerCase() || '',
        })),
      })).filter(p => p.price > 0);
      console.log(`[PoolAnalysis] ${basePositions.length} positions from all-open-positions`);
    } catch (err) {
      console.log(`[PoolAnalysis] all-open-positions failed: ${err.message}`);
    }

    // Step 2: Query ALL sickles for this chain to find positions not in the base data
    console.log(`[PoolAnalysis] Starting full sickle scan for chain ${chainId}...`);
    const sicklesData = await fetchJSON('https://api.vfat.io/v4/sickles');
    const allSickles = sicklesData
      .filter((s) => s.chainId === chainId)
      .map((s) => ({ sickle: s.sickleAddress?.toLowerCase(), admin: s.adminAddress?.toLowerCase() }))
      .filter((s) => s.sickle);
    console.log(`[PoolAnalysis] ${allSickles.length} sickles on chain ${chainId}`);

    const knownSickles = new Set(basePositions.map((p) => p.sickle_address).filter(Boolean));
    const missingSickles = allSickles.filter((s) => !knownSickles.has(s.sickle));
    console.log(`[PoolAnalysis] ${missingSickles.length} sickles not in base data — querying individually`);

    // Query missing sickles with high concurrency
    const extraPositions = [];
    let idx = 0;
    const CONCURRENCY = 75;

    async function processNext() {
      while (idx < missingSickles.length) {
        const { sickle, admin } = missingSickles[idx++];
        try {
          const data = await infoFetch(
            `${INFO_API}/open-positions-v2?chain_id=${chainId}&sickle_address=${sickle}`
          );
          for (const pos of data.data || []) {
            if (pos.price > 0) {
              extraPositions.push({
                sickle_address: sickle,
                owner_address: admin || sickle,
                token_id: pos.token_id,
                type: pos.type || '',
                staking_contract: pos.staking_contract?.toLowerCase() || null,
                pool_address: pos.nft?.pool_address?.toLowerCase() || null,
                farm_address: pos.farm_address?.toLowerCase() || null,
                price: pos.price || 0,
                protocol_name: pos.protocol_name || '',
                underlying: (pos.underlying || []).map((u) => ({
                  symbol: u.symbol || '',
                  address: u.address?.toLowerCase() || '',
                })),
              });
            }
          }
        } catch { /* skip failed */ }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, missingSickles.length) }, () => processNext())
    );

    // Merge all positions
    const allPositions = [...basePositions, ...extraPositions];
    console.log(`[PoolAnalysis] Total: ${allPositions.length} positions (${basePositions.length} base + ${extraPositions.length} extra)`);

    // Cache for future queries
    writeCache(`sickle-positions-${chainId}.json`, { timestamp: Date.now(), positions: allPositions });

    if (allPositions.length === 0) {
      return res.json({
        pool: poolInfo || { chainId },
        holders: { total: 0, totalValue: 0, top: [] },
      });
    }

    const farmPositions = filterPositionsForPool(allPositions, poolInfo, address);
    console.log(`[PoolAnalysis] ${farmPositions.length} positions matched for pool`);
    res.json(buildAnalysisResponse(poolInfo, farmPositions, chainId));
  } catch (err) {
    console.error('[PoolAnalysis] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function buildAnalysisResponse(poolInfo, farmPositions, chainId) {
  const byOwner = {};
  for (const pos of farmPositions) {
    const owner = (pos.owner_address || pos.sickle_address || '').toLowerCase();
    if (!owner) continue;
    if (!byOwner[owner]) byOwner[owner] = { address: owner, value: 0, positions: 0 };
    byOwner[owner].value += pos.price || 0;
    byOwner[owner].positions += 1;
  }

  const holders = Object.values(byOwner).sort((a, b) => b.value - a.value);
  const totalValue = holders.reduce((s, h) => s + h.value, 0);

  const top = holders.slice(0, 100).map((h, i) => ({
    rank: i + 1,
    address: h.address,
    value: parseFloat(h.value.toFixed(2)),
    pct: totalValue > 0 ? parseFloat(((h.value / totalValue) * 100).toFixed(1)) : 0,
    positions: h.positions,
  }));

  return {
    pool: poolInfo ? {
      pair: poolInfo.pair, protocol: poolInfo.protocol, type: poolInfo.type,
      tvl: poolInfo.tvl, apr: poolInfo.apr, stakingApr: poolInfo.stakingApr,
      rangePct: poolInfo.rangePct, tickSpacing: poolInfo.tickSpacing,
      rewardsWeek: poolInfo.rewardsWeek, inRangeRatio: poolInfo.inRangeRatio,
      poolAddr: poolInfo.poolAddr, farmAddr: poolInfo.farmAddr, underlying: poolInfo.underlying,
    } : { chainId },
    holders: { total: holders.length, totalValue: parseFloat(totalValue.toFixed(2)), top },
  };
}

// ── Serve static files (dist/) ──
// Cache-bust JS/CSS assets (they have content hashes in filenames)
app.use(express.static(join(__dirname, 'dist'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  },
}));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// ── Background refresh (every 15 min) ──
const REFRESH_INTERVAL = 15 * 60 * 1000;

async function refreshAll() {
  console.log('[Refresh] Starting background refresh...');
  await refreshVFat();
  await refreshRaydium();
  await refreshTurbos();
  console.log('[Refresh] Done. Next refresh in 15 minutes.');
}

// Start server FIRST, then refresh data in background
ensureDataDir();
app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);

  // Initial data load in background
  const vfat = readCache('vfat.json');
  const raydium = readCache('raydium.json');
  const turbos = readCache('turbos.json');

  if (vfat && raydium && turbos) {
    console.log(`[Init] Cached data found: VFat ${vfat.pools.length}, Raydium ${raydium.pools.length}, Turbos ${turbos.pools.length}`);
    const now = Date.now();
    if (now - vfat.timestamp > REFRESH_INTERVAL) refreshVFat();
    if (now - raydium.timestamp > REFRESH_INTERVAL) refreshRaydium();
    if (now - turbos.timestamp > REFRESH_INTERVAL) refreshTurbos();
  } else {
    console.log('[Init] No cached data found, fetching all sources in background...');
    refreshAll();
  }

  // Start periodic refresh
  setInterval(refreshAll, REFRESH_INTERVAL);
});
