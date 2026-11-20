import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { createCloudStore } from './cloud-store.mjs';
import { cloudHandler } from './cloud-api.mjs';

test('cloud migrates cached FIT records, transports details lazily, preserves cache/reviews and invalidates changed source', async () => {
  const db = new PGlite();
  const originalPool = pg.Pool;
  pg.Pool = class {
    async connect() {
      return { query: (sql, params) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rows: [] }) : db.query(sql, params), release() {} };
    }
    end() { return db.close(); }
  };
  const store = createCloudStore('test');
  pg.Pool = originalPool;
  const record = { sequence: 0, timestamp: 100, heartRate: 140, distance: 0, speed: null, cadence: null, temperature: null };
  let activity = { id: '42', type: 'pool', date: '2026-10-14', distance: 1000, raw: { distance: 1000 } };
  let calls = 0;
  const connect = async () => ({
    historyPage: async () => ({ owner: 'test-account', scanned: 1, activities: [activity] }),
    fit: async () => { calls++; return { metrics: {}, lengths: [], records: [record] }; },
  });
  try {
    await db.exec("CREATE TABLE swimlab_activities(id TEXT PRIMARY KEY,source JSONB NOT NULL,raw TEXT NOT NULL,lengths JSONB NOT NULL DEFAULT '[]',route JSONB NOT NULL DEFAULT '[]')");
    await db.query('INSERT INTO swimlab_activities(id,source,raw) VALUES($1,$2::jsonb,$3)',
      ['42', JSON.stringify({ ...activity, fitStatus: 'complete', routeStatus: 'not_applicable', review: 'include' }), JSON.stringify(activity.raw)]);
    assert.equal((await store.activityRecords('42')).recordsStatus, 'pending');
    await store.start();
    assert.equal((await store.step(connect)).total, 1);
    await store.step(connect);
    await store.step(connect);
    for (let i = 0; i < 10; i++) {
      const job = await store.step(connect);
      if (job.state !== 'running') break;
    }
    assert.deepEqual(await store.activityRecords('42'), { records: [record], recordsStatus: 'complete' });
    assert.equal('records' in await store.data(0), false);
    await store.start();
    assert.equal((await store.step(connect)).total, 0);
    await store.step(connect);
    assert.equal(calls, 1);
    activity = { ...activity, distance: 1100, raw: { distance: 1100 } };
    await store.start();
    await store.step(connect);
    assert.deepEqual(await store.activityRecords('42'), { records: [], recordsStatus: 'pending' });
    assert.equal((await store.data(0)).activities[0].review, 'include');
    assert.equal(await store.activityRecords('999'), null);
  } finally { await store.close(); }
});

test('cloud data endpoint validates detail IDs and distinguishes missing activities from missing HR', async () => {
  const handler = cloudHandler('data', { store: { activityRecords: async id => id === '42'
    ? { records: [], recordsStatus: 'unavailable' } : null } });
  async function invoke(id) {
    let result;
    const res = { setHeader() {}, status(status) { result = { status }; return this; }, json(data) { result.data = data; } };
    await handler({ method: 'GET', headers: {}, query: { id } }, res);
    return result;
  }
  assert.equal((await invoke(['42', '43'])).status, 400);
  assert.equal((await invoke('../42')).status, 400);
  assert.equal((await invoke('999')).status, 404);
  assert.deepEqual(await invoke('42'), { status: 200, data: { records: [], recordsStatus: 'unavailable' } });
});
