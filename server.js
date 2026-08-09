import express from 'express';
import { readFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { openDatabase, createStore } from './lib/db.js';
import { calculateRiskScores } from './lib/risk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());
app.use(cookieParser());
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'", 'https://coins.llama.fi'], objectSrc: ["'none'"],
} } }));

// ── Auth ──
const AUTH_FILE = join(__dirname, 'data', 'auth.json');
const DATA_DIR = join(__dirname, 'data');
ensureDataDir();
const db = openDatabase(join(DATA_DIR, 'app.sqlite'));
const store = createStore(db);
const SESSION_MS = 24 * 60 * 60 * 1000;

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function passwordMatches(password, encoded) {
  const [salt, expected] = String(encoded).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function getAuthConfig() {
  return db.prepare('SELECT * FROM users WHERE id=1').get() || null;
}

function saveAuthConfig(config) {
  const now = Date.now();
  db.prepare(`INSERT INTO users(id,username,password_hash,created_at,updated_at) VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,updated_at=excluded.updated_at`)
    .run(config.username, passwordHash(config.password), now, now);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function createSession() {
  const token = generateToken();
  const now = Date.now();
  db.prepare('INSERT INTO sessions(token_hash,expires_at,last_seen_at) VALUES(?,?,?)').run(hashToken(token), now + SESSION_MS, now);
  return token;
}
function sessionToken(req) { return req.cookies.vfat_session || req.headers.authorization?.replace(/^Bearer\s+/i, ''); }
function validSession(req) {
  const token = sessionToken(req);
  if (!token) return false;
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hashToken(token), Date.now());
  if (!row) return false;
  db.prepare('UPDATE sessions SET last_seen_at=?,expires_at=? WHERE token_hash=?').run(Date.now(), Date.now() + SESSION_MS, hashToken(token));
  return true;
}

// ── Data directory ──
function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

// ── JSON file cache ──
function readCache(filename) {
  const provider = filename.replace(/\.json$/, '');
  const stored = store.readProvider(provider);
  if (stored) return stored;
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
  const provider = filename.replace(/\.json$/, '');
  const pools = (data.pools || []).map((pool) => normalizedPool(provider, pool));
  return store.writeProvider(provider, pools, data.timestamp || Date.now());
}

// ── Fetch helper ──
async function fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
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

async function infoFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
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

  // Token-pair fallback intentionally omitted: several CLMM pools can share the
  // same pair while differing by protocol, fee tier, and tick spacing.
  console.log(`[Filter] exact match poolInfo=${!!poolInfo} poolAddr=${poolAddr} farmAddr=${farmAddr} addr=${addr} results=${results.length}`);
  return results;
}

// ── Auth routes ──

function bootstrapUser() {
  if (getAuthConfig()) return;
  let legacy = null;
  if (existsSync(AUTH_FILE)) {
    try { legacy = JSON.parse(readFileSync(AUTH_FILE, 'utf-8')); } catch {}
  }
  const username = legacy?.username || process.env.AUTH_USER;
  const password = legacy?.password || process.env.AUTH_PASS;
  if (!username || !password || password === 'changeme') {
    throw new Error('Set AUTH_USER and a secure AUTH_PASS before first start');
  }
  saveAuthConfig({ username, password });
  if (legacy) { unlinkSync(AUTH_FILE); console.warn('[Auth] Legacy credentials migrated to encrypted database'); }
}

// ── Additional concentrated-liquidity providers ──

function normalizedPool(provider, raw) {
  const address = raw.poolAddr || raw.address || raw.id;
  return {
    ...raw,
    id: `${provider}:${raw.chain || raw.chainId || 'unknown'}:${address}`,
    provider,
    protocol: raw.protocol || provider[0].toUpperCase() + provider.slice(1),
    poolAddr: address,
    pair: raw.pair || (raw.underlying || []).map((t) => t.symbol || '?').join('/'),
    tvl: Number(raw.tvl || 0), apr: Number(raw.apr || 0),
    feeApr: Number(raw.feeApr || 0), rewardApr: Number(raw.rewardApr || 0),
    volume24h: Number(raw.volume24h || 0), volume7d: Number(raw.volume7d || 0),
    volume30d: Number(raw.volume30d || 0), price: Number(raw.price || 0),
    dataQuality: raw.dataQuality || 'verified', updatedAt: Date.now(),
  };
}

