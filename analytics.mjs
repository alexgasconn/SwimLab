export const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
export const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const divide = (a, b) => a != null && b > 0 ? a / b : null;
export const localDate = value => new Date(typeof value === 'string' ? value.replace(' ', 'T') : NaN);
export const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function deriveMetrics(activity) {
  return {
    ...activity,
    pace: divide(activity.movingTime == null ? null : activity.movingTime * 100, activity.distance),
    movingRatio: divide(activity.movingTime, activity.elapsedTime),
    spm: divide(activity.strokes == null ? null : activity.strokes * 60, activity.movingTime),
    spl: divide(activity.strokes, activity.lengths),
    dps: divide(activity.distance, activity.strokes),
    tpl: divide(activity.movingTime, activity.lengths),
    lpm: divide(activity.lengths == null ? null : activity.lengths * 60, activity.movingTime),
  };
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null;
};

export function activityAnalysis(activity, lengths = [], records = []) {
  const samples = records.filter(r => Number.isFinite(r.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  let activeIndex = 0;
  const rows = lengths.filter(l => l.activityId === activity.id).sort((a, b) => a.sequence - b.sequence).map(l => {
    const duration = positive(l.duration);
    const distance = l.active ? positive(l.distance) : null;
    const strokes = l.active ? nonnegative(l.strokes) : null;
    const end = Number.isFinite(l.start) && duration ? l.start + duration : null;
    const hr = end == null ? [] : samples.filter(r => r.timestamp >= l.start && r.timestamp < end && positive(r.heartRate));
    return { ...l, index: l.active ? ++activeIndex : null, end,
      pace: duration && distance ? duration * 100 / distance : null,
      swolf: duration && strokes != null ? duration + strokes : null,
      dps: distance && strokes > 0 ? distance / strokes : null, spl: strokes,
      spm: duration && strokes != null ? strokes * 60 / duration : null,
      lpm: duration && distance ? 60 / duration : null,
      heartRate: hr.length ? hr.reduce((sum, r) => sum + r.heartRate, 0) / hr.length : null, hrSamples: hr.length };
  });
  const active = rows.filter(r => r.active && r.pace != null);
  const blocks = [];
  let block = null;
  for (const row of rows) {
    if (!row.active) { block = null; continue; }
    if (!block) {
      block = { number: blocks.length + 1, stroke: row.stroke, mixed: false, rows: [], gaps: [] };
      blocks.push(block);
    }
    if (row.stroke !== block.stroke) block.mixed = true;
    block.rows.push(row);
  }
  for (const b of blocks) {
    b.distance = b.rows.every(r => positive(r.distance)) ? b.rows.reduce((sum, r) => sum + r.distance, 0) : null;
    b.duration = b.rows.every(r => positive(r.duration)) ? b.rows.reduce((sum, r) => sum + r.duration, 0) : null;
    b.pace = divide(b.duration == null ? null : b.duration * 100, b.distance);
    b.start = b.rows[0].start;
    b.end = b.rows.at(-1).end;
    b.elapsed = Number.isFinite(b.start) && b.end != null && b.end >= b.start ? b.end - b.start : null;
    const count = b.rows.length;
    const strokes = b.rows.every(r => r.spl != null) ? b.rows.reduce((sum, r) => sum + r.spl, 0) : null;
    const timerTime = b.rows.every(r => nonnegative(r.timerTime) != null)
      ? b.rows.reduce((sum, r) => sum + r.timerTime, 0) : null;
    const hrSamples = b.rows.reduce((sum, r) => sum + r.hrSamples, 0);
    const dps = divide(b.distance, strokes);
    b.metrics = {
      strokes, timerTime, dps, spl: divide(strokes, count),
      spm: divide(strokes == null ? null : strokes * 60, b.duration),
      swolf: strokes == null || b.duration == null ? null : (b.duration + strokes) / count,
      tpl: divide(b.duration, count), lpm: divide(count * 60, b.duration),
      efficiency: dps == null || b.duration == null ? null : b.distance / b.duration * dps,
      heartRate: divide(b.rows.reduce((sum, r) => sum + r.heartRate * r.hrSamples, 0), hrSamples),
      hrSamples,
    };
  }
  const timed = rows.filter(r => Number.isFinite(r.start) && r.end != null);
  const starts = [...timed.map(r => r.start), ...samples.map(r => r.timestamp)];
  const origin = starts.length ? starts.reduce((min, value) => Math.min(min, value), Infinity) : null;
  const blockByFirst = new Map(blocks.map(b => [b.rows[0], b]));
  const blockByRow = new Map(blocks.flatMap(b => b.rows.map(row => [row, b])));
  const intervals = [];
  let latestEnd = null;
  for (const row of rows) {
    if (Number.isFinite(row.start) && latestEnd != null && row.start - latestEnd > 15) {
      const gap = { kind: 'gap', start: latestEnd, duration: row.start - latestEnd };
      const containingBlock = blockByRow.get(row);
      if (containingBlock && row !== containingBlock.rows[0]) containingBlock.gaps.push(gap);
      else intervals.push(gap);
    }
    if (blockByFirst.has(row)) intervals.push({ ...blockByFirst.get(row), kind: 'swim' });
    if (!row.active) intervals.push({ kind: 'rest', start: row.start, duration: positive(row.duration) });
    latestEnd = row.end != null ? Math.max(latestEnd ?? row.end, row.end) : null;
  }
  const heartRates = samples.map(r => positive(r.heartRate)).filter(v => v != null);
  const hrGaps = samples.slice(1).map((r, i) => r.timestamp - samples[i].timestamp).filter(v => v > 0);
  const warnings = [];
  const invalid = rows.filter(r => r.active && r.pace == null).length;
  if (invalid) warnings.push(`${invalid} active lengths have missing distance or duration and cannot enter pace analysis.`);
  if (timed.length !== rows.length && rows.length) warnings.push(`${rows.length - timed.length} lengths lack valid timing; they are omitted from the time ribbon and HR alignment.`);
  if (timed.some((r, i) => i && r.start < timed[i - 1].end - 0.5)) warnings.push('FIT length intervals overlap; check sensor recording. Sets remain grouped until a recorded rest.');
  if (activity.type === 'pool' && active.length && Math.abs(active.reduce((sum, r) => sum + r.distance, 0) - activity.distance) > Math.max(2, activity.distance * 0.02)) {
    warnings.push('Recorded length distance differs from the session summary; length charts use FIT lengths, not rescaled values.');
  }
  return { rows, active, blocks, intervals, timed, samples, origin, warnings,
    hr: { count: heartRates.length, min: heartRates.length ? heartRates.reduce((a, b) => Math.min(a, b)) : null,
      max: heartRates.length ? heartRates.reduce((a, b) => Math.max(a, b)) : null, median: median(heartRates),
      gapLimit: Math.max(15, (median(hrGaps) ?? 5) * 3) } };
}

export function lengthTrend(rows, metric) {
  const values = rows.filter(r => Number.isFinite(r[metric]));
  if (values.length < 8) return { n: values.length, first: null, last: null, change: null };
  const count = Math.floor(values.length / 4);
  const first = median(values.slice(0, count).map(r => r[metric]));
  const last = median(values.slice(-count).map(r => r[metric]));
  return { n: values.length, first, last, change: first !== 0 ? (last / first - 1) * 100 : null };
}

export function lengthCorrelation(rows, xKey, yKey) {
  const pairs = rows.filter(r => Number.isFinite(r[xKey]) && Number.isFinite(r[yKey]));
  if (pairs.length < 5) return { n: pairs.length, r: null, slope: null, intercept: null };
  const meanX = pairs.reduce((sum, p) => sum + p[xKey], 0) / pairs.length;
  const meanY = pairs.reduce((sum, p) => sum + p[yKey], 0) / pairs.length;
  let xx = 0, yy = 0, xy = 0;
  for (const p of pairs) {
    const dx = p[xKey] - meanX, dy = p[yKey] - meanY;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
  }
  return { n: pairs.length, r: xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : null,
    slope: xx > 0 && yy > 0 ? xy / xx : null, intercept: xx > 0 && yy > 0 ? meanY - xy / xx * meanX : null };
}

export function annotateOutliers(activities) {
  const groups = new Map(['pool', 'open_water'].map(type => {
    const logs = activities.filter(a => a.type === type && a.pace > 0).map(a => Math.log(a.pace));
    const centre = median(logs);
    return [type, { n: logs.length, centre, mad: median(logs.map(v => Math.abs(v - centre))) }];
  }));
  return activities.map(a => {
    const reasons = [];
    if (!a.distance || !a.movingTime || !a.elapsedTime) reasons.push('Missing or non-positive distance / moving / elapsed time');
    if (Number.isNaN(localDate(a.date).getTime())) reasons.push('Invalid local start date');
    if (a.movingTime > a.elapsedTime + 2) reasons.push('Moving time exceeds elapsed time');
    if (a.distance > 100000) reasons.push('Distance exceeds 100 km');
    if (a.pace && (a.pace < 35 || a.pace > (a.type === 'pool' ? 600 : 1200))) reasons.push('Moving pace outside conservative plausibility limits');
    if (a.poolLength != null && (a.poolLength < 10 || a.poolLength > 100)) reasons.push('Pool length outside 10-100 m');
    if (a.type === 'pool' && a.lengths > 0 && a.poolLength > 0
      && Math.abs(a.lengths * a.poolLength - a.distance) > Math.max(2, a.distance * 0.02)) {
      reasons.push('Distance does not match active lengths x pool length');
    }
    const group = groups.get(a.type);
    if (group?.n >= 8 && a.pace > 0 && group.mad > 0.001) {
      const deviation = Math.abs(Math.log(a.pace) - group.centre);
      if (deviation / (1.4826 * group.mad) > 4.5 && deviation > Math.log(1.5)) {
        reasons.push('Unusual pace for this swim type (robust MAD > 4.5)');
      }
    }
    return { ...a, reasons, excluded: a.review === 'exclude' || (a.review !== 'include' && reasons.length > 0) };
  });
}

export function histogram(values, count = 8) {
  const numbers = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!numbers.length) return [];
  let min = Math.min(...numbers);
  let max = Math.max(...numbers);
  if (min === max) { min = Math.max(0, min - 1); max += 1; }
  const width = (max - min) / count;
  const bins = Array.from({ length: count }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const value of numbers) bins[Math.min(count - 1, Math.floor((value - min) / width))].count++;
  return bins;
}

function monday(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - (result.getDay() + 6) % 7);
  return result;
}

