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