async function refreshOrca() {
  const pools = [];
  let next = null;
  do {
    const params = new URLSearchParams({ size: '100', stats: '24h,7d,30d', sortBy: 'tvl', sortDirection: 'desc', minTvl: '1000' });
    if (next) params.set('next', next);
    const payload = await fetchJSON(`https://api.orca.so/v2/solana/pools?${params}`);
    for (const p of payload.data || []) {
      const s24 = p.stats?.['24h'] || {}, s7 = p.stats?.['7d'] || {}, s30 = p.stats?.['30d'] || {};
      const tvl = Number(p.tvlUsdc || 0);
      const annual = (period, days) => Number(period.yieldOverTvl || 0) * 365 / days * 100;
      pools.push(normalizedPool('orca', {
        address: p.address, chain: 'solana', protocol: 'Orca', type: p.poolType || 'whirlpool',
        underlying: [p.tokenA, p.tokenB].filter(Boolean).map(t => ({ symbol: t.symbol || '?', address: t.address || '' })),
        tvl, apr: annual(s30, 30) || annual(s7, 7) || annual(s24, 1),
        feeApr: tvl ? Number(s30.fees || s7.fees || s24.fees || 0) / tvl * (s30.fees ? 365/30 : s7.fees ? 365/7 : 365) * 100 : 0,
        rewardApr: tvl ? Number(s30.rewards || s7.rewards || s24.rewards || 0) / tvl * (s30.rewards ? 365/30 : s7.rewards ? 365/7 : 365) * 100 : 0,
        volume24h: Number(s24.volume || 0), volume7d: Number(s7.volume || 0), volume30d: Number(s30.volume || 0),
        tickSpacing: Number(p.tickSpacing || 0), feePct: Number(p.feeRate || 0) / 1e6 * 100,
        price: Number(p.price || 0), hasRealRewards: Number(s24.rewards || s7.rewards || 0) > 0,
      }));
    }
    next = payload.meta?.next || null;
  } while (next && pools.length < 2000);
  return writeCache('orca.json', { timestamp: Date.now(), pools });
}

async function refreshCetus() {
  const endpoint = process.env.CETUS_API_URL || 'https://api-sui.cetus.zone/v2/sui/pools_info';
  const payload = await fetchJSON(endpoint);
  const rawPools = payload.data?.lp_list || payload.data?.pools || payload.data || [];
  const pools = (Array.isArray(rawPools) ? rawPools : []).map(p => normalizedPool('cetus', {
    address: p.address || p.pool_id, chain: 'sui', protocol: 'Cetus', type: 'CLMM',
    pair: `${p.coin_a?.symbol || p.symbol_a || '?'}/${p.coin_b?.symbol || p.symbol_b || '?'}`,
    underlying: [
      { symbol: p.coin_a?.symbol || p.symbol_a || '?', address: p.coin_a?.address || p.coin_type_a || '' },
      { symbol: p.coin_b?.symbol || p.symbol_b || '?', address: p.coin_b?.address || p.coin_type_b || '' },
    ],
    tvl: p.tvl_in_usd || p.tvl || 0, apr: p.apr || p.total_apr || 0,
    feeApr: p.fee_apr || 0, rewardApr: p.reward_apr || 0,
    volume24h: p.vol_in_usd_24h || p.volume_24h || 0,
    tickSpacing: Number(p.tick_spacing || 0), feePct: Number(p.fee_rate || 0) / 10000,
    price: p.current_price || 0, hasRealRewards: Number(p.reward_apr || 0) > 0,
    dataQuality: 'partial',
  })).filter(p => p.poolAddr);
  return writeCache('cetus.json', { timestamp: Date.now(), pools });
}