export const weeklyMetrics = {
  distance: { label: 'Distance (km)', value: a => a.distance / 1000 },
  pace: { label: 'Pace (/100 m)', value: a => positive(a.pace) },
  dps: { label: 'DPS (m/stroke)', value: a => positive(a.dps) },
  spl: { label: 'SPL (strokes/length)', value: a => positive(a.spl) },
  swolf: { label: 'SWOLF', value: a => positive(a.swolf) },
  tpl: { label: 'TPL (s/length)', value: a => positive(a.tpl) },
  efficiency: { label: 'Efficiency (swim index)', value: a => positive(a.pace) && positive(a.dps) ? 100 / a.pace * a.dps : null },
  spm: { label: 'SPM (strokes/min)', value: a => positive(a.spm) },
};

export function weeklyTrend(activities, now = new Date(), metric = 'distance') {
  const valid = activities.filter(a => !Number.isNaN(localDate(a.date).getTime()) && a.distance > 0);
  if (!valid.length) return [];
  const isDistance = metric === 'distance';
  const definition = weeklyMetrics[metric];
  const totals = new Map();
  for (const a of valid) {
    if (!isDistance && metric !== 'pace' && a.type !== 'pool') continue;
    const value = definition.value(a);
    if (value == null) continue;
    const key = dateKey(monday(localDate(a.date)));
    const bucket = totals.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += value;
    bucket.count++;
    totals.set(key, bucket);
  }
  const first = monday(new Date(Math.min(...valid.map(a => localDate(a.date).getTime()))));
  const last = monday(new Date(Math.max(now.getTime(), ...valid.map(a => localDate(a.date).getTime()))));
  // A malformed historical date must not allocate an unbounded chart.
  if ((last - first) / 86400000 > 36525) throw new Error('Weekly history exceeds 100 years; review the source dates.');
  const weeks = [];
  for (const cursor = first; cursor <= last; cursor.setDate(cursor.getDate() + 7)) {
    const key = dateKey(cursor);
    const bucket = totals.get(key);
    const value = isDistance ? bucket?.sum ?? 0 : bucket ? bucket.sum / bucket.count : null;
    weeks.push({ date: key, value, rolling: null, partial: key === dateKey(monday(now)) });
    if (weeks.length >= 4) {
      const recent = weeks.slice(-4).map(w => w.value).filter(v => v != null);
      weeks.at(-1).rolling = divide(recent.reduce((sum, v) => sum + v, 0), recent.length);
    }
  }
  return weeks;
}

