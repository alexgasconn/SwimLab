import test from 'node:test';
import assert from 'node:assert/strict';
import { activityAnalysis, lengthTrend, lengthCorrelation } from './analytics.mjs';

test('activity analysis groups active lengths by rests and reports internal gaps', () => {
  const activity = { id: 'a', type: 'pool', distance: 125, poolLength: 25 };
  const lengths = [
    { sequence: 0, start: 0, duration: 25, active: true, distance: 25, strokes: 10, stroke: 'freestyle' },
    { sequence: 1, start: 25, duration: 25, active: true, distance: 25, strokes: null, stroke: 'freestyle' },
    { sequence: 2, start: 50, duration: 20, active: false, distance: 0, stroke: 'unknown' },
    { sequence: 3, start: 70, duration: 30, active: true, distance: 25, strokes: 12, stroke: 'backstroke' },
    { sequence: 4, start: 120, duration: 30, active: true, distance: 25, strokes: 0, stroke: 'backstroke' },
    { sequence: 5, start: 150, duration: 25, active: true, distance: 25, strokes: 10, stroke: 'freestyle' },
  ].map(l => ({ ...l, activityId: 'a' }));
  const details = activityAnalysis(activity, [...lengths, { ...lengths[0], activityId: 'other' }],
    [{ timestamp: 0, heartRate: 120 }, { timestamp: 20, heartRate: 140 }, { timestamp: 25, heartRate: 160 }, { timestamp: 55, heartRate: 100 }]);
  assert.equal(details.origin, 0);
  assert.deepEqual(details.intervals.map(i => [i.kind, i.start, i.duration]), [
    ['swim', 0, 50], ['rest', 50, 20], ['swim', 70, 85],
  ]);
  assert.deepEqual(details.blocks.map(b => [b.stroke, b.mixed, b.distance]), [['freestyle', false, 50], ['backstroke', true, 75]]);
  assert.deepEqual(details.blocks[1].gaps, [{ kind: 'gap', start: 100, duration: 20 }]);
  assert.equal(details.active[0].pace, 100);
  assert.equal(details.active[0].swolf, 35);
  assert.equal(details.active[0].dps, 2.5);
  assert.equal(details.active[0].spm, 24);
  assert.equal(details.active[0].lpm, 2.4);
  assert.equal(details.active[0].heartRate, 130);
  assert.equal(details.active[0].hrSamples, 2);
  assert.equal(details.active[1].heartRate, 160);
  assert.equal(details.active[1].swolf, null);
  assert.equal(details.active[1].dps, null);
  assert.equal(details.active[3].spl, 0);
  assert.equal(details.active[3].dps, null);
  assert.equal(details.active[3].swolf, 30);
  assert.equal(details.active[4].heartRate, null);
  assert.equal(details.rows[2].index, null);
  assert.equal(details.hr.max, 160);
  const [partial, complete] = details.blocks;
  assert.equal(partial.metrics.strokes, null);
  assert.equal(partial.metrics.swolf, null);
  assert.equal(partial.metrics.timerTime, null);
  assert.equal(partial.metrics.tpl, 25);
  assert.equal(partial.metrics.hrSamples, 3);
  assert.equal(partial.metrics.heartRate, 140);
  assert.equal(complete.metrics.heartRate, null);
});

