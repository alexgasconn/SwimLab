import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from './server.mjs';
import { connectGarmin, normalizeActivities, extractFitMetrics, decodeFit } from './garmin.mjs';
import { openStore } from './store.mjs';

const source = overrides => ({
  activityId: 123, activityName: 'Pool technique', startTimeLocal: '2026-10-14 08:00:00',
  activityType: { typeKey: 'lap_swimming' }, distance: 1980, movingDuration: 2505,
  elapsedDuration: 2988, duration: 2800, activeLengths: 99, strokes: 944, poolLength: 2000,
  ...overrides,
});
const history = activities => ({ activities, owner: 'test-account', scanned: activities.length, truncated: false });
const normalized = () => normalizeActivities([source()])[0];
const length = { sequence: 0, active: true, start: 100, duration: 25, timerTime: 25, distance: 20, strokes: 10, stroke: 'freestyle' };
const fit = () => ({ metrics: { poolLength: 20, temperature: 24, freestylePct: 100, breaststrokePct: 0, backstrokePct: 0, butterflyPct: 0, otherPct: 0 }, lengths: [length] });

test('maps actual Garmin units and reproduces spreadsheet metrics using moving and elapsed time', () => {
  const [a] = normalizeActivities([source(), source({ activityType: { typeKey: 'running' } })]);
  assert.equal(a.poolLength, 20);
  assert.ok(Math.abs(a.pace - 126.5151515) < 0.00001);
  assert.ok(Math.abs(a.movingRatio - 2505 / 2988) < 0.00001);
  assert.ok(Math.abs(a.dps - 1980 / 944) < 0.00001);
  assert.ok(Math.abs(a.spm - 944 / (2505 / 60)) < 0.00001);
  assert.ok(Math.abs(a.spl - 944 / 99) < 0.00001);
  assert.ok(Math.abs(a.tpl - 2505 / 99) < 0.00001);
  assert.ok(Math.abs(a.lpm - 99 / (2505 / 60)) < 0.00001);
  const [missing] = normalizeActivities([source({ movingDuration: undefined, strokes: undefined })]);
  assert.equal(missing.pace, null);
  assert.equal(missing.spm, null);
  const [second] = normalizeActivities([source({
    distance: 2500, movingDuration: 3046, elapsedDuration: 5273, activeLengths: 125, strokes: 1184,
  })]);
  assert.equal(second.pace, 121.84);
  assert.ok(Math.abs(second.movingRatio - 0.5776597762) < 0.00001);
  assert.ok(Math.abs(second.dps - 2.1114864865) < 0.00001);
});

test('exchanges text token, paginates history, never places credentials in URLs', async () => {
  const calls = [];
  const client = await connectGarmin('fake-key', async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return new Response('test-token\n', { headers: { 'Content-Type': 'text/plain' } });
    return Response.json(calls.length === 2 ? Array.from({ length: 100 }, (_, i) => source({ activityId: i + 1 }))
      : [source({ activityId: 101 })]);
  });
  const result = await client.history();
  assert.equal(calls[0].options.headers.Accept, '*/*');
  assert.equal(calls[0].options.headers.Authorization, 'ApiKey fake-key');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token');
  assert.match(calls[2].url, /start=100&limit=100$/);
  assert.ok(calls.every(call => !call.url.includes('fake-key') && !call.url.includes('test-token')));
  assert.equal(result.activities.length, 101);
  assert.equal(result.truncated, false);
});

test('marks capped scans as partial and rejects malformed or unauthorized responses', async () => {
  let calls = 0;
  const client = await connectGarmin('fake', async () => Response.json(++calls === 1 ? { access_token: 'token' }
    : Array.from({ length: 100 }, (_, i) => source({ activityId: i + 1 }))));
  const result = await client.history();
  assert.equal(result.scanned, 5000);
  assert.equal(result.truncated, true);
  await assert.rejects(connectGarmin('fake', async () => new Response('upstream-secret', { status: 401 })),
    e => e.message.includes('HTTP 401') && !e.message.includes('upstream-secret'));
  await assert.rejects(connectGarmin('fake', async () => Response.json({})), /unrecognized token/);
  calls = 0;
  const malformed = await connectGarmin('fake', async () => Response.json(++calls === 1 ? { accessToken: 'token' } : {}));
  await assert.rejects(malformed.history(), /unrecognized activity list/);
});

test('FIT stroke proportions include unknown and drill lengths in the denominator', () => {
  const data = extractFitMetrics({
    sessionMesgs: [{ sport: 'swimming', poolLength: 25, avgTemperature: 22 }],
    lengthMesgs: ['freestyle', 'breaststroke', 'drill', 'unknown'].map((stroke, i) => ({
      startTime: new Date(i * 30000), totalElapsedTime: 30, totalTimerTime: 30,
      totalStrokes: 12, lengthType: 'active', swimStroke: stroke,
    })).concat([{ lengthType: 'idle', totalElapsedTime: 100, startTime: new Date(120000) }]),
    recordMesgs: [
      { positionLat: Math.round(40 * 2147483648 / 180), positionLong: Math.round(-3 * 2147483648 / 180) },
      { positionLat: Math.round(40.001 * 2147483648 / 180), positionLong: Math.round(-3.001 * 2147483648 / 180) },
      { positionLat: null, positionLong: null },
    ],
  });
  assert.equal(data.metrics.freestylePct, 25);
  assert.equal(data.metrics.breaststrokePct, 25);
  assert.equal(data.metrics.otherPct, 50);
  assert.equal(data.lengths.filter(l => l.active).length, 4);
  assert.equal(data.lengths.at(-1).distance, 0);
  assert.equal(data.lengths[0].start, 0);
  assert.equal(data.routePoints.length, 2);
  assert.ok(Math.abs(data.routePoints[0].lat - 40) < 0.00001);
  assert.ok(Math.abs(data.routePoints[0].lon + 3) < 0.00001);
  const open = extractFitMetrics({ sessionMesgs: [{ sport: 'swimming' }] });
  assert.equal(open.metrics.freestylePct, null);
  assert.throws(() => decodeFit(new Uint8Array(20)), /integrity/);
});