async function refreshUniswap() {
  if (!process.env.UNISWAP_API_KEY) throw new Error('UNISWAP_API_KEY is not configured');
  const base = process.env.UNISWAP_API_URL || 'https://interface.gateway.uniswap.org/v2/pools';
  const payload = await fetch(base, { headers: { 'x-api-key': process.env.UNISWAP_API_KEY }, signal: AbortSignal.timeout(30000) });
  if (!payload.ok) throw new Error(`Uniswap API error: ${payload.status}`);
  const body = await payload.json();
  const pools = (body.data?.pools || body.pools || []).map(p => normalizedPool('uniswap', {
    address: p.address || p.id, chain: p.chain || p.chainId, protocol: 'Uniswap', type: p.version || 'V3',
    underlying: [p.token0, p.token1].filter(Boolean).map(t => ({ symbol: t.symbol || '?', address: t.address || t.id || '' })),
    tvl: p.tvlUSD || p.totalValueLockedUSD || 0, apr: p.apr || 0, feeApr: p.feeApr || p.apr || 0,
    volume24h: p.volume24h || 0, volume7d: p.volume7d || 0, volume30d: p.volume30d || 0,
    tickSpacing: p.tickSpacing || 0, feePct: Number(p.feeTier || 0) / 10000,
  })).filter(p => p.poolAddr);
  return writeCache('uniswap.json', { timestamp: Date.now(), pools });
}

const PROVIDERS = {
  vfat: refreshVFat, raydium: refreshRaydium, turbos: refreshTurbos,
  uniswap: refreshUniswap, orca: refreshOrca, cetus: refreshCetus,
};
const refreshLocks = new Map();
async function refreshProvider(provider) {
  if (!PROVIDERS[provider]) throw new Error('Unknown source');
  if (refreshLocks.has(provider)) return refreshLocks.get(provider);
  const previous = readCache(`${provider}.json`);
  const task = PROVIDERS[provider]().catch(err => {
    store.markProviderError(provider, err.message);
    if (previous) return { ...previous, status: 'degraded', error: err.message };
    throw err;
  }).finally(() => refreshLocks.delete(provider));
  refreshLocks.set(provider, task);
  return task;
}