test('only recorded rests split sets despite stroke changes, overlap, gaps or missing length metrics', () => {
  const activity = { id: 'a', type: 'pool', distance: 125 };
  const lengths = [
    { sequence: 0, active: true, start: 0, duration: 25, distance: 25, strokes: 10, stroke: 'breaststroke' },
    { sequence: 1, active: true, start: 24, duration: 25, distance: 25, strokes: 10, stroke: 'freestyle' },
    { sequence: 3, active: true, start: 70, duration: null, distance: 25, strokes: 10, stroke: 'freestyle' },
    { sequence: 4, active: false, start: 100, duration: 10 },
    { sequence: 5, active: true, start: 110, duration: 25, distance: 25, strokes: 10, stroke: 'freestyle' },
  ].map(row => ({ ...row, activityId: 'a' }));
  const details = activityAnalysis(activity, lengths);
  assert.deepEqual(details.intervals.map(row => row.kind), ['swim', 'rest', 'swim']);
  const [first, second] = details.blocks;
  assert.equal(first.rows.length, 3);
  assert.equal(first.mixed, true);
  assert.equal(first.distance, 75);
  assert.equal(first.duration, null);
  assert.equal(first.pace, null);
  assert.equal(first.metrics.swolf, null);
  assert.equal(first.metrics.spm, null);
  assert.equal(first.metrics.tpl, null);
  assert.equal(first.metrics.lpm, null);
  assert.equal(first.gaps.length, 1);
  assert.equal(second.distance, 25);
  assert.ok(details.warnings.some(warning => warning.includes('overlap')));

  lengths[1].distance = null;
  const missingDistance = activityAnalysis(activity, lengths).blocks[0];
  assert.equal(missingDistance.distance, null);
  assert.equal(missingDistance.metrics.dps, null);
});

test('an uninterrupted 800m remains one set despite FIT timestamp rounding overlaps', () => {
  const activity = { id: 'a', type: 'pool', distance: 800 };
  const lengths = Array.from({ length: 40 }, (_, i) => ({
    activityId: 'a', sequence: i, active: true, distance: 20,
    start: Math.round(i * 21.75), duration: 21.75, stroke: 'freestyle', strokes: 10,
  }));
  const details = activityAnalysis(activity, lengths);
  assert.deepEqual(details.blocks.map(block => block.distance), [800]);
  assert.equal(details.blocks[0].rows.length, 40);
});

test('swim interval metrics use totals across recorded lengths, without rest', () => {
  const activity = { id: 'a', type: 'pool', distance: 50, poolLength: 25 };
  const lengths = [
    { sequence: 0, start: 0, duration: 20, timerTime: 19, distance: 25, strokes: 10 },
    { sequence: 1, start: 25, duration: 30, timerTime: 29, distance: 25, strokes: 15 },
  ].map(l => ({ ...l, activityId: 'a', active: true, stroke: 'freestyle' }));
  const [interval] = activityAnalysis(activity, lengths).intervals;
  assert.equal(interval.elapsed, 55);
  assert.deepEqual(interval.metrics, {
    strokes: 25, timerTime: 48, dps: 2, spl: 12.5, spm: 30, swolf: 37.5,
    tpl: 25, lpm: 2.4, efficiency: 2, heartRate: null, hrSamples: 0,
  });
});

test('activity detail flags invalid timing and distance without synthesizing lengths or HR', () => {
  const activity = { id: 'a', type: 'pool', distance: 100, heartRate: 150 };
  const result = activityAnalysis(activity, [
    { activityId: 'a', sequence: 0, active: true, start: null, duration: 20, distance: 25, strokes: 10 },
    { activityId: 'a', sequence: 1, active: true, start: 40, duration: null, distance: 25 },
  ]);
  assert.equal(result.active.length, 1);
  assert.equal(result.timed.length, 0);
  assert.equal(result.origin, null);
  assert.equal(result.hr.count, 0);
  assert.equal(result.active[0].heartRate, null);
  assert.equal(result.warnings.length, 3);
  assert.equal(activityAnalysis({ id: 'ow', type: 'open_water' }).blocks.length, 0);
});