test('SQLite upserts, keeps reviews, caches FIT, invalidates changed measurements, and prevents account mixing', () => {
  const store = openStore(':memory:');
  try {
    store.saveHistory(history([normalized()]));
    store.saveFit('123', fit());
    store.review('123', 'include');
    store.saveHistory(history([normalized()]));
    assert.equal(store.data().activities.length, 1);
    assert.equal(store.data().lengths.length, 1);
    assert.equal(store.data().activities[0].temperature, 24);
    assert.deepEqual(store.pending(), []);
    const changed = normalizeActivities([source({ distance: 2000 })]);
    store.saveHistory(history(changed));
    assert.deepEqual(store.pending(), ['123']);
    assert.equal(store.data().lengths.length, 0);
    assert.equal(store.data().activities[0].freestylePct, null);
    assert.equal(store.data().activities[0].review, 'include');
    assert.throws(() => store.saveHistory({ ...history(changed), owner: 'other-account' }), /another Garmin account/);
    assert.equal(store.data().activities.length, 1);
  } finally { store.close(); }
});

test('open-water GPS routes are stored locally, reused, and invalidated with changed source metrics', () => {
  const store = openStore(':memory:');
  const openWater = normalizeActivities([source({
    activityId: 124, activityType: { typeKey: 'open_water_swimming' }, poolLength: undefined,
  })]);
  try {
    store.saveHistory(history(openWater));
    assert.deepEqual(store.pending(), ['124']);
    store.saveFit('124', {
      ...fit(),
      routePoints: [{ sequence: 0, lat: 40, lon: -3 }, { sequence: 1, lat: 40.001, lon: -3.001 }],
    });
    const saved = store.data();
    assert.equal(saved.activities[0].routeStatus, 'complete');
    assert.equal(saved.routePoints.length, 2);
    assert.deepEqual(store.pending(), []);
    store.saveHistory(history(normalizeActivities([source({
      activityId: 124, activityType: { typeKey: 'open_water_swimming' }, poolLength: undefined, distance: 2100,
    })])));
    assert.equal(store.data().routePoints.length, 0);
    assert.deepEqual(store.pending(), ['124']);
    store.markFit('124', 'unavailable', 'FIT export unavailable');
    assert.equal(store.data().activities[0].routeStatus, 'unavailable');
    assert.deepEqual(store.pending(), []);
  } finally { store.close(); }
});

test('local server serves the offline map and its decoder without an external tile service', async () => {
  const server = createApp(fetch, openStore(':memory:'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = path => new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { Host: '127.0.0.1:8787' } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'], text }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    const map = await get('/land-10m.json');
    assert.equal(map.status, 200);
    assert.match(map.contentType, /application\/json/);
    assert.equal(JSON.parse(map.text).type, 'Topology');
    const decoder = await get('/topojson-client.js');
    assert.equal(decoder.status, 200);
    assert.match(decoder.contentType, /text\/javascript/);
    assert.match((await get('/world-atlas-license.txt')).text, /Permission to use/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('HTTP rejects cross-origin writes, persists async sync, and reports FIT failure without false success', async () => {
  const store = openStore(':memory:');
  const fetcher = async (url, options) => {
    if (options.method === 'POST') return new Response('token', { headers: { 'Content-Type': 'text/plain' } });
    if (url.includes('download-service')) return new Response('not exposed', { status: 429, headers: { 'Retry-After': '60' } });
    return Response.json([source({ ownerId: 1 })]);
  };
  const server = createApp(fetcher, store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: '127.0.0.1:8787', Origin: 'http://127.0.0.1:8787', 'Content-Type': 'application/json' };
  const localRequest = (path, body, origin = headers.Origin) => new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, Origin: origin } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    const rejected = await localRequest('/api/sync', { apiKey: 'fake' }, 'https://other.invalid');
    assert.equal(rejected.status, 403);
    const accepted = await localRequest('/api/sync', { apiKey: 'fake' });
    assert.equal(accepted.status, 202);
    let job;
    for (let i = 0; i < 50; i++) {
      job = (await localRequest('/api/sync')).data;
      if (job.state !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(job.state, 'error');
    assert.match(job.message, /429/);
    assert.match(job.message, /at least 60 seconds/);
    const data = (await localRequest('/api/data')).data;
    assert.equal(data.activities[0].fitStatus, 'error');
    assert.equal(data.activities.length, 1);
    assert.ok(!JSON.stringify(data).includes('fake'));
    assert.ok(!JSON.stringify(data).includes('not exposed'));
  } finally {
    server.close();
    await once(server, 'close');
  }
});
