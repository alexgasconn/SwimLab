import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMetrics, annotateOutliers, histogram, weeklyTrend, trainingHeatmap, personalBests, sessionRankings, swolfTrend, trainingSummary, strokeMix, sortSessions, filterLogbook } from './analytics.mjs';

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
  assert.equal(result['200m'][0].pace, 137.5);
  assert.equal(result['50m freestyle'][0].pace, 130);
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

test('500m and 1000m records use exact lengths; 20m IM records are limited to 20m pools', () => {
  const longSwim = activity({ id: 'long', poolLength: 20 });
  const lengths = Array.from({ length: 50 }, (_, i) => ({
    activityId: 'long', sequence: i, active: true, distance: 20, start: i * 30, duration: 25, stroke: 'freestyle',
  }));
  const records = personalBests([longSwim], lengths);
  assert.equal(records['500m'][0].value, 745);
  assert.equal(records['1000m'][0].value, 1495);

  const imLengths = (activityId, lengthsPerStroke) =>
    ['butterfly', 'backstroke', 'breaststroke', 'freestyle']
      .flatMap(stroke => Array.from({ length: lengthsPerStroke }, () => stroke))
      .map((stroke, i) => ({
        activityId, sequence: i, active: true, distance: 20, start: i * 30, duration: 25, stroke,
      }));
  const im80 = activity({ id: 'im80', poolLength: 20 });
  const im160 = activity({ id: 'im160', poolLength: 20 });
  const im25 = activity({ id: 'im25', poolLength: 25 });
  assert.equal(personalBests([im80], imLengths('im80', 1))['80m IM'][0].value, 115);
  assert.equal(personalBests([im160], imLengths('im160', 2))['160m IM'][0].value, 235);
  assert.equal(personalBests([im25], imLengths('im25', 1))['80m IM'].length, 0);
  assert.equal(personalBests([im25], imLengths('im25', 2))['160m IM'].length, 0);
});

test('every stroke has all requested distances and IM has only the requested distances', () => {
  const strokes = ['freestyle', 'breaststroke', 'backstroke', 'butterfly'];
  const distances = [50, 100, 200, 400, 500, 750, 1000];
  const activities = strokes.map((_, i) => activity({ id: `stroke-${i}`, poolLength: 25 }));
  const lengths = strokes.flatMap((stroke, strokeIndex) =>
    Array.from({ length: 40 }, (_, i) => ({
      activityId: `stroke-${strokeIndex}`, sequence: i, active: true, distance: 25,
      start: i * 31, duration: 30, stroke,
    })));
  const records = personalBests(activities, lengths, 1);
  for (const stroke of strokes) {
    for (const distance of distances) assert.equal(records[`${distance}m ${stroke}`].length, 1);
  }

  const imStrokes = ['butterfly', 'backstroke', 'breaststroke', 'freestyle'];
  const imLengths = imStrokes.flatMap(stroke => Array.from({ length: 2 }, () => stroke))
    .map((stroke, i) => ({
      activityId: 'im200', sequence: i, active: true, distance: 25, start: i * 31, duration: 30, stroke,
    }));
  const im200 = activity({ id: 'im200', poolLength: 25 });
  const imRecords = personalBests([im200], imLengths);
  assert.equal(imRecords['100m IM'].length, 0);
  assert.equal(imRecords['200m IM'].length, 1);
  assert.equal(Object.hasOwn(imRecords, '400m IM'), false);
});

test('podiums show three distinct sessions and fastest sessions have a minimum distance', () => {
  const rows = [activity({ id: '1' }), activity({ id: '2', distance: 1500 }), activity({ id: '3', distance: 2000 }),
    activity({ id: '4', distance: 4000 }), activity({ id: '5', distance: 25, movingTime: 20 })];
  const records = personalBests(rows, []);
  assert.deepEqual(records['Longest session'].map(a => a.id), ['4', '3', '2']);
  assert.equal(records['Fastest session'].some(a => a.id === '5'), false);
  assert.equal(records['Fastest session'].length, 3);
  assert.equal(records['Longest session'][0].pace, 30);
  assert.equal(records['Fastest session'][0].pace, records['Fastest session'][0].value);
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
  assert.equal(sessionRankings(rows, 'distance', 1)[0].pace, 125);
  assert.equal(sessionRankings([activity({ movingTime: null })], 'distance')[0].pace, null);
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

test('stroke totals use recorded pool length distances and preserve unknown strokes', () => {
  const rows = [activity({ id: '1' }), activity({ id: '2' }), activity({ id: '3', type: 'open_water' })];
  const lengths = [
    { activityId: '1', active: true, distance: 25, stroke: 'freestyle' },
    { activityId: '1', active: true, distance: 25, stroke: 'drill' },
    { activityId: '2', active: true, distance: 50, stroke: 'backstroke' },
    { activityId: '2', active: false, distance: 25, stroke: 'freestyle' },
    { activityId: '3', active: true, distance: 100, stroke: 'freestyle' },
    { activityId: 'missing', active: true, distance: 100, stroke: 'freestyle' },
  ];
  const result = strokeMix(rows, lengths);
  assert.equal(result.total, 100);
  assert.equal(result.sessions, 2);
  assert.equal(result.strokes.find(item => item.stroke === 'freestyle').percentage, 25);
  assert.equal(result.strokes.find(item => item.stroke === 'backstroke').percentage, 50);
  assert.equal(result.strokes.find(item => item.stroke === 'other').percentage, 25);
  assert.equal(strokeMix(rows, []).strokes[0].percentage, null);
});

test('session sorting uses raw numbers and keeps missing values last in both directions', () => {
  const rows = [activity({ id: 'a', distance: 10000 }), activity({ id: 'b', distance: null }),
    activity({ id: 'c', distance: 900 }), activity({ id: 'd', distance: 1000 })];
  assert.deepEqual(sortSessions(rows, a => a.distance).map(a => a.id), ['c', 'd', 'a', 'b']);
  assert.deepEqual(sortSessions(rows, a => a.distance, 'descending').map(a => a.id), ['a', 'd', 'c', 'b']);
  assert.deepEqual(rows.map(a => a.id), ['a', 'b', 'c', 'd']);
});

test('logbook filters combine inclusive distance bounds with exact pool length or environment', () => {
  const rows = [
    activity({ id: 'a', distance: 1000, poolLength: 25 }),
    activity({ id: 'b', distance: 2000, poolLength: 50 }),
    activity({ id: 'c', distance: 1500, poolLength: null }),
    activity({ id: 'd', distance: 1500, type: 'open_water', poolLength: null }),
    activity({ id: 'e', distance: null, poolLength: 25 }),
  ];
  assert.deepEqual(filterLogbook(rows, { minDistance: 1000, maxDistance: 1500 }).map(a => a.id), ['a', 'c', 'd']);
  assert.deepEqual(filterLogbook(rows, { minDistance: 1000, pool: '25' }).map(a => a.id), ['a']);
  assert.deepEqual(filterLogbook(rows, { pool: 'unknown' }).map(a => a.id), ['c']);
  assert.deepEqual(filterLogbook(rows, { pool: 'open_water' }).map(a => a.id), ['d']);
  assert.equal(filterLogbook(rows, {}).length, 5);
});