export function trainingHeatmap(activities) {
  const cells = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const a of activities) {
    const date = localDate(a.date);
    if (!Number.isNaN(date.getTime())) cells[(date.getDay() + 6) % 7][date.getHours()]++;
  }
  return cells;
}

export function strokeMix(activities, lengths) {
  const poolIds = new Set(activities.filter(a => a.type === 'pool').map(a => a.id));
  const totals = { freestyle: 0, breaststroke: 0, backstroke: 0, butterfly: 0, other: 0 };
  const covered = new Set();
  for (const length of lengths) {
    if (!poolIds.has(length.activityId) || !length.active || !positive(length.distance)) continue;
    const stroke = Object.hasOwn(totals, length.stroke) ? length.stroke : 'other';
    totals[stroke] += length.distance;
    covered.add(length.activityId);
  }
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return {
    total, sessions: covered.size, poolSessions: poolIds.size,
    strokes: Object.entries(totals).map(([stroke, distance]) => ({
      stroke, distance, percentage: total ? distance / total * 100 : null,
    })),
  };
}

export function sortSessions(activities, getValue, direction = 'ascending') {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const missing = value => value == null || typeof value === 'number' && !Number.isFinite(value);
  return [...activities].sort((a, b) => {
    const left = getValue(a), right = getValue(b);
    if (missing(left) || missing(right)) return missing(left) === missing(right) ? 0 : missing(left) ? 1 : -1;
    const result = typeof left === 'number' && typeof right === 'number'
      ? left - right : collator.compare(String(left), String(right));
    return direction === 'ascending' ? result : -result;
  });
}

export function hideShortSessions(activities) {
  return activities.filter(a => a.distance == null || a.distance >= 500);
}

export function filterLogbook(activities, { minDistance = null, maxDistance = null, pool = 'all' }) {
  return activities.filter(a => {
    if ((minDistance != null || maxDistance != null) && !Number.isFinite(a.distance)) return false;
    if (minDistance != null && a.distance < minDistance) return false;
    if (maxDistance != null && a.distance > maxDistance) return false;
    if (pool === 'open_water') return a.type === 'open_water';
    if (pool === 'unknown') return a.type === 'pool' && !(a.poolLength > 0);
    if (pool !== 'all') return a.type === 'pool' && a.poolLength === Number(pool);
    return true;
  });
}