test('length trends require eight measured values and correlations require five varying paired observations', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ pace: 100 + i * 10, dps: 2 + i * 0.2 }));
  const trend = lengthTrend(rows, 'pace');
  assert.equal(trend.first, 105);
  assert.equal(trend.last, 165);
  assert.ok(Math.abs(trend.change - (165 / 105 - 1) * 100) < 1e-9);
  assert.equal(lengthTrend(rows.slice(0, 7), 'pace').change, null);
  const correlation = lengthCorrelation([...rows, { pace: null, dps: 1 }], 'dps', 'pace');
  assert.equal(correlation.n, 8);
  assert.ok(Math.abs(correlation.r - 1) < 1e-9);
  assert.ok(Math.abs(correlation.slope - 50) < 1e-9);
  assert.equal(lengthCorrelation(rows.slice(0, 4), 'dps', 'pace').r, null);
  assert.equal(lengthCorrelation(rows.map(r => ({ ...r, dps: 2 })), 'dps', 'pace').r, null);
});
import { deriveMetrics, localDate, annotateOutliers, histogram, weeklyTrend, trainingHeatmap, personalBests, sessionRankings, swolfTrend, trainingSummary, strokeMix, sortSessions, filterLogbook, oceanmanPlan, oceanmanPlanRows, oceanmanRollingVolumes, oceanmanReadiness, oceanmanReadinessHistory } from './analytics.mjs';

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
  assert.deepEqual(trend.map(w => w.value), [2, 0, 0, 6]);
  assert.equal(trend[0].rolling, null);
  assert.equal(trend[3].rolling, 2);
  const cells = trainingHeatmap(rows);
  assert.equal(cells[0][8], 1);
  assert.equal(cells[0][18], 1);
  assert.equal(cells.flat().reduce((s, count) => s + count, 0), 2);
});

test('weekly technique ignores missing measurements and open water; swim index uses speed times DPS', () => {
  const rows = [
    activity({ date: '2026-10-12', distance: 1000, movingTime: 1000, strokes: 500, swolf: 40 }),
    activity({ date: '2026-10-13', distance: 1000, movingTime: 2000, strokes: 500, swolf: null }),
    activity({ date: '2026-10-19', type: 'open_water', distance: 1000, movingTime: 1000, strokes: 100, swolf: 80 }),
    activity({ date: '2026-11-02', distance: 1000, movingTime: 1000, strokes: 250, swolf: 44 }),
  ];
  const now = new Date('2026-11-08T12:00:00');
  const index = weeklyTrend(rows, now, 'efficiency');
  assert.deepEqual(index.map(w => w.value), [1.5, null, null, 4]);
  assert.equal(index[3].rolling, 2.75);
  assert.equal(index[3].partial, true);
  assert.deepEqual(weeklyTrend(rows, now, 'swolf').map(w => w.value), [40, null, null, 44]);
  assert.deepEqual(weeklyTrend(rows, now, 'pace').map(w => w.value), [150, 100, null, 100]);
});

test('records require exact FIT windows, include rests, and do not estimate from session averages', () => {
  const a = activity();
  const lengths = Array.from({ length: 8 }, (_, i) => ({
    activityId: '1', sequence: i, active: true, distance: 25, start: i * 35, duration: 30, stroke: 'freestyle',
  }));
  const result = personalBests([a], lengths);
  assert.equal(result['100m freestyle'][0].value, 135);
  assert.equal(result['200m freestyle'][0].duration, 275);
  assert.equal(result['200m freestyle'][0].value, 275);
  assert.equal(result['200m freestyle'][0].pace, 137.5);
  assert.equal(result['50m freestyle'][0].pace, 130);
  assert.equal(result.attempts['100m freestyle'], 2);
  assert.equal(result.attempts['200m freestyle'], 1);
  assert.equal(result.attempts['50m freestyle'], 4);
  assert.equal(result['100m freestyle'].length, 1);
  assert.equal(result['1000m freestyle'].length, 0);
  assert.equal(personalBests([a], [])['100m freestyle'].length, 0);
  lengths[1].stroke = 'drill';
  lengths[5].stroke = 'drill';
  assert.equal(personalBests([a], lengths)['100m freestyle'].length, 0);
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
  assert.equal(personalBests([a], lengths)['100m IM'].length, 0);
  lengths[0].duration = 30;
  lengths[1].start = 0;
  assert.equal(personalBests([a], lengths)['100m IM'].length, 0);
});

test('500m and 1000m records use exact lengths in a 20m pool', () => {
  const longSwim = activity({ id: 'long', poolLength: 20 });
  const lengths = Array.from({ length: 50 }, (_, i) => ({
    activityId: 'long', sequence: i, active: true, distance: 20, start: i * 30, duration: 25, stroke: 'freestyle',
  }));
  const records = personalBests([longSwim], lengths);
  assert.equal(records['500m freestyle'][0].value, 745);
  assert.equal(records['1000m freestyle'][0].value, 1495);
});

