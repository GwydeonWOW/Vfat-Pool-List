import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export function openDatabase(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_cache (
      provider TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      pools_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      error TEXT,
      pool_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pool_snapshots (
      pool_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      tvl REAL,
      apr REAL,
      fee_apr REAL,
      reward_apr REAL,
      volume24h REAL,
      price REAL,
      PRIMARY KEY (pool_id, timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_time ON pool_snapshots(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS watchlist (
      pool_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
  `);
  const cacheColumns = db.prepare('PRAGMA table_info(provider_cache)').all();
  if (!cacheColumns.some((column) => column.name === 'pool_count')) {
    db.exec('ALTER TABLE provider_cache ADD COLUMN pool_count INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE provider_cache SET pool_count = json_array_length(pools_json)');
  }
  return db;
}

export function createStore(db) {
  const readProviderStmt = db.prepare('SELECT * FROM provider_cache WHERE provider = ?');
  const writeProviderStmt = db.prepare(`
    INSERT INTO provider_cache(provider, timestamp, pools_json, status, error, pool_count)
    VALUES (@provider, @timestamp, @pools_json, @status, @error, @pool_count)
    ON CONFLICT(provider) DO UPDATE SET timestamp=excluded.timestamp,
      pools_json=excluded.pools_json, status=excluded.status, error=excluded.error,
      pool_count=excluded.pool_count
  `);
  const providerMetadataStmt = db.prepare('SELECT provider,timestamp,status,error,pool_count FROM provider_cache WHERE provider=?');
  const allProviderMetadataStmt = db.prepare('SELECT provider,timestamp,status,error,pool_count FROM provider_cache');
  const snapshotStmt = db.prepare(`
    INSERT OR REPLACE INTO pool_snapshots
      (pool_id,timestamp,tvl,apr,fee_apr,reward_apr,volume24h,price)
    VALUES (@id,@timestamp,@tvl,@apr,@feeApr,@rewardApr,@volume24h,@price)
  `);
  const deleteOldSnapshotsStmt = db.prepare('DELETE FROM pool_snapshots WHERE timestamp < ?');
  const writeSnapshots = (pools, timestamp) => {
    const bucket = Math.floor(timestamp / 900000) * 900000;
    for (const pool of pools) snapshotStmt.run({
      id: pool.id, timestamp: bucket, tvl: pool.tvl || 0, apr: pool.apr || 0,
      feeApr: pool.feeApr || 0, rewardApr: pool.rewardApr || 0,
      volume24h: pool.volume24h || 0, price: pool.price || 0,
    });
    deleteOldSnapshotsStmt.run(Date.now() - 90 * 86400000);
  };
  const recordSnapshotsTransaction = db.transaction(writeSnapshots);

  return {
    readProvider(provider) {
      const row = readProviderStmt.get(provider);
      if (!row) return null;
      try { return { timestamp: row.timestamp, pools: JSON.parse(row.pools_json), status: row.status, error: row.error }; }
      catch { return null; }
    },
    writeProvider(provider, pools, timestamp = Date.now()) {
      db.transaction(() => {
        writeProviderStmt.run({ provider, timestamp, pools_json: JSON.stringify(pools), status: 'ok', error: null, pool_count: pools.length });
        writeSnapshots(pools, timestamp);
      })();
      return { timestamp, pools, status: 'ok', error: null };
    },
    recordSnapshots(pools, timestamp = Date.now()) { recordSnapshotsTransaction(pools, timestamp); },
    writePreparedProvider(provider, pools, timestamp, status = 'ok', error = null) {
      writeProviderStmt.run({ provider, timestamp, pools_json: JSON.stringify(pools), status, error, pool_count: pools.length });
      return { timestamp, pools, status, error };
    },
    providerMetadata(provider) { return providerMetadataStmt.get(provider) || null; },
    allProviderMetadata() { return allProviderMetadataStmt.all(); },
    markProviderError(provider, error) {
      db.prepare(`
        INSERT INTO provider_cache(provider,timestamp,pools_json,status,error,pool_count)
        VALUES(?,?,?,'degraded',?,0)
        ON CONFLICT(provider) DO UPDATE SET status='degraded',error=excluded.error
      `).run(provider, Date.now(), '[]', String(error));
    },
    history(poolId, since) {
      return db.prepare('SELECT * FROM pool_snapshots WHERE pool_id=? AND timestamp>=? ORDER BY timestamp').all(poolId, since);
    },
    historyMap(poolIds, since) {
      const result = new Map();
      const ids = [...new Set(poolIds)].filter(Boolean);
      // Stay comfortably below SQLite's bind-parameter limit.
      for (let offset = 0; offset < ids.length; offset += 400) {
        const chunk = ids.slice(offset, offset + 400);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = db.prepare(`SELECT * FROM pool_snapshots WHERE timestamp>=? AND pool_id IN (${placeholders}) ORDER BY pool_id,timestamp`).all(since, ...chunk);
        for (const row of rows) {
          if (!result.has(row.pool_id)) result.set(row.pool_id, []);
          result.get(row.pool_id).push(row);
        }
      }
      return result;
    },
    listWatchlist() { return db.prepare('SELECT pool_id, created_at FROM watchlist ORDER BY created_at DESC').all(); },
    addWatchlist(poolId) { db.prepare('INSERT OR IGNORE INTO watchlist(pool_id,created_at) VALUES (?,?)').run(poolId, Date.now()); },
    removeWatchlist(poolId) { db.prepare('DELETE FROM watchlist WHERE pool_id=?').run(poolId); },
    deleteExpiredSessions(now = Date.now()) { return db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now).changes; },
    checkpoint() { return db.pragma('wal_checkpoint(PASSIVE)'); },
  };
}
