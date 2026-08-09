import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openDatabase, createStore } from '../lib/db.js';

let folder;
afterEach(() => { if (folder) rmSync(folder, { recursive: true, force: true }); });

describe('SQLite store', () => {
  it('persists provider cache and watchlist atomically', () => {
    folder = mkdtempSync(join(tmpdir(), 'vfat-test-'));
    const db = openDatabase(join(folder, 'test.sqlite'));
    const store = createStore(db);
    store.writeProvider('demo', [{ id: 'demo:1', tvl: 10, apr: 2 }], 1000);
    store.addWatchlist('demo:1');
    expect(store.readProvider('demo').pools).toHaveLength(1);
    expect(store.listWatchlist()[0].pool_id).toBe('demo:1');
    db.close();
  });
});
