import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export function openDatabase(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
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
      error TEXT
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
    CREATE TABLE IF NOT EXISTS watchlist (
      pool_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function createStore(db) {
  const readProviderStmt = db.prepare('SELECT * FROM provider_cache WHERE provider = ?');
  const writeProviderStmt = db.prepare(`
    INSERT INTO provider_cache(provider, timestamp, pools_json, status, error)
    VALUES (@provider, @timestamp, @pools_json, @status, @error)
    ON CONFLICT(provider) DO UPDATE SET timestamp=excluded.timestamp,
      pools_json=excluded.pools_json, status=excluded.status, error=excluded.error
  `);
  const snapshotStmt = db.prepare(`
    INSERT OR REPLACE INTO pool_snapshots
      (pool_id,timestamp,tvl,apr,fee_apr,reward_apr,volume24h,price)
    VALUES (@id,@timestamp,@tvl,@apr,@feeApr,@rewardApr,@volume24h,@price)
  `);

  return {
    readProvider(provider) {
      const row = readProviderStmt.get(provider);
      if (!row) return null;
      try { return { timestamp: row.timestamp, pools: JSON.parse(row.pools_json), status: row.status, error: row.error }; }
      catch { return null; }
    },
    writeProvider(provider, pools, timestamp = Date.now()) {
      const bucket = Math.floor(timestamp / 900000) * 900000;
      db.transaction(() => {
        writeProviderStmt.run({ provider, timestamp, pools_json: JSON.stringify(pools), status: 'ok', error: null });
        for (const pool of pools) snapshotStmt.run({
          id: pool.id, timestamp: bucket, tvl: pool.tvl || 0, apr: pool.apr || 0,
          feeApr: pool.feeApr || 0, rewardApr: pool.rewardApr || 0,
          volume24h: pool.volume24h || 0, price: pool.price || 0,
        });
        db.prepare('DELETE FROM pool_snapshots WHERE timestamp < ?').run(Date.now() - 90 * 86400000);
      })();
      return { timestamp, pools, status: 'ok', error: null };
    },
    markProviderError(provider, error) {
      db.prepare(`
        INSERT INTO provider_cache(provider,timestamp,pools_json,status,error)
        VALUES(?,?,?,'degraded',?)
        ON CONFLICT(provider) DO UPDATE SET status='degraded',error=excluded.error
      `).run(provider, Date.now(), '[]', String(error));
    },
    history(poolId, since) {
      return db.prepare('SELECT * FROM pool_snapshots WHERE pool_id=? AND timestamp>=? ORDER BY timestamp').all(poolId, since);
    },
    listWatchlist() { return db.prepare('SELECT pool_id, created_at FROM watchlist ORDER BY created_at DESC').all(); },
    addWatchlist(poolId) { db.prepare('INSERT OR IGNORE INTO watchlist(pool_id,created_at) VALUES (?,?)').run(poolId, Date.now()); },
    removeWatchlist(poolId) { db.prepare('DELETE FROM watchlist WHERE pool_id=?').run(poolId); },
  };
}