const strokeOrder = ['butterfly', 'backstroke', 'breaststroke', 'freestyle'];
export const recordDistanceGroups = [
  { title: 'Sprint', distances: [40, 50, 80, 100] },
  { title: 'Middle distance', distances: [200, 400, 500] },
  { title: 'Long distance', distances: [800, 1000, 1500, 2000] },
];
export const openWaterRecordDistances = [
  { distance: 750, label: '750 m' },
  { distance: 1000, label: '1000 m' },
  { distance: 1500, label: '1500 m' },
  { distance: 1852, label: 'Nautical mile (1852 m)' },
  { distance: 3000, label: '3000 m' },
  { distance: 5000, label: '5000 m' },
];
const openWaterKey = distance => `${distance}m open water`;
const categories = [
  ...[100, 200, 400].map(distance => ({ key: `${distance}m IM`, distance, medley: true })),
  ...['freestyle', 'breaststroke', 'backstroke', 'butterfly'].flatMap(stroke =>
    recordDistanceGroups.flatMap(group => group.distances.map(distance => ({ key: `${distance}m ${stroke}`, distance, stroke })))),
];

export function personalBests(activities, lengths, limit = 3) {
  const keys = [...categories.map(category => category.key), ...openWaterRecordDistances.map(({ distance }) => openWaterKey(distance))];
  const result = Object.fromEntries(keys.map(key => [key, []]));
  const attempts = Object.fromEntries(keys.map(key => [key, 0]));
  const byId = new Map();
  for (const length of lengths) {
    if (!byId.has(length.activityId)) byId.set(length.activityId, []);
    byId.get(length.activityId).push(length);
  }
  for (const activity of activities) {
    const entry = { id: activity.id, name: activity.name, date: activity.date, pace: activity.pace,
      duration: positive(activity.elapsedTime) };
    if (activity.type === 'open_water' && positive(activity.distance) && positive(activity.movingTime)) {
      for (const { distance } of openWaterRecordDistances) {
        if (activity.distance < distance * 0.93 || activity.distance > distance * 1.07) continue;
        const key = openWaterKey(distance);
        attempts[key]++;
        result[key].push({ ...entry, distance: activity.distance, value: activity.movingTime,
          duration: activity.movingTime, pace: activity.movingTime * 100 / activity.distance });
      }
    }
    if (activity.type !== 'pool') continue;
    const active = (byId.get(activity.id) ?? []).filter(l => l.active).sort((a, b) => a.sequence - b.sequence);
    for (const category of categories) {
      if (category.stroke && category.stroke !== 'freestyle' && !active.some(l => l.stroke === category.stroke)) continue;
      const efforts = [];
      for (let start = 0; start < active.length; start++) {
        let distance = 0;
        let previousEnd = null;
        for (let end = start; end < active.length; end++) {
          const length = active[end];
          const lengthPace = divide(length.duration * 100, length.distance);
          if (!Number.isFinite(length.start) || !length.distance || !length.duration
            || lengthPace < 30 || lengthPace > 900 || ['drill', 'mixed', 'unknown'].includes(length.stroke)
            || !strokeOrder.includes(length.stroke) || (previousEnd != null && length.start < previousEnd - 1)) break;
          if (category.stroke && length.stroke !== category.stroke) break;
          if (category.medley) {
            const quarter = category.distance / 4;
            const stage = Math.floor((distance + 0.001) / quarter);
            if (length.stroke !== strokeOrder[stage] || distance % quarter + length.distance > quarter + 0.01) break;
          }
          distance += length.distance;
          previousEnd = length.start + length.duration;
          if (distance > category.distance + 0.01) break;
          if (Math.abs(distance - category.distance) < 0.01) {
            const time = previousEnd - active[start].start;
            if (time > 0) efforts.push({ start, end, time });
            break;
          }
        }
      }
      let previousEnd = -1;
      for (const effort of efforts.sort((a, b) => a.end - b.end || a.start - b.start)) {
        if (effort.start <= previousEnd) continue;
        attempts[category.key]++;
        previousEnd = effort.end;
      }
      const best = efforts.reduce((minimum, effort) => Math.min(minimum, effort.time), Infinity);
      // One best effort per session avoids filling the podium with overlapping windows.
      if (Number.isFinite(best)) result[category.key].push({ ...entry, value: best, duration: best, pace: best * 100 / category.distance });
    }
  }
  for (const [key, entries] of Object.entries(result)) {
    entries.sort((a, b) => a.value - b.value);
    result[key] = entries.slice(0, limit);
  }
  result.attempts = attempts;
  return result;
}

export function personalBestHistory(entries, period) {
  if (period !== 'week' && period !== 'month') throw new Error('Invalid personal best history period.');
  const periods = new Map();
  for (const entry of entries) {
    const date = localDate(entry.date);
    if (!Number.isFinite(date.getTime()) || !positive(entry.value)) continue;
    const start = period === 'week' ? monday(date) : new Date(date.getFullYear(), date.getMonth(), 1);
    const key = dateKey(start);
    const previous = periods.get(key);
    if (!previous || entry.value < previous.value) periods.set(key, entry);
  }
  let best = null;
  return [...periods].sort(([a], [b]) => a.localeCompare(b)).map(([date, entry]) => {
    if (!best || entry.value < best.value) best = entry;
    return { date, entry, best };
  });
}

