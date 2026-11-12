import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMetrics, annotateOutliers, histogram, weeklyTrend, trainingHeatmap, personalBests, sessionRankings, swolfTrend, trainingSummary } from './analytics.mjs';

const activity = overrides => deriveMetrics({
  id: '1', name: 'Swim', date: '2026-10-12T08:30:00', type: 'pool', distance: 1000,
  movingTime: 1200, elapsedTime: 1500, poolLength: 25, lengths: 40, strokes: 400, ...overrides,
});

test('excludes suspicious measurements reversibly without removing legitimate long swims', () => {
  const normal = Array.from({ length: 12 }, (_, i) => activity({ id: String(i), movingTime: 1150 + i * 10 }));
  const rows = annotateOutliers([...normal,
    activity({ id: 'fast', movingTime: 100 }),
    activity({ id: 'slow', movingTime: 4000, elapsedTime: 4500 }),
    activity({ id: 'long', distance: 8000, lengths: 320, movingTime: 9600, elapsedTime: 11000 }),
    activity({ id: 'override', movingTime: 100, review: 'include' }),
    activity({ id: 'manual', review: 'exclude' }),
    activity({ id: 'impossible', movingTime: 1800, elapsedTime: 1500 }),
  ]);
  assert.equal(rows.find(a => a.id === 'fast').excluded, true);
  assert.match(rows.find(a => a.id === 'slow').reasons.join(), /MAD/);
  assert.equal(rows.find(a => a.id === 'long').excluded, false);
  assert.equal(rows.find(a => a.id === 'override').excluded, false);
  assert.equal(rows.find(a => a.id === 'override').reasons.length > 0, true);
  assert.equal(rows.find(a => a.id === 'manual').excluded, true);
  assert.match(rows.find(a => a.id === 'impossible').reasons.join(), /exceeds elapsed/);
  assert.equal(rows.length, 18);
});

test('histograms include maxima, ignore nulls, and handle identical values', () => {
  assert.equal(histogram([null, NaN, 100, 100, 100]).reduce((s, b) => s + b.count, 0), 3);
  const bins = histogram([0, 10, 20, 30, 40], 4);
  assert.equal(bins.at(-1).count, 2);
  assert.deepEqual(histogram([]), []);
});

test('weekly mean includes zero weeks and heatmap uses local weekday and hour', () => {
  const rows = [activity({ distance: 2000 }), activity({ date: '2026-11-02T18:00:00', distance: 6000 })];
  const trend = weeklyTrend(rows, new Date('2026-11-08T12:00:00'));
  assert.deepEqual(trend.map(w => w.km), [2, 0, 0, 6]);
  assert.equal(trend[0].rolling, null);
  assert.equal(trend[3].rolling, 2);
  const cells = trainingHeatmap(rows);
  assert.equal(cells[0][8], 1);
  assert.equal(cells[0][18], 1);
  assert.equal(cells.flat().reduce((s, count) => s + count, 0), 2);
});

test('records require exact FIT windows, include rests, and do not estimate from session averages', () => {
  const a = activity();
  const lengths = Array.from({ length: 8 }, (_, i) => ({
    activityId: '1', sequence: i, active: true, distance: 25, start: i * 35, duration: 30, stroke: 'freestyle',
  }));
  const result = personalBests([a], lengths);
  assert.equal(result['100m'][0].value, 135);
  assert.equal(result['200m'][0].value, 275);
  assert.equal(result['100m'].length, 1);
  assert.equal(result['1000m'].length, 0);
  assert.equal(personalBests([a], [])['100m'].length, 0);
  lengths[1].stroke = 'drill';
  lengths[5].stroke = 'drill';
  assert.equal(personalBests([a], lengths)['100m'].length, 0);
});

test('IM records enforce ordered equal legs; bad times and wrong strokes never qualify', () => {
  const a = activity();
  const lengths = ['butterfly', 'backstroke', 'breaststroke', 'freestyle'].map((stroke, i) => ({
    activityId: '1', sequence: i, active: true, distance: 25, start: i * 30, duration: 30, stroke,
  }));
  assert.equal(personalBests([a], lengths)['100m IM'][0].value, 120);
  lengths[1].stroke = 'freestyle';
  assert.equal(personalBests([a], lengths)['100m IM'].length, 0);
  lengths[0].duration = 1;
  assert.equal(personalBests([a], lengths)['100m'].length, 0);
  lengths[0].duration = 30;
  lengths[1].start = 0;
  assert.equal(personalBests([a], lengths)['100m'].length, 0);
});

test('podiums show three distinct sessions and fastest sessions have a minimum distance', () => {
  const rows = [activity({ id: '1' }), activity({ id: '2', distance: 1500 }), activity({ id: '3', distance: 2000 }),
    activity({ id: '4', distance: 4000 }), activity({ id: '5', distance: 25, movingTime: 20 })];
  const records = personalBests(rows, []);
  assert.deepEqual(records['Longest session'].map(a => a.id), ['4', '3', '2']);
  assert.equal(records['Fastest session'].some(a => a.id === '5'), false);
  assert.equal(records['Fastest session'].length, 3);
});

test('stroke-specific bests use exact windows and rankings respect selected metric and limit', () => {
  const rows = [activity({ id: '1', date: '2026-10-12T08:30:00', swolf: 40 }),
    activity({ id: '2', date: '2026-10-13T08:30:00', distance: 1500, movingTime: 1650, swolf: 35 }),
    activity({ id: '3', date: '2026-10-14T08:30:00', distance: 2000, movingTime: 2500, swolf: 45 })];
  const lengths = Array.from({ length: 8 }, (_, i) => ({
    activityId: '1', sequence: i, active: true, distance: 25, start: i * 31, duration: 30,
    stroke: i < 4 ? 'backstroke' : 'freestyle',
  }));
  const records = personalBests(rows, lengths, 5);
  assert.equal(records['100m backstroke'][0].value, 123);
  assert.equal(records['100m freestyle'].length, 1);
  assert.equal(records['100m breaststroke'].length, 0);
  assert.deepEqual(sessionRankings(rows, 'distance', 2).map(row => row.id), ['3', '2']);
  assert.deepEqual(sessionRankings(rows, 'pace', 1).map(row => row.id), ['2']);
  assert.deepEqual(sessionRankings(rows, 'swolf', 2).map(row => row.id), ['2', '1']);
  assert.deepEqual(swolfTrend(rows).map(row => row.id), ['1', '2', '3']);
});

test('environment summaries include session shares and per-pool-length averages', () => {
  const rows = [activity({ id: 'pool25', poolLength: 25 }), activity({ id: 'pool50', poolLength: 50, type: 'pool' }),
    activity({ id: 'open', type: 'open_water', poolLength: null, swolf: null, distance: 2000 })];
  const summary = trainingSummary(rows);
  assert.equal(summary.totalSessions, 3);
  assert.equal(summary.pool.sessions, 2);
  assert.equal(summary.openWater.sessions, 1);
  assert.deepEqual(summary.poolLengths.map(row => row.length), [25, 50]);
  assert.equal(summary.poolLengths[0].averageDistance, 1000);
});