bootstrapUser();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const expensiveLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const config = getAuthConfig();
  if (config && username === config.username && passwordMatches(password || '', config.password_hash)) {
    const token = createSession();
    res.cookie('vfat_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_MS });
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/auth/change', (req, res) => {
  if (!validSession(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  saveAuthConfig({ username, password });
  db.prepare('DELETE FROM sessions').run();
  res.clearCookie('vfat_session');
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
  res.clearCookie('vfat_session');
  res.json({ ok: true });
});

app.get('/api/auth/session', (req, res) => res.json({ authenticated: validSession(req) }));

// ── Auth middleware (protect /api routes except auth) ──

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (!validSession(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// ── API routes ──

function enrichedCache(provider) {
  const cache = readCache(`${provider}.json`);
  if (!cache) {
    return { timestamp: null, pools: [], stale: true, status: provider === 'uniswap' && !process.env.UNISWAP_API_KEY ? 'disabled' : 'empty' };
  }
  const pools = cache.pools.map(pool => ({ ...pool, riskScores: calculateRiskScores(pool, store.history(pool.id, Date.now() - 30 * 86400000)) }));
  return { ...cache, pools, stale: Date.now() - cache.timestamp > 15 * 60 * 1000 };
}

for (const provider of Object.keys(PROVIDERS)) app.get(`/api/${provider}`, (req, res) => res.json(enrichedCache(provider)));

app.get('/api/status', (req, res) => {
  const status = {};
  for (const provider of Object.keys(PROVIDERS)) {
    const cache = readCache(`${provider}.json`);
    status[provider] = cache ? { pools: cache.pools.length, age: Math.round((Date.now() - cache.timestamp) / 1000), status: cache.status, error: cache.error } : null;
  }
  res.json(status);
});

app.post('/api/providers/:source/refresh', expensiveLimiter, async (req, res) => {
  const source = req.params.source.toLowerCase();
  try {
    const result = await refreshProvider(source);
    res.json({ ok: true, pools: result.pools.length, timestamp: result.timestamp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/refresh/:source', (_req, res) => res.status(405).json({ error: 'Use POST /api/providers/:source/refresh' }));

const PoolIdBody = z.object({ poolId: z.string().min(3).max(300) });
function currentPoolsById() {
  const pools = Object.keys(PROVIDERS).flatMap(provider => readCache(`${provider}.json`)?.pools || []);
  return new Map(pools.map(pool => [pool.id, pool]));
}
function enrichPool(pool) {
  return pool ? { ...pool, riskScores: calculateRiskScores(pool, store.history(pool.id, Date.now() - 30 * 86400000)) } : null;
}
app.get('/api/watchlist', (_req, res) => {
  const byId = currentPoolsById();
  res.json({ items: store.listWatchlist().map(item => {
    const pool = byId.get(item.pool_id);
    return { ...item, pool: enrichPool(pool), unavailable: !pool };
  }) });
});
app.post('/api/watchlist', (req, res) => {
  const parsed = PoolIdBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid poolId' });
  store.addWatchlist(parsed.data.poolId);
  res.status(201).json({ ok: true });
});
app.delete('/api/watchlist/:poolId', (req, res) => { store.removeWatchlist(req.params.poolId); res.json({ ok: true }); });
app.get('/api/compare', (req, res) => {
  const ids = String(req.query.poolIds || '').split(',').filter(Boolean);
  if (ids.length < 2 || ids.length > 4) return res.status(400).json({ error: 'Choose between 2 and 4 pools' });
  const byId = currentPoolsById();
  res.json({ pools: ids.map(id => enrichPool(byId.get(id))).filter(Boolean), missing: ids.filter(id => !byId.has(id)) });
});

// Fetch a single sickle's positions with shorter timeout and retry
// Pool analysis endpoint
app.get('/api/pool-analysis', expensiveLimiter, async (req, res) => {
  req.setTimeout(300000); // 5 min
  const chainId = Number(req.query.chainId);
  const address = (req.query.address || '').trim();
  if (!chainId || !address) {
    return res.status(400).json({ error: 'chainId and address are required' });
  }

  try {
    const poolInfo = await findPoolInfo(chainId, address);
    console.log(`[PoolAnalysis] Chain ${chainId}, addr ${address}, poolInfo: ${!!poolInfo}`);

    // Step 1: all-open-positions (fast base)
    let basePositions = [];
    try {
      const allData = await infoFetch(`${INFO_API}/all-open-positions?chain_id=${chainId}`);
      basePositions = (allData.data || [])
        .filter(p => Number(p.price) > 0)
        .map(p => ({
          sickle_address: p.sickle_address?.toLowerCase(),
          owner_address: (p.owner_address || p.sickle_address || '').toLowerCase(),
          token_id: p.token_id,
          staking_contract: p.staking_contract?.toLowerCase() || null,
          pool_address: null,
          farm_address: null,
          price: Number(p.price) || 0,
          underlying: (p.underlying_assets || []).map(u => ({
            symbol: u.symbol || '', address: u.address?.toLowerCase() || '',
          })),
        }));
      console.log(`[PoolAnalysis] ${basePositions.length} from all-open-positions`);
    } catch (err) {
      console.log(`[PoolAnalysis] all-open-positions failed: ${err.message}`);
    }

    // Step 2: positions-summary → get ACTIVE owners for this chain
    // Query by admin_address (not sickle_address) — sickle_address returns empty for some users
    const summaryData = await infoFetch(`${INFO_API}/positions-summary`);
    const chainOwners = [];
    for (const u of (summaryData.data || [])) {
      const sickle = (u.sickles_by_chain || {})[String(chainId)];
      if (sickle) chainOwners.push({ owner: u.owner_address?.toLowerCase(), sickle: sickle.toLowerCase() });
    }

    const knownOwners = new Set(basePositions.map(p => p.owner_address).filter(Boolean));
    const missingOwners = chainOwners.filter(o => !knownOwners.has(o.owner));
    console.log(`[PoolAnalysis] ${chainOwners.length} active owners, ${missingOwners.length} missing from base — querying by admin_address`);

    // Step 3: Query missing owners — try admin_address first, sickle_address fallback if empty
    const extraPositions = [];
    let idx = 0;
    const CONCURRENCY = 5;

    function parseV2Positions(data, owner, sickle) {
      const out = [];
      for (const pos of (data.data || [])) {
        if (pos.price > 0) {
          out.push({
            sickle_address: pos.sickle_address?.toLowerCase() || sickle,
            owner_address: owner,
            token_id: pos.token_id,
            staking_contract: pos.staking_contract?.toLowerCase() || null,
            pool_address: pos.nft?.pool_address?.toLowerCase() || null,
            farm_address: pos.farm_address?.toLowerCase() || null,
            price: pos.price,
            underlying: (pos.underlying || []).map(u => ({
              symbol: u.symbol || '', address: u.address?.toLowerCase() || '',
            })),
          });
        }
      }
      return out;
    }

    async function queryOwner(owner, sickle) {
      // Try admin_address first
      try {
        const data = await fetch(
          `${INFO_API}/open-positions-v2?chain_id=${chainId}&admin_address=${owner}`,
          { signal: AbortSignal.timeout(15000) }
        ).then(r => r.json());
        const parsed = parseV2Positions(data, owner, sickle);
        if (parsed.length > 0) return parsed;
      } catch { /* fall through to sickle */ }

      // Fallback: sickle_address (some users only respond to this)
      try {
        const data = await fetch(
          `${INFO_API}/open-positions-v2?chain_id=${chainId}&sickle_address=${sickle}`,
          { signal: AbortSignal.timeout(15000) }
        ).then(r => r.json());
        return parseV2Positions(data, owner, sickle);
      } catch { /* skip */ }

      return [];
    }

    const failedOwners = [];

    async function queryNext() {
      while (idx < missingOwners.length) {
        const { owner, sickle } = missingOwners[idx++];
        const parsed = await queryOwner(owner, sickle);
        if (parsed.length > 0) {
          extraPositions.push(...parsed);
        } else {
          failedOwners.push({ owner, sickle });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missingOwners.length) }, () => queryNext()));
    console.log(`[PoolAnalysis] ${extraPositions.length} extra positions, ${failedOwners.length} owners returned 0 — retrying...`);

    // Retry failed owners once (API inconsistency — same query can return different results)
    if (failedOwners.length > 0) {
      let retryIdx = 0;
      async function retryNext() {
        while (retryIdx < failedOwners.length) {
          const { owner, sickle } = failedOwners[retryIdx++];
          const parsed = await queryOwner(owner, sickle);
          if (parsed.length > 0) extraPositions.push(...parsed);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, failedOwners.length) }, () => retryNext()));
    }

    console.log(`[PoolAnalysis] After retry: ${extraPositions.length} extra positions from ${missingOwners.length} queries`);

    // Step 4: Match and return
    const allPositions = [...basePositions, ...extraPositions];
    const farmPositions = filterPositionsForPool(allPositions, poolInfo, address);
    console.log(`[PoolAnalysis] ${farmPositions.length} matched for pool`);
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
  const enabled = Object.keys(PROVIDERS).filter(provider => provider !== 'uniswap' || process.env.UNISWAP_API_KEY);
  await Promise.allSettled(enabled.map(provider => refreshProvider(provider)));
  console.log('[Refresh] Done. Next refresh in 15 minutes.');
}

// Start server FIRST, then refresh data in background
ensureDataDir();
app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);

  // Initial data load in background
  const enabled = Object.keys(PROVIDERS).filter(provider => provider !== 'uniswap' || process.env.UNISWAP_API_KEY);
  const caches = enabled.map(provider => [provider, readCache(`${provider}.json`)]);
  console.log(`[Init] Cached providers: ${caches.filter(([,cache]) => cache).length}/${enabled.length}`);
  const now = Date.now();
  for (const [provider, cache] of caches) {
    if (!cache || now - cache.timestamp > REFRESH_INTERVAL) {
      refreshProvider(provider).catch(err => {
        console.error(`[Init] ${provider} refresh failed; server remains available: ${err.message}`);
      });
    }
  }

  // Start periodic refresh
  setInterval(refreshAll, REFRESH_INTERVAL);
});