export function swolfTrend(activities) {
  return activities.filter(a => a.swolf > 0 && !Number.isNaN(localDate(a.date).getTime()))
    .sort((a, b) => localDate(a.date) - localDate(b.date));
}

export function sessionRankings(activities, metric, limit = 5) {
  const candidates = activities.filter(a => metric === 'distance' ? a.distance > 0
    : metric === 'pace' ? a.distance >= 100 && a.pace > 0 : a.swolf > 0);
  const value = a => metric === 'distance' ? a.distance : metric === 'pace' ? a.pace : a.swolf;
  return candidates.sort((a, b) => metric === 'distance' ? value(b) - value(a) : value(a) - value(b))
    .slice(0, limit).map(a => ({ id: a.id, name: a.name, date: a.date, value: value(a), type: a.type, pace: a.pace,
      duration: positive(a.elapsedTime) }));
}

export function trainingSummary(activities) {
  const summarize = rows => {
    const paced = rows.filter(a => a.distance > 0 && a.movingTime > 0);
    const measuredDistance = rows.filter(a => a.distance > 0);
    const average = getValue => mean(rows.map(getValue).map(positive).filter(value => value != null));
    return {
      sessions: rows.length,
      distance: rows.reduce((sum, a) => sum + (a.distance > 0 ? a.distance : 0), 0),
      averageDistance: measuredDistance.length ? measuredDistance.reduce((sum, a) => sum + a.distance, 0) / measuredDistance.length : null,
      averagePace: divide(paced.reduce((sum, a) => sum + a.movingTime * 100, 0), paced.reduce((sum, a) => sum + a.distance, 0)),
      averageSwolf: average(a => a.swolf),
      averageMovingTime: average(a => a.movingTime),
      averageHeartRate: average(a => a.heartRate),
      averageSpm: average(a => a.spm),
      averageDps: average(a => a.dps),
      averageSpl: average(a => a.spl),
      averageTpl: average(a => a.tpl),
      averageLpm: average(a => a.lpm),
      averageEfficiency: average(a => weeklyMetrics.efficiency.value(a)),
    };
  };
  const pool = activities.filter(a => a.type === 'pool');
  const openWater = activities.filter(a => a.type === 'open_water');
  const poolLengths = new Map();
  for (const activity of pool) {
    const key = activity.poolLength > 0 ? activity.poolLength : null;
    if (!poolLengths.has(key)) poolLengths.set(key, []);
    poolLengths.get(key).push(activity);
  }
  return {
    totalSessions: activities.length,
    pool: summarize(pool),
    openWater: summarize(openWater),
    poolLengths: [...poolLengths.entries()].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
      .map(([length, rows]) => ({ length, ...summarize(rows) })),
  };
}

export const oceanmanPlan = [
  ['2026-10-12', 6], ['2026-10-19', 7], ['2026-10-26', 8], ['2026-11-02', 9], ['2026-11-09', 10],
  ['2026-11-16', 11], ['2026-11-23', 12], ['2026-11-30', 9], ['2026-12-07', 13], ['2026-12-14', 14],
  ['2026-12-21', 15], ['2026-12-28', 11], ['2027-01-04', 16], ['2027-01-11', 17], ['2027-01-18', 18],
  ['2027-01-25', 13], ['2027-02-01', 19], ['2027-02-08', 20], ['2027-02-15', 21], ['2027-02-22', 15],
  ['2027-03-01', 22], ['2027-03-08', 23], ['2027-03-15', 24], ['2027-03-22', 16], ['2027-03-29', 25],
  ['2027-04-05', 26], ['2027-04-12', 27], ['2027-04-19', 28], ['2027-04-26', 18], ['2027-05-03', 26],
  ['2027-05-10', 24], ['2027-05-17', 20], ['2027-05-24', 15], ['2027-05-31', 10], ['2027-06-07', 3.5],
].map(([week, targetKm], index) => ({ number: index + 1, week, targetKm }));

const swimming = activities => activities.filter(a => ['pool', 'open_water'].includes(a.type)
  && positive(a.distance) && !Number.isNaN(localDate(a.date).getTime()));