test('every stroke has all requested distances and IM has only the requested distances', () => {
  const strokes = ['freestyle', 'breaststroke', 'backstroke', 'butterfly'];
  const distances = [40, 50, 80, 100, 200, 400, 500, 800, 1000, 1500, 2000];
  const activities = strokes.map((_, i) => activity({ id: `stroke-${i}`, poolLength: 25 }));
  const lengths = strokes.flatMap((stroke, strokeIndex) =>
    Array.from({ length: 80 }, (_, i) => ({
      activityId: `stroke-${strokeIndex}`, sequence: i, active: true, distance: 25,
      start: i * 31, duration: 30, stroke,
    })));
  const records = personalBests(activities, lengths, 1);
  for (const stroke of strokes) {
    for (const distance of distances.filter(distance => distance % 25 === 0)) {
      assert.equal(records[`${distance}m ${stroke}`].length, 1);
    }
  }

  const shortPoolActivities = strokes.map((_, i) => activity({ id: `short-${i}`, poolLength: 20 }));
  const shortPoolLengths = strokes.flatMap((stroke, strokeIndex) =>
    Array.from({ length: 8 }, (_, i) => ({
      activityId: `short-${strokeIndex}`, sequence: i, active: true, distance: 20,
      start: i * 30, duration: 25, stroke,
    })));
  const shortPoolRecords = personalBests(shortPoolActivities, shortPoolLengths, 1);
  for (const stroke of strokes) {
    assert.equal(shortPoolRecords.attempts[`40m ${stroke}`], 4);
    assert.equal(shortPoolRecords[`80m ${stroke}`].length, 1);
    assert.equal(shortPoolRecords[`40m ${stroke}`].length, 1);
  }

  const imStrokes = ['butterfly', 'backstroke', 'breaststroke', 'freestyle'];
  const imActivities = [100, 200, 400].map(distance => activity({ id: `im${distance}`, poolLength: 25 }));
  const imLengths = [100, 200, 400].flatMap(distance =>
    imStrokes.flatMap(stroke => Array.from({ length: distance / 100 }, () => stroke))
      .map((stroke, i) => ({
        activityId: `im${distance}`, sequence: i, active: true, distance: 25, start: i * 31, duration: 30, stroke,
      })));
  const imRecords = personalBests(imActivities, imLengths);
  for (const distance of [100, 200, 400]) assert.equal(imRecords[`${distance}m IM`][0].id, `im${distance}`);
  assert.deepEqual(Object.keys(records).filter(key => key !== 'attempts').sort(), [
    ...strokes.flatMap(stroke => distances.map(distance => `${distance}m ${stroke}`)),
    '100m IM', '200m IM', '400m IM',
    ...[750, 1000, 1500, 1852, 3000, 5000].map(distance => `${distance}m open water`),
  ].sort());
});

