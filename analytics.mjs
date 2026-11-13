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

export function weeklyTrend(activities, now = new Date()) {
  const valid = activities.filter(a => !Number.isNaN(localDate(a.date).getTime()) && a.distance > 0);
  if (!valid.length) return [];
  const totals = new Map();
  for (const a of valid) {
    const key = dateKey(monday(localDate(a.date)));
    totals.set(key, (totals.get(key) ?? 0) + a.distance / 1000);
  }
  const first = monday(new Date(Math.min(...valid.map(a => localDate(a.date).getTime()))));
  const last = monday(new Date(Math.max(now.getTime(), ...valid.map(a => localDate(a.date).getTime()))));
  // A malformed historical date must not allocate an unbounded chart.
  if ((last - first) / 86400000 > 36525) throw new Error('Weekly history exceeds 100 years; review the source dates.');
  const weeks = [];
  for (const cursor = first; cursor <= last; cursor.setDate(cursor.getDate() + 7)) {
    const key = dateKey(cursor);
    const km = totals.get(key) ?? 0;
    weeks.push({ date: key, km, rolling: null, partial: key === dateKey(monday(now)) });
    if (weeks.length >= 4) weeks.at(-1).rolling = weeks.slice(-4).reduce((sum, w) => sum + w.km, 0) / 4;
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
const categories = [
  { key: '100m', distance: 100 }, { key: '200m', distance: 200 }, { key: '1000m', distance: 1000 },
  { key: '100m IM', distance: 100, medley: true }, { key: '200m IM', distance: 200, medley: true },
  { key: '400m IM', distance: 400, medley: true },
  ...['freestyle', 'breaststroke', 'backstroke', 'butterfly'].flatMap(stroke =>
    [50, 100, 200, 400].map(distance => ({ key: `${distance}m ${stroke}`, distance, stroke }))),
];

export function personalBests(activities, lengths, limit = 3) {
  const result = Object.fromEntries([...categories.map(c => [c.key, []]), ['Longest session', []], ['Fastest session', []]]);
  const byId = new Map();
  for (const length of lengths) {
    if (!byId.has(length.activityId)) byId.set(length.activityId, []);
    byId.get(length.activityId).push(length);
  }
  for (const activity of activities) {
    const entry = { id: activity.id, name: activity.name, date: activity.date, pace: activity.pace };
    if (activity.distance > 0) result['Longest session'].push({ ...entry, value: activity.distance });
    if (activity.distance >= 100 && activity.pace > 0) result['Fastest session'].push({ ...entry, value: activity.pace });
    if (activity.type !== 'pool') continue;
    const active = (byId.get(activity.id) ?? []).filter(l => l.active).sort((a, b) => a.sequence - b.sequence);
    for (const category of categories) {
      if (category.stroke && category.stroke !== 'freestyle' && !active.some(l => l.stroke === category.stroke)) continue;
      let best = null;
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
            if (time > 0 && (best == null || time < best)) best = time;
            break;
          }
        }
      }
      // One best effort per session avoids filling the podium with overlapping windows.
      if (best != null) result[category.key].push({ ...entry, value: best, pace: best * 100 / category.distance });
    }
  }
  for (const [key, entries] of Object.entries(result)) {
    entries.sort((a, b) => key === 'Longest session' ? b.value - a.value : a.value - b.value);
    result[key] = entries.slice(0, limit);
  }
  return result;
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
    .slice(0, limit).map(a => ({ id: a.id, name: a.name, date: a.date, value: value(a), type: a.type, pace: a.pace }));
}

export function trainingSummary(activities) {
  const summarize = rows => {
    const paced = rows.filter(a => a.distance > 0 && a.movingTime > 0);
    const measuredDistance = rows.filter(a => a.distance > 0);
    return {
      sessions: rows.length,
      distance: rows.reduce((sum, a) => sum + (a.distance > 0 ? a.distance : 0), 0),
      averageDistance: measuredDistance.length ? measuredDistance.reduce((sum, a) => sum + a.distance, 0) / measuredDistance.length : null,
      averagePace: divide(paced.reduce((sum, a) => sum + a.movingTime * 100, 0), paced.reduce((sum, a) => sum + a.distance, 0)),
      averageSwolf: mean(rows.map(a => a.swolf).filter(value => value > 0)),
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

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