export function oceanmanPlanRows(activities, asOf = new Date()) {
  const rows = swimming(activities);
  const today = new Date(asOf);
  today.setHours(23, 59, 59, 999);
  const thisMonday = monday(today);
  return oceanmanPlan.map(week => {
    const start = localDate(`${week.week}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const sessions = rows.filter(a => {
      const date = localDate(a.date);
      return date >= start && date < end && date <= today;
    });
    const dailyKm = Array(7).fill(0);
    for (const session of sessions) {
      const date = localDate(session.date);
      dailyKm[(date.getDay() + 6) % 7] += session.distance / 1000;
    }
    const distances = sessions.map(a => a.distance / 1000);
    const current = start <= thisMonday;
    return {
      ...week,
      actualKm: current ? dailyKm.reduce((sum, km) => sum + km, 0) : null,
      diffKm: current ? dailyKm.reduce((sum, km) => sum + km, 0) - week.targetKm : null,
      dailyKm: current ? dailyKm : null,
      swims: current ? sessions.length : null,
      minKm: current && distances.length ? Math.min(...distances) : null,
      averageKm: current && distances.length ? distances.reduce((sum, km) => sum + km, 0) / distances.length : null,
      maxKm: current && distances.length ? Math.max(...distances) : null,
      openWaterKm: current ? sessions.filter(a => a.type === 'open_water').reduce((sum, a) => sum + a.distance / 1000, 0) : null,
    };
  });
}

const rollingTargets = [
  { days: 14, targetKm: 35, label: 'Carga aguda activa (ATL)' },
  { days: 30, targetKm: 75, label: 'Carga mensual sostenida' },
  { days: 60, targetKm: 150, label: 'Mesociclo de carga' },
  { days: 90, targetKm: 200, label: 'Macrobase trimestral' },
];

export function oceanmanRollingVolumes(activities, asOf = new Date()) {
  const rows = swimming(activities);
  const end = localDate(`${dateKey(asOf)}T00:00:00`);
  end.setHours(23, 59, 59, 999);
  return rollingTargets.map(window => {
    const start = localDate(`${dateKey(asOf)}T00:00:00`);
    start.setDate(start.getDate() - window.days + 1);
    const actualKm = rows.filter(a => {
      const date = localDate(a.date);
      return date >= start && date <= end;
    }).reduce((sum, a) => sum + a.distance / 1000, 0);
    return { ...window, actualKm, progress: Math.min(100, actualKm / window.targetKm * 100) };
  });
}

const boundedPercent = value => Math.max(0, Math.min(100, value));

function freestyleQuarterMetrics(quarter) {
  const metres = quarter.reduce((sum, length) => sum + length.distance, 0);
  const seconds = quarter.reduce((sum, length) => sum + length.duration, 0);
  if (!quarter.length || !quarter.every(length => positive(length.strokes))) return null;
  const strokes = quarter.reduce((sum, length) => sum + length.strokes, 0);
  return { pace: seconds * 100 / metres, dps: metres / strokes,
    spl: strokes / quarter.length, lpm: quarter.length * 60 / seconds,
    swolf: (seconds + strokes) / quarter.length };
}

function validFreestyleLength(length, activity) {
  const pace = positive(length.duration) && positive(length.distance) ? length.duration * 100 / length.distance : null;
  return length.active && length.stroke === 'freestyle' && Number.isFinite(length.start)
    && Number.isInteger(length.sequence) && pace != null && pace >= 30 && pace <= 900
    && Math.abs(length.distance - activity.poolLength) <= 0.01;
}

function freestyleSessionTechnique(activities, lengths) {
  const byId = new Map();
  for (const length of lengths) {
    if (!byId.has(length.activityId)) byId.set(length.activityId, []);
    byId.get(length.activityId).push(length);
  }
  return activities.filter(a => a.type === 'pool' && positive(a.poolLength)).flatMap(activity => {
    const valid = [];
    let previousEnd = -Infinity, previousSequence = -Infinity;
    for (const length of [...(byId.get(activity.id) ?? [])].sort((a, b) => a.sequence - b.sequence)) {
      if (!validFreestyleLength(length, activity) || !positive(length.strokes)
        || length.sequence <= previousSequence || length.start < previousEnd - 1e-6) continue;
      valid.push(length);
      previousSequence = length.sequence;
      previousEnd = length.start + length.duration;
    }
    const distance = valid.reduce((sum, length) => sum + length.distance, 0);
    if (distance < 400 || valid.length < 16) return [];
    const quarterSize = Math.floor(valid.length / 4);
    const first = freestyleQuarterMetrics(valid.slice(0, quarterSize));
    const last = freestyleQuarterMetrics(valid.slice(-quarterSize));
    return [{ activityId: activity.id, poolLength: activity.poolLength, distance, lengths: valid.length, first, last,
      paceFade: (last.pace / first.pace - 1) * 100, dpsLoss: (1 - last.dps / first.dps) * 100 }];
  });
}

export function oceanmanReadiness(activities, asOf = new Date(), lengths = []) {
  const minimumMovingRatio = 0.7;
  const meetsMovingMinimum = ratio => ratio >= minimumMovingRatio - 1e-9;
  const rows = swimming(activities).filter(a => localDate(a.date) <= asOf);
  const start = new Date(asOf);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 89);
  const recent = rows.filter(a => localDate(a.date) >= start);
  const validTiming = a => positive(a.movingTime) && positive(a.elapsedTime)
    && a.movingTime <= a.elapsedTime;
  const openWater = recent.filter(a => a.type === 'open_water' && a.distance >= 2000 && validTiming(a));
  const longSessions = recent.filter(a => a.distance >= 1500 && validTiming(a));
  const qualifiedLongSessions = longSessions.filter(a => meetsMovingMinimum(a.movingTime / a.elapsedTime));
  const maxSessionKm = qualifiedLongSessions.reduce((maximum, a) => Math.max(maximum, a.distance / 1000), 0);
  const continuousOpenWater = openWater.filter(a => meetsMovingMinimum(a.movingTime / a.elapsedTime));

  const currentMonday = monday(asOf);
  const recentWeeks = Array.from({ length: 8 }, (_, index) => {
    const start = new Date(currentMonday);
    start.setDate(start.getDate() - (8 - index) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return rows.filter(a => {
      const date = localDate(a.date);
      return date >= start && date < end;
    });
  });
  const weeklyAverage = recentWeeks.reduce((sum, week) =>
    sum + week.reduce((total, a) => total + a.distance / 1000, 0), 0) / 8;
  const consistentWeeks = recentWeeks.filter(week => week.length >= 3).length;
  const continuityRatios = longSessions.map(a => a.movingTime / a.elapsedTime);
  const continuity = continuityRatios.length >= 3 ? median(continuityRatios) : null;
  const techniqueSessions = freestyleSessionTechnique(recent, lengths)
    .sort((a, b) => localDate(recent.find(row => row.id === b.activityId).date)
      - localDate(recent.find(row => row.id === a.activityId).date)).slice(0, 5);
  const paceFade = techniqueSessions.length >= 3 ? median(techniqueSessions.map(session => session.paceFade)) : null;
  const dpsLoss = techniqueSessions.length >= 3 ? median(techniqueSessions.map(session => session.dpsLoss)) : null;
  const techniqueAvailable = paceFade != null && dpsLoss != null;
  // Inclusive percentage thresholds allow numerical roundoff, not additional deterioration.
  const paceStable = techniqueAvailable && paceFade <= 5 + 1e-9;
  const dpsStable = techniqueAvailable && dpsLoss <= 5 + 1e-9;
  const maxOpenWaterKm = continuousOpenWater.reduce((maximum, a) => Math.max(maximum, a.distance / 1000), 0);
  const hasHistory = rows.length > 0;
  const number = (value, digits = 1) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }).format(value);
  const techniqueSummary = [...new Set(techniqueSessions.map(session => session.poolLength))].map(poolLength => {
    const samePool = techniqueSessions.filter(session => session.poolLength === poolLength);
    const metrics = ['dps', 'spl', 'lpm', 'swolf'].map(metric =>
      `${metric.toUpperCase()} ${number(median(samePool.map(session => session.first[metric])), 2)}→${number(median(samePool.map(session => session.last[metric])), 2)}`);
    return `${number(poolLength)} m (${samePool.length} sesiones): ${metrics.join('; ')}`;
  }).join(' · ');
  const techniqueProgress = !techniqueAvailable ? null
    : paceStable && dpsStable ? 100 : boundedPercent(100 - Math.max(0, paceFade - 5, dpsLoss - 5) * 10);
  const definitions = [
    {
      id: 'long-session', title: 'Tirada larga reciente', weight: 15,
      value: hasHistory ? maxSessionKm : null, display: hasHistory ? `${number(maxSessionKm, 2)} km` : '--',
      progress: hasHistory ? boundedPercent(maxSessionKm / 5 * 100) : null,
      complete: maxSessionKm >= 5, available: longSessions.length > 0,
      base: `${qualifiedLongSessions.length} de ${longSessions.length} sesiones ≥1,5 km con ≥70% en movimiento en los últimos 90 días. Piscina y OW; todos los estilos.`,
      description: 'Mayor distancia registrada en una sesión reciente con ≥70% en movimiento/total. Objetivo: 5 km. Admite series y descansos; no prueba nado continuo ni predice el tiempo de 14 km. La resistencia OW sigue teniendo su propio objetivo de 10 km.',
      milestones: [2, 3, 5].map(km => ({ label: `${km} km en una sesión con ≥70% en movimiento`, done: maxSessionKm >= km })),
    },
    {
      id: 'open-water', title: 'Resistencia reciente en aguas abiertas', weight: 25,
      value: hasHistory ? maxOpenWaterKm : null, display: hasHistory ? `${number(maxOpenWaterKm, 2)} km` : '--',
      progress: hasHistory ? boundedPercent(maxOpenWaterKm / 10 * 100) : null,
      complete: maxOpenWaterKm >= 10, available: openWater.length > 0,
      base: `${continuousOpenWater.length} sesiones OW ≥2 km con ≥70% en movimiento en los últimos 90 días; ${openWater.length} con tiempos válidos.`,
      description: 'Mayor distancia OW reciente con al menos 70% en movimiento/total. Admite hasta un 30% de tiempo no móvil registrado; no demuestra nado sin parar. Las sesiones por debajo del mínimo o sin tiempos válidos no acreditan esta distancia.',
      milestones: [5, 8, 10].map(km => ({ label: `${km} km con ≥70% en movimiento`, done: maxOpenWaterKm >= km })),
    },
    {
      id: 'weekly-volume', title: 'Volumen semanal sostenido', weight: 25,
      value: hasHistory ? weeklyAverage : null, display: hasHistory ? `${number(weeklyAverage)} km/sem` : '--',
      progress: hasHistory ? boundedPercent(weeklyAverage / 20 * 100) : null,
      complete: weeklyAverage >= 20, available: hasHistory,
      base: 'Media de las 8 últimas semanas completas, de lunes a domingo. Las semanas sin datos registrados cuentan como cero.',
      description: 'Objetivo final: 20 km/semana sostenidos, no el cumplimiento del objetivo de esta fase del plan. Todos los estilos contribuyen al volumen. Un pico aislado no sustituye ocho semanas de base; el historial incompleto puede infravalorar la carga.',
      milestones: [10, 15, 20].map(km => ({ label: `${km} km/semana`, done: weeklyAverage >= km })),
    },
    {
      id: 'continuity', title: 'Continuidad de sesión', weight: 15,
      value: continuity, display: continuity == null ? '--' : `${number(continuity * 100)}%`,
      progress: continuity == null ? null : meetsMovingMinimum(continuity) ? 100
        : boundedPercent((continuity - 0.5) / (minimumMovingRatio - 0.5) * 100),
      complete: continuity != null && meetsMovingMinimum(continuity), available: continuity != null,
      base: `${continuityRatios.length} sesiones completas ≥1,5 km en 90 días, piscina y OW. Requiere ≥3 con tiempos válidos; mediana de movimiento/total.`,
      description: 'Continuidad de sesión, incluidos descansos entre series y todos los estilos. Objetivo ≥70% de mediana en movimiento/total; 50% o menos no suma puntos. No certifica nado continuo ni preparación clínica.',
      milestones: [{ label: '60% del tiempo nadando', done: continuity != null && continuity >= 0.6 - 1e-9 },
        { label: '70% del tiempo nadando', done: continuity != null && meetsMovingMinimum(continuity) }],
    },
    {
      id: 'consistency', title: 'Constancia', weight: 10,
      value: hasHistory ? consistentWeeks : null, display: hasHistory ? `${consistentWeeks} / 8 semanas` : '--',
      progress: hasHistory ? boundedPercent(consistentWeeks / 6 * 100) : null,
      complete: consistentWeeks >= 6, available: hasHistory,
      base: `${consistentWeeks} de las 8 últimas semanas completas con ≥3 sesiones registradas.`,
      description: 'Objetivo: 6 de 8 semanas con tres o más sesiones. La semana actual no se cuenta; los días sin registros no se inventan.',
      milestones: [4, 6].map(weeks => ({ label: `${weeks} de 8 semanas`, done: consistentWeeks >= weeks })),
    },
    {
      id: 'technique', title: 'Estabilidad del crol en sesión (FIT)', weight: 10,
      value: techniqueAvailable ? Math.max(paceFade, dpsLoss) : null,
      display: techniqueAvailable ? `Ritmo ${number(paceFade)}% · DPS ${number(-dpsLoss || 0)}%` : '--',
      progress: techniqueProgress, complete: paceStable && dpsStable,
      available: techniqueAvailable,
      base: techniqueAvailable ? `${techniqueSessions.length} sesiones con ≥400 m y ≥16 largos válidos de crol: primer vs último cuarto. Mediana de cambios por sesión. Evidencia por longitud de piscina: ${techniqueSummary}.` :
        `${techniqueSessions.length} sesiones elegibles en 90 días; requiere ≥3 con ≥400 m y ≥16 largos de crol del tamaño de piscina, tiempos válidos y strokes positivos. Sin datos no se estima a partir de promedios de sesión.`,
      description: 'Últimas cinco sesiones elegibles; compara largos de crol del mismo tamaño, aunque haya series, pausas y otros estilos entre ellos. Objetivo: ralentización ≤5% y pérdida de DPS ≤5%. Puntúa el peor deterioro (100% hasta 5%, 0% a 15%); SPL, LPM y SWOLF son apoyo sin duplicar puntos. Intensidad, calentamiento, virajes y descansos influyen: describe estabilidad de sesión, no fatiga en nado continuo.',
      milestones: [{ label: 'Ralentización ≤5%', done: paceStable },
        { label: 'Pérdida de DPS ≤5%', done: dpsStable }],
    },
  ].map(check => ({
    ...check,
    status: !check.available ? 'pending' : check.complete ? 'completed'
      : check.progress > 0 ? 'progress' : 'pending',
  }));
  const evidenceWeight = definitions.filter(check => check.available).reduce((sum, check) => sum + check.weight, 0);
  const score = hasHistory ? definitions.reduce((sum, check) => sum + check.weight * (check.progress ?? 0) / 100, 0) : null;
  return {
    score, evidenceWeight, completed: definitions.filter(check => check.status === 'completed').length,
    checks: definitions,
    technique: { samples: techniqueSessions.length, paceFade, dpsLoss, sessions: techniqueSessions },
  };
}

export function oceanmanReadinessHistory(activities, asOf = new Date(), lengths = []) {
  const rows = swimming(activities).filter(a => localDate(a.date) <= asOf);
  const dates = [...new Set(rows.map(a => dateKey(localDate(a.date))))].sort();
  if (!dates.length) return [];
  const latest = dateKey(asOf);
  if (dates.at(-1) !== latest) dates.push(latest);
  return dates.map(date => {
    const end = new Date(Math.min(localDate(`${date}T23:59:59.999`).getTime(), asOf.getTime()));
    const readiness = oceanmanReadiness(rows, end, lengths);
    return { date, score: readiness.score, evidenceWeight: readiness.evidenceWeight };
  });
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