test('open-water records rank whole activities by moving time within inclusive 7% distance bands', () => {
  const rows = [
    activity({ id: 'lower', type: 'open_water', distance: 930, movingTime: 800, elapsedTime: 1200 }),
    activity({ id: 'upper', type: 'open_water', distance: 1070, movingTime: 900, elapsedTime: 901 }),
    activity({ id: 'below', type: 'open_water', distance: 929.99, movingTime: 300 }),
    activity({ id: 'above', type: 'open_water', distance: 1070.01, movingTime: 300 }),
    activity({ id: 'pool', type: 'pool', distance: 1000, movingTime: 300 }),
    activity({ id: 'missing', type: 'open_water', distance: 1000, movingTime: null }),
    activity({ id: 'mile', type: 'open_water', distance: 1852, movingTime: 1900 }),
    activity({ id: 'three', type: 'open_water', distance: 3000, movingTime: 3500 }),
    activity({ id: 'five', type: 'open_water', distance: 5000, movingTime: 6000 }),
  ];
  const records = personalBests(rows, [], 1);
  assert.equal(records.attempts['1000m open water'], 2);
  assert.deepEqual(records['1000m open water'].map(row => [row.id, row.duration, row.distance]), [['lower', 800, 930]]);
  assert.equal(records['1000m open water'][0].pace, 800 * 100 / 930);
  assert.equal(records['1852m open water'][0].id, 'mile');
  assert.equal(records['3000m open water'][0].id, 'three');
  assert.equal(records['5000m open water'][0].id, 'five');
  assert.deepEqual(personalBests(rows, [], 3)['1000m open water'].map(row => row.id), ['lower', 'upper']);
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

test('environment metrics include open water and average only available measurements', () => {
  const rows = [
    activity({ id: 'open1', type: 'open_water', distance: 1000, movingTime: 1200, heartRate: 140, strokes: 600, lengths: null }),
    activity({ id: 'open2', type: 'open_water', distance: 2000, movingTime: 1800, heartRate: null, strokes: null, lengths: null }),
    activity({ id: 'pool', type: 'pool', swolf: 40 }),
  ];
  const summary = trainingSummary(rows);
  assert.equal(summary.openWater.sessions, 2);
  assert.equal(summary.openWater.averageDistance, 1500);
  assert.equal(summary.openWater.averagePace, 100);
  assert.equal(summary.openWater.averageMovingTime, 1500);
  assert.equal(summary.openWater.averageHeartRate, 140);
  assert.equal(summary.openWater.averageSpm, 30);
  assert.equal(summary.openWater.averageSpl, null);
  assert.equal(summary.pool.averageSwolf, 40);
  const openLengths = Array.from({ length: 4 }, (_, i) => ({
    activityId: 'open1', sequence: i, active: true, distance: 25, start: i * 30, duration: 30, stroke: 'freestyle',
  }));
  assert.equal(personalBests(rows, openLengths)['100m freestyle'].length, 0);
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

test('dashboard hides swims below 500m, preserving the boundary and unknown distances', async () => {
  const { hideShortSessions } = await import('./analytics.mjs');
  const rows = [
    activity({ id: 'short', distance: 499.99 }),
    activity({ id: 'boundary', distance: 500 }),
    activity({ id: 'open', type: 'open_water', distance: 400 }),
    activity({ id: 'unknown', distance: null }),
  ];
  assert.deepEqual(hideShortSessions(rows).map(a => a.id), ['boundary', 'unknown']);
  assert.equal(rows.length, 4);
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

test('Oceanman plan has all 35 targets and aggregates sessions by local plan week and weekday', () => {
  const rows = [
    activity({ id: 'monday', date: '2026-10-12T08:00:00', distance: 3000 }),
    activity({ id: 'friday', date: '2026-10-16T08:00:00', distance: 2000, type: 'open_water', poolLength: null }),
    activity({ id: 'future', date: '2026-11-14T08:00:00', distance: 5000 }),
  ];
  const plan = oceanmanPlanRows(rows, new Date('2026-11-13T23:59:59'));
  assert.equal(oceanmanPlan.length, 35);
  assert.deepEqual([oceanmanPlan[0].targetKm, oceanmanPlan.at(-1).targetKm], [6, 3.5]);
  assert.equal(plan[0].actualKm, 5);
  assert.equal(plan[0].diffKm, -1);
  assert.equal(plan[0].dailyKm[0], 3);
  assert.equal(plan[0].dailyKm[4], 2);
  assert.equal(plan[0].openWaterKm, 2);
  assert.equal(plan[0].swims, 2);
  assert.equal(plan[5].actualKm, null);
});

test('rolling Oceanman volumes use inclusive local calendar days and declared targets', () => {
  const rows = [
    activity({ id: 'inside', date: '2026-10-31T12:00:00', distance: 2000 }),
    activity({ id: 'edge', date: '2026-10-15T12:00:00', distance: 3000 }),
    activity({ id: 'outside', date: '2026-10-14T23:59:59', distance: 4000 }),
  ];
  const windows = oceanmanRollingVolumes(rows, new Date('2026-11-13T12:00:00'));
  assert.deepEqual(windows.map(window => window.days), [14, 30, 60, 90]);
  assert.deepEqual(windows.map(window => window.targetKm), [35, 75, 150, 200]);
  assert.equal(windows[0].actualKm, 2);
  assert.equal(windows[1].actualKm, 5);
});

const oceanmanDate = new Date('2026-11-13T23:59:59');
function freestyleEvidence(id, { date = '2026-11-01T08:00:00', distance = 2000, pace = 120,
  endPace = pace, endStrokes = 12, poolLength = 25 } = {}) {
  const count = distance / poolLength;
  let start = localDate(date).getTime() / 1000;
  const lengths = Array.from({ length: count }, (_, sequence) => {
    const lastQuarter = sequence >= count * 3 / 4;
    const duration = (lastQuarter ? endPace : pace) * poolLength / 100;
    const length = { activityId: id, sequence, active: true, distance: poolLength, start,
      duration, strokes: lastQuarter ? endStrokes : 12, stroke: 'freestyle' };
    start += duration;
    return length;
  });
  const movingTime = lengths.reduce((sum, length) => sum + length.duration, 0);
  return { activity: activity({ id, date, distance, movingTime, elapsedTime: movingTime,
    poolLength, lengths: count }), lengths };
}

test('long-session check measures recent recorded distance without requiring FIT or projecting race time', () => {
  const rows = [
    activity({ id: 'old', date: '2026-06-01T08:00:00', distance: 10000, movingTime: 10000, elapsedTime: 12000 }),
    activity({ id: 'rested', date: '2026-11-01T08:00:00', distance: 6000, movingTime: 6000, elapsedTime: 10000 }),
    activity({ id: 'pool', date: '2026-11-02T08:00:00', distance: 3000, movingTime: 3000, elapsedTime: 4000 }),
  ];
  const result = oceanmanReadiness(rows, oceanmanDate);
  const check = result.checks.find(c => c.id === 'long-session');
  assert.equal(check.value, 3);
  assert.equal(check.progress, 60);
  assert.equal(check.available, true);
  assert.equal(check.complete, false);
  assert.equal(result.checks.find(c => c.id === 'open-water').available, false);
  rows.push(activity({ id: 'ow', date: '2026-11-03T08:00:00', type: 'open_water',
    distance: 5000, movingTime: 7000, elapsedTime: 10000 }));
  const qualified = oceanmanReadiness(rows, oceanmanDate);
  assert.equal(qualified.checks.find(c => c.id === 'long-session').complete, true);
  assert.equal(qualified.checks.find(c => c.id === 'open-water').complete, false);
});

test('Garmin readiness keeps missing FIT evidence pending without redistributing its weight', () => {
  const empty = oceanmanReadiness([], oceanmanDate);
  assert.equal(empty.score, null);
  assert.ok(empty.checks.every(check => check.status === 'pending'));
  const evidence = [0, 1, 2].map(index => freestyleEvidence(`same-${index}`));
  const readiness = oceanmanReadiness(evidence.map(e => e.activity), oceanmanDate, evidence.flatMap(e => e.lengths));
  assert.equal(readiness.checks.find(check => check.id === 'long-session').progress, 40);
  assert.equal(readiness.evidenceWeight, 75);
  assert.ok(readiness.score <= readiness.evidenceWeight);
});

test('Oceanman accepts 70% moving time inclusively and scales continuity from 50% to 70%', () => {
  for (const [ratio, progress, qualifies] of [[0.5, 0, false], [0.6, 50, false], [0.699, 99.5, false], [0.7, 100, true], [0.76, 100, true]]) {
    const rows = [0, 1, 2].map(index => activity({ id: `ow-${index}`, date: '2026-11-01T08:00:00',
      type: 'open_water', distance: 10000, movingTime: 12000, elapsedTime: 12000 / ratio }));
    const result = oceanmanReadiness(rows, oceanmanDate);
    const continuity = result.checks.find(check => check.id === 'continuity');
    assert.ok(Math.abs(continuity.progress - progress) < 1e-8, `ratio=${ratio}`);
    assert.equal(continuity.complete, qualifies, `ratio=${ratio}`);
    assert.equal(result.checks.find(check => check.id === 'open-water').value, qualifies ? 10 : 0);
    assert.equal(result.checks.find(check => check.id === 'long-session').value, qualifies ? 10 : 0);
  }
});

test('session continuity evaluates mixed-style pool summaries including all planned rests', () => {
  const evidence = [0, 1, 2].map(index => freestyleEvidence(`continuity-${index}`, { distance: 1500 }));
  for (const e of evidence) {
    e.activity.elapsedTime = e.activity.movingTime / 0.6;
    for (const l of e.lengths) l.stroke = 'breaststroke';
  }
  const result = oceanmanReadiness(evidence.map(e => e.activity), oceanmanDate, evidence.flatMap(e => e.lengths));
  const check = result.checks.find(c => c.id === 'continuity');
  assert.equal(check.available, true);
  assert.ok(Math.abs(check.progress - 50) < 1e-8);
  assert.equal(check.complete, false);
  assert.equal(oceanmanReadiness(evidence.slice(0, 2).map(e => e.activity), oceanmanDate).checks.find(c => c.id === 'continuity').available, false);
});

test('FIT session technique scores the worse of pace fade and DPS loss and compares within each pool', () => {
  const evidence = [0, 1, 2].map(index => freestyleEvidence(String(index), {
    poolLength: index === 0 ? 50 : 25, endPace: 132, endStrokes: 12,
  }));
  const evaluate = () => oceanmanReadiness(evidence.map(e => e.activity), oceanmanDate, evidence.flatMap(e => e.lengths));
  const readiness = evaluate();
  assert.ok(Math.abs(readiness.technique.paceFade - 10) < 0.00001);
  assert.equal(readiness.technique.dpsLoss, 0);
  const check = readiness.checks.find(c => c.id === 'technique');
  assert.ok(Math.abs(check.progress - 50) < 0.00001);
  assert.equal(check.complete, false);
  assert.equal(readiness.technique.sessions[0].first.spl, 12);
  for (const e of evidence) {
    for (const length of e.lengths) length.strokes = null;
  }
  assert.equal(evaluate().checks.find(c => c.id === 'technique').available, false);
  const stable = [0, 1, 2].map(index => freestyleEvidence(`stable-${index}`));
  const stableCheck = oceanmanReadiness(stable.map(e => e.activity), oceanmanDate, stable.flatMap(e => e.lengths)).checks.find(c => c.id === 'technique');
  assert.equal(stableCheck.progress, 100);
  assert.equal(stableCheck.complete, true);
  const boundary = [0, 1, 2].map(index => freestyleEvidence(`boundary-${index}`, { endPace: 126 }));
  assert.equal(oceanmanReadiness(boundary.map(e => e.activity), oceanmanDate, boundary.flatMap(e => e.lengths)).checks.find(c => c.id === 'technique').complete, true);
  const dpsFade = [0, 1, 2].map(index => freestyleEvidence(`dps-${index}`, { endStrokes: 15 }));
  const dpsCheck = oceanmanReadiness(dpsFade.map(e => e.activity), oceanmanDate, dpsFade.flatMap(e => e.lengths)).checks.find(c => c.id === 'technique');
  assert.equal(dpsCheck.progress, 0);
  assert.equal(dpsCheck.complete, false);
});

test('session technique accepts intervals and intervening styles but rejects invalid length data', () => {
  for (const invalid of ['rest', 'stroke', 'pool-length', 'duration', 'overlap']) {
    const evidence = [0, 1, 2].map(index => freestyleEvidence(`${invalid}-${index}`, { distance: 1000 }));
    for (const e of evidence) {
      const middle = e.lengths.length / 2;
      if (invalid === 'rest') for (const length of e.lengths.slice(middle)) length.start += 200;
      if (invalid === 'stroke') e.lengths[middle].stroke = 'breaststroke';
      if (invalid === 'pool-length') for (const length of e.lengths) length.distance = 50;
      if (invalid === 'duration') for (const length of e.lengths) length.duration = null;
      if (invalid === 'overlap') for (const length of e.lengths) length.start = e.lengths[0].start;
    }
    const result = oceanmanReadiness(evidence.map(e => e.activity), oceanmanDate, evidence.flatMap(e => e.lengths));
    assert.equal(result.checks.find(c => c.id === 'technique').available, ['rest', 'stroke'].includes(invalid), invalid);
  }
  const rows = [
    activity({ id: 'old', date: '2026-06-01T08:00:00', type: 'open_water', distance: 10000, movingTime: 12000, elapsedTime: 12500 }),
    activity({ id: 'rests', date: '2026-11-01T08:00:00', type: 'open_water', distance: 10000, movingTime: 12000, elapsedTime: 18000 }),
    activity({ id: 'recent', date: '2026-11-02T08:00:00', type: 'open_water', distance: 5000, movingTime: 6000, elapsedTime: 6500 }),
  ];
  assert.equal(oceanmanReadiness(rows, oceanmanDate).checks.find(c => c.id === 'open-water').value, 5);
});

test('session technique requires three sessions with 400 metres and sixteen valid freestyle lengths', () => {
  for (const [distance, poolLength, eligible] of [[375, 25, false], [400, 25, true], [400, 50, false], [800, 50, true]]) {
    const evidence = [0, 1, 2].map(index => freestyleEvidence(`short-${index}`, { distance, poolLength }));
    const result = oceanmanReadiness(evidence.map(e => e.activity), oceanmanDate, evidence.flatMap(e => e.lengths));
    assert.equal(result.checks.find(c => c.id === 'technique').available, eligible, `${distance} m / ${poolLength} m pool`);
    if (eligible) {
      assert.equal(result.technique.samples, 3);
      assert.equal(result.checks.find(c => c.id === 'technique').progress, 100);
      const fewer = oceanmanReadiness(evidence.slice(0, 2).map(e => e.activity), oceanmanDate, evidence.flatMap(e => e.lengths));
      assert.equal(fewer.checks.find(c => c.id === 'technique').available, false);
    }
  }
  const evidence = Array.from({ length: 6 }, (_, index) => freestyleEvidence(`latest-${index}`,
    { date: `2026-11-0${index + 1}T08:00:00`, distance: 400 }));
  const result = oceanmanReadiness(evidence.map(e => e.activity), oceanmanDate, evidence.flatMap(e => e.lengths));
  assert.deepEqual(result.technique.sessions.map(s => s.activityId), ['latest-5', 'latest-4', 'latest-3', 'latest-2', 'latest-1']);
});

test('Garmin readiness history recalculates past FIT evidence without using later swims', () => {
  const evidence = [0, 1, 2].map(index => freestyleEvidence(`history-${index}`, { date: `2026-11-0${index + 1}T08:00:00` }));
  const rows = evidence.map(e => e.activity);
  const lengths = evidence.flatMap(e => e.lengths);
  const history = oceanmanReadinessHistory(rows, oceanmanDate, lengths);
  assert.equal(history.at(-1).date, '2026-11-13');
  assert.ok(history.every((point, index) => !index || history[index - 1].date < point.date));
  assert.equal(history[0].evidenceWeight, 50);
  assert.equal(history[2].evidenceWeight, 75);
  for (const point of history) {
    const asOf = new Date(`${point.date}T23:59:59`);
    const direct = oceanmanReadiness(rows.filter(a => localDate(a.date) <= asOf), asOf, lengths);
    assert.equal(point.score, direct.score);
    assert.equal(point.evidenceWeight, direct.evidenceWeight);
  }
  const morning = new Date('2026-11-03T07:00:00');
  assert.equal(oceanmanReadiness(rows, morning, lengths).technique.samples, 2);
  assert.equal(oceanmanReadinessHistory(rows, morning, lengths).at(-1).evidenceWeight, 50);
});
