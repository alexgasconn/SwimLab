import { histogram, localDate, swolfTrend } from './analytics.mjs';

const ns = 'http://www.w3.org/2000/svg';
const colors = { pool: '#54dbcb', open_water: '#9eafff', weekly: '#327e91', rolling: '#f5bc72' };
const W = 640, H = 260;
let landPromise;
const margin = { left: 55, right: 18, top: 20, bottom: 45 };
const plotW = W - margin.left - margin.right, plotH = H - margin.top - margin.bottom;
export const paceLabel = value => {
  if (!Number.isFinite(value)) return '--';
  const seconds = Math.round(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const element = (name, attributes = {}, text) => {
  const result = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
  if (text != null) result.textContent = text;
  return result;
};
const number = value => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
function chart(container, label, empty) {
  container.replaceChildren();
  if (empty) {
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = 'No eligible data in this view.';
    container.append(message);
    return null;
  }
  const svg = element('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  svg.append(element('title', {}, label));
  container.append(svg);
  return svg;
}
function axes(svg, xMin, xMax, yMax, xLabel, yLabel, xFormat = number, yFormat = number, yMin = 0) {
  const x = value => margin.left + (value - xMin) / (xMax - xMin) * plotW;
  const y = value => H - margin.bottom - (value - yMin) / (yMax - yMin) * plotH;
  for (let i = 0; i <= 4; i++) {
    const value = yMin + (yMax - yMin) * i / 4;
    svg.append(element('line', { x1: margin.left, x2: W - margin.right, y1: y(value), y2: y(value), class: 'grid-line' }));
    svg.append(element('text', { x: margin.left - 10, y: y(value) + 4, 'text-anchor': 'end', class: 'axis-text' }, yFormat(value)));
    const xv = xMin + (xMax - xMin) * i / 4;
    svg.append(element('text', { x: x(xv), y: H - margin.bottom + 22, 'text-anchor': 'middle', class: 'axis-text' }, xFormat(xv)));
  }
  svg.append(element('text', { x: W / 2, y: H - 3, 'text-anchor': 'middle', class: 'axis-label' }, xLabel));
  svg.append(element('text', { x: margin.left, y: 12, class: 'axis-label' }, yLabel));
  return { x, y };
}
function tooltip(node, text) {
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-label', text);
  node.append(element('title', {}, text));
}

export const strokeColors = { freestyle: '#54dbcb', backstroke: '#74c8ee', breaststroke: '#9eafff', butterfly: '#f5bc72' };
export const strokeNames = { freestyle: 'Freestyle', backstroke: 'Backstroke', breaststroke: 'Breaststroke', butterfly: 'Butterfly' };

export function metricChart(container, rows, options) {
  const { xKey = 'index', yKey, xLabel = 'Active length', yLabel, format = number, xFormat = number,
    scatter = false, maxGap = Infinity, regression = null, color = colors.pool } = options;
  const valid = rows.filter(r => Number.isFinite(r[xKey]) && Number.isFinite(r[yKey]));
  const svg = chart(container, `${yLabel} versus ${xLabel}. ${valid.length} recorded values.`, !valid.length);
  if (!svg) return;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const r of valid) {
    xMin = Math.min(xMin, r[xKey]); xMax = Math.max(xMax, r[xKey]);
    yMin = Math.min(yMin, r[yKey]); yMax = Math.max(yMax, r[yKey]);
  }
  const xp = (xMax - xMin) * 0.04 || 0.5, yp = (yMax - yMin) * 0.12 || Math.max(1, Math.abs(yMin) * 0.05);
  const { x, y } = axes(svg, Math.max(0, xMin - xp), xMax + xp, yMax + yp, xLabel, yLabel, xFormat, format, yMin - yp);
  if (!scatter) {
    let points = [], previousX = null;
    const flush = () => {
      if (points.length > 1) svg.append(element('polyline', { points: points.join(' '), fill: 'none', stroke: color, 'stroke-width': 2 }));
      points = [];
    };
    for (const r of rows) {
      if (!Number.isFinite(r[xKey]) || !Number.isFinite(r[yKey])) { flush(); previousX = null; continue; }
      if (previousX != null && r[xKey] - previousX > maxGap) flush();
      points.push(`${x(r[xKey])},${y(r[yKey])}`);
      previousX = r[xKey];
    }
    flush();
  }
  if (regression?.slope != null) {
    const points = [xMin, xMax].map(v => `${x(v)},${y(regression.slope * v + regression.intercept)}`).join(' ');
    svg.append(element('polyline', { points, fill: 'none', stroke: colors.rolling, 'stroke-width': 2, 'stroke-dasharray': '6 5' }));
  }
  const stride = scatter ? 1 : Math.max(1, Math.ceil(valid.length / 250));
  for (let i = 0; i < valid.length; i += stride) {
    const r = valid[i];
    const dot = element('circle', { cx: x(r[xKey]), cy: y(r[yKey]), r: scatter ? 4 : 3,
      fill: strokeColors[r.stroke] ?? color, class: 'data-point' });
    tooltip(dot, `${xLabel}: ${xFormat(r[xKey])} · ${yLabel}: ${format(r[yKey])}${r.index ? ` · length ${r.index}` : ''}`);
    svg.append(dot);
  }
}

export function recordPaceChart(container, rows) {
  const valid = rows.map((row, index) => ({ ...row, index })).filter(row => Number.isFinite(row.entry?.pace));
  const svg = chart(container, 'Pace of the fastest-time personal best at each target distance. Distances are equally spaced. Lower is faster.', !valid.length);
  if (!svg) {
    const distances = document.createElement('p');
    distances.className = 'hint';
    distances.textContent = `Target distances (m): ${rows.map(row => row.distance).join(', ')}`;
    container.append(distances);
    return;
  }
  const values = valid.map(row => row.entry.pace);
  const min = Math.min(...values), max = Math.max(...values);
  const yPadding = (max - min) * 0.12 || Math.max(1, min * 0.05);
  const { x, y } = axes(svg, -0.5, Math.max(0.5, rows.length - 0.5), max + yPadding,
    'Target distance (m)', 'Pace /100 m', () => '', paceLabel, Math.max(0, min - yPadding));
  for (const [index, row] of rows.entries()) {
    svg.append(element('text', { x: x(index), y: H - margin.bottom + 22, 'text-anchor': 'middle', class: 'axis-text' }, String(row.distance)));
  }
  if (valid.length > 1) svg.append(element('polyline', {
    points: valid.map(row => `${x(row.index)},${y(row.entry.pace)}`).join(' '),
    fill: 'none', stroke: colors.pool, 'stroke-width': 2,
  }));
  for (const { distance, entry, index } of valid) {
    const dot = element('circle', { cx: x(index), cy: y(entry.pace), r: 5, fill: colors.pool, class: 'data-point' });
    tooltip(dot, `${distance} m · ${paceLabel(entry.pace)}/100 m · ${entry.date?.slice(0, 10)}${entry.distance ? ` · actual ${number(entry.distance)} m` : ''}`);
    const link = element('a', { href: `#activity=${encodeURIComponent(entry.id)}`, 'aria-label': `Analyze ${entry.name}` });
    link.append(dot);
    svg.append(link);
  }
}

export function recordHistoryChart(container, rows, label, period) {
  const svg = chart(container, `${label}: best time per period, cumulative personal best and a smoothed trend within the current filters.`, !rows.length);
  if (!svg) return;
  const dates = rows.map(row => localDate(`${row.date}T00:00:00`).getTime());
  const values = rows.flatMap(row => [row.entry.value, row.best.value]);
  const min = Math.min(...values), max = Math.max(...values);
  const padding = (max - min) * 0.12 || Math.max(1, min * 0.05);
  const xPadding = dates.length === 1 ? 86400000 * 7 : 0;
  const durationLabel = value => {
    const seconds = Math.round(value);
    return seconds >= 3600
      ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
      : paceLabel(seconds);
  };
  const { x, y } = axes(svg, dates[0] - xPadding, dates.at(-1) + xPadding, max + padding,
    'Period start', 'Time', value => new Date(value).toLocaleDateString('en',
      period === 'week' ? { day: 'numeric', month: 'short', year: '2-digit' } : { month: 'short', year: '2-digit' }),
    durationLabel, Math.max(0, min - padding));
  let step = '';
  for (const [index, row] of rows.entries()) {
    const px = x(dates[index]), py = y(row.best.value);
    step += index ? `H${px} V${py} ` : `M${px},${py} `;
  }
  svg.append(element('path', { d: step, fill: 'none', stroke: colors.rolling, 'stroke-width': 2.5 }));
  if (rows.length >= 2) {
    const points = rows.map((row, index) => {
      const recent = rows.slice(Math.max(0, index - 2), index + 1);
      return { x: x(dates[index]), y: y(recent.reduce((sum, item) => sum + item.entry.value, 0) / recent.length) };
    });
    let path = `M${points[0].x},${points[0].y} `;
    for (let i = 1; i < points.length - 1; i++) {
      const current = points[i], next = points[i + 1];
      path += `Q${current.x},${current.y} ${(current.x + next.x) / 2},${(current.y + next.y) / 2} `;
    }
    const last = points.at(-1);
    path += `Q${last.x},${last.y} ${last.x},${last.y}`;
    const trend = element('path', { d: path, fill: 'none', class: 'record-history-trend',
      'stroke-width': 2, 'stroke-dasharray': '6 5' });
    trend.append(element('title', {}, 'Trend: mean of up to the last three periods with an effort'));
    svg.append(trend);
  }
  for (const [index, row] of rows.entries()) {
    for (const [entry, color, kind, radius] of [
      [row.best, colors.rolling, 'Best so far', 6],
      [row.entry, colors.pool, 'Period best', 4],
    ]) {
      const dot = element('circle', { cx: x(dates[index]), cy: y(entry.value), r: radius, fill: color, class: 'data-point' });
      tooltip(dot, `${row.date} · ${kind}: ${durationLabel(entry.value)} · ${entry.date?.slice(0, 10)}${entry.distance ? ` · actual ${number(entry.distance)} m` : ''}`);
      const link = element('a', { href: `#activity=${encodeURIComponent(entry.id)}`, 'aria-label': `Analyze ${entry.name}: ${kind}` });
      link.append(dot);
      svg.append(link);
    }
  }
}

export function lengthRibbon(container, rows, origin) {
  const timed = rows.filter(r => Number.isFinite(r.start) && r.end != null);
  const svg = chart(container, 'Recorded length timeline: active lengths by stroke above, recorded rest below. Blank intervals have no length record.', !timed.length);
  if (!svg) return;
  const end = timed.reduce((max, r) => Math.max(max, r.end), origin + 1);
  const { x } = axes(svg, 0, (end - origin) / 60, 1, 'Minutes since first FIT timestamp', '', number, () => '');
  svg.append(element('text', { x: margin.left, y: 40, class: 'axis-label' }, 'SWIM'));
  svg.append(element('text', { x: margin.left, y: 140, class: 'axis-label' }, 'RECORDED REST'));
  for (const row of timed) {
    const rect = element('rect', { x: x((row.start - origin) / 60), y: row.active ? 52 : 152,
      width: Math.max(0.5, x((row.end - origin) / 60) - x((row.start - origin) / 60)), height: row.active ? 65 : 25,
      fill: row.active ? strokeColors[row.stroke] ?? '#78879a' : '#516072', rx: 2, class: 'length-segment' });
    tooltip(rect, `${row.active ? `Length ${row.index} · ${strokeNames[row.stroke] ?? 'Unclassified'}` : 'Recorded rest'} · ${number(row.duration)} s${row.pace ? ` · ${paceLabel(row.pace)}/100 m · ${number(row.distance)} m` : ''}`);
    svg.append(rect);
  }
}

export function scatterplot(container, activities) {
  const rows = activities.filter(a => a.distance > 0 && a.pace > 0);
  const svg = chart(container, 'Moving pace versus session distance. Teal: pool. Violet: open water. Lower pace is faster.', !rows.length);
  if (!svg) return;
  const min = Math.max(0, Math.min(...rows.map(a => a.pace)) * 0.85);
  const max = Math.max(...rows.map(a => a.pace)) * 1.1;
  const { x, y } = axes(svg, 0, Math.max(...rows.map(a => a.distance / 1000)) * 1.1, max,
    'Distance (km)', 'Moving pace /100 m', number, paceLabel, min);
  for (const a of rows) {
    const dot = element('circle', { cx: x(a.distance / 1000), cy: y(a.pace), r: 5, fill: colors[a.type], opacity: 0.8, class: 'data-point' });
    tooltip(dot, `${a.date?.slice(0, 10)} / ${a.name}: ${number(a.distance)} m, ${paceLabel(a.pace)}/100 m`);
    const link = element('a', { href: `#activity=${encodeURIComponent(a.id)}`, 'aria-label': `Analyze ${a.name}` });
    link.append(dot);
    svg.append(link);
  }
}

export function distribution(container, values, isPace) {
  const bins = histogram(values);
  const svg = chart(container, isPace ? 'Distribution of session moving pace' : 'Distribution of session distance', !bins.length);
  if (!svg) return;
  const format = isPace ? paceLabel : number;
  const ymax = Math.max(4, Math.ceil(Math.max(...bins.map(b => b.count)) / 4) * 4);
  const { x, y } = axes(svg, bins[0].from, bins.at(-1).to, ymax,
    isPace ? 'Moving pace (min:sec /100 m)' : 'Distance (km)', 'Sessions', format);
  for (const bin of bins) {
    const bar = element('rect', {
      x: x(bin.from) + 2, y: y(bin.count), width: Math.max(1, x(bin.to) - x(bin.from) - 4),
      height: y(0) - y(bin.count), rx: 4, fill: isPace ? colors.open_water : colors.pool,
    });
    tooltip(bar, `${format(bin.from)} - ${format(bin.to)}: ${bin.count} sessions`);
    svg.append(bar);
  }
}

export function weeklyChart(container, weeks, label, { distance = false, format = number } = {}) {
  const values = weeks.flatMap(w => [w.value, w.rolling]).filter(v => v != null);
  const svg = chart(container, `Weekly ${label} and trailing four-week mean`, !values.length);
  if (!svg) return;
  const max = Math.max(...values);
  const min = distance ? 0 : Math.min(...values);
  const padding = (max - min || max || 1) * 0.15;
  const { x, y } = axes(svg, -0.5, Math.max(0.5, weeks.length - 0.5), max + padding, 'Week starting Monday', label,
    value => weeks[Math.max(0, Math.min(weeks.length - 1, Math.round(value)))]?.date.slice(5) ?? '',
    format, distance ? 0 : Math.max(0, min - padding));
  const barWidth = Math.max(1, plotW / weeks.length * 0.7);
  for (const [key, color] of [['value', colors.weekly], ['rolling', colors.rolling]]) {
    let path = '', connected = false;
    for (const [index, week] of weeks.entries()) {
      const value = week[key];
      if (value == null) { connected = false; continue; }
      path += `${connected ? 'L' : 'M'}${x(index)},${y(value)} `;
      connected = true;
    }
    if (path && !(key === 'value' && distance)) {
      svg.append(element('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2.5 }));
    }
    for (const [index, week] of weeks.entries()) {
      const value = week[key];
      if (value == null) continue;
      const mark = key === 'value' && distance
        ? element('rect', { x: x(index) - barWidth / 2, y: Math.min(y(value), y(0) - 1),
          width: barWidth, height: Math.max(1, y(0) - y(value)), fill: color, rx: 2 })
        : element('circle', { cx: x(index), cy: y(value), r: key === 'value' ? 4 : 3, fill: color });
      tooltip(mark, `${week.date}${week.partial ? ' (current, incomplete week)' : ''}: ${key === 'value' ? 'weekly' : '4-week mean'} ${format(value)} — ${label}`);
      svg.append(mark);
    }
  }
}

export function swolfChart(container, activities) {
  const rows = swolfTrend(activities);
  const svg = chart(container, 'Average SWOLF by swim session over time', !rows.length);
  if (!svg) return;
  const dates = rows.map(a => localDate(a.date).getTime());
  const values = rows.map(a => a.swolf);
  const xMin = Math.min(...dates), xMax = Math.max(...dates);
  const yMin = Math.max(0, Math.min(...values) - 5), yMax = Math.max(...values) + 5;
  const { x, y } = axes(svg, xMin - (xMax === xMin ? 86400000 : 0), xMax + (xMax === xMin ? 86400000 : 0),
    yMax, 'Session date', 'Average SWOLF', value => new Date(value).toLocaleDateString('en', { month: 'short', year: '2-digit' }), number, yMin);
  const points = rows.map((a, index) => `${x(dates[index])},${y(a.swolf)}`);
  if (points.length > 1) svg.append(element('polyline', { points: points.join(' '), fill: 'none', stroke: colors.open_water, 'stroke-width': 2, opacity: 0.8 }));
  for (const [index, a] of rows.entries()) {
    const dot = element('circle', { cx: x(dates[index]), cy: y(a.swolf), r: 4, fill: colors.open_water });
    tooltip(dot, `${a.date?.slice(0, 10)} / ${a.name}: SWOLF ${number(a.swolf)}`);
    const link = element('a', { href: `#activity=${encodeURIComponent(a.id)}`, 'aria-label': `Analyze ${a.name}` });
    link.append(dot);
    svg.append(link);
  }
}

function loadLand() {
  if (!landPromise) {
    landPromise = fetch('/land-10m.json').then(response => {
      if (!response.ok) throw new Error(`Offline map HTTP ${response.status}`);
      return response.json();
    }).then(topology => {
      if (!globalThis.topojson) throw new Error('Offline map decoder is unavailable.');
      return globalThis.topojson.feature(topology, topology.objects.land).features[0].geometry.coordinates;
    }).catch(error => {
      landPromise = null;
      throw error;
    });
  }
  return landPromise;
}

function clipRing(points, width, height) {
  let result = points;
  for (const [axis, limit, keepAbove] of [[0, 0, true], [0, width, false], [1, 0, true], [1, height, false]]) {
    if (!result.length) break;
    const clipped = [];
    let previous = result.at(-1);
    let previousInside = keepAbove ? previous[axis] >= limit : previous[axis] <= limit;
    for (const current of result) {
      const currentInside = keepAbove ? current[axis] >= limit : current[axis] <= limit;
      if (currentInside !== previousInside) {
        const ratio = (limit - previous[axis]) / (current[axis] - previous[axis]);
        clipped.push([previous[0] + ratio * (current[0] - previous[0]), previous[1] + ratio * (current[1] - previous[1])]);
      }
      if (currentInside) clipped.push(current);
      previous = current;
      previousInside = currentInside;
    }
    result = clipped;
  }
  return result;
}

export function routeMap(container, activities, routePoints) {
  const activityById = new Map(activities.filter(a => a.type === 'open_water').map(a => [a.id, a]));
  const byId = new Map();
  for (const point of routePoints) {
    if (!activityById.has(point.activityId) || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    if (!byId.has(point.activityId)) byId.set(point.activityId, []);
    byId.get(point.activityId).push(point);
  }
  const routes = [...byId.entries()].map(([id, points]) => ({
    activity: activityById.get(id), points: points.sort((a, b) => a.sequence - b.sequence),
  })).filter(route => route.points.length > 1);
  const svg = chart(container, 'Open-water GPS routes on an approximate offline Natural Earth map.', !routes.length);
  if (!svg) return;
  const W = 800, H = 420, pad = 32;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const all = routes.flatMap(route => route.points);
  const latitude = all.reduce((sum, point) => sum + point.lat, 0) / all.length;
  const origin = all[0].lon;
  const longitude = lon => ((lon - origin + 540) % 360 - 180) * Math.max(0.001, Math.cos(latitude * Math.PI / 180));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of all) {
    const px = longitude(point.lon);
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, point.lat); maxY = Math.max(maxY, point.lat);
  }
  if (maxX === minX) { minX -= 0.0001; maxX += 0.0001; }
  if (maxY === minY) { minY -= 0.0001; maxY += 0.0001; }
  const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
  const xOffset = (W - (maxX - minX) * scale) / 2;
  const yOffset = (H - (maxY - minY) * scale) / 2;
  svg.append(element('rect', { x: 1, y: 1, width: W - 2, height: H - 2, rx: 8, fill: '#0c1923', stroke: '#253641' }));
  const landLayer = element('g', { fill: '#294c4d', stroke: '#548277', 'stroke-width': 1, 'fill-rule': 'evenodd' });
  svg.append(landLayer);
  loadLand().then(polygons => {
    if (!svg.isConnected) return;
    for (const polygon of polygons) {
      const paths = [];
      for (const ring of polygon) {
        let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
        const points = ring.map(([lon, lat]) => {
          const x = xOffset + (longitude(lon) - minX) * scale;
          const y = H - yOffset - (lat - minY) * scale;
          west = Math.min(west, x); east = Math.max(east, x);
          south = Math.min(south, y); north = Math.max(north, y);
          return [x, y];
        });
        if (east < 0 || west > W || north < 0 || south > H) continue;
        const clipped = clipRing(points, W, H);
        if (clipped.length >= 3) paths.push(`M${clipped.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`);
      }
      if (paths.length) landLayer.append(element('path', { d: paths.join('') }));
    }
  }).catch(() => {
    if (!svg.isConnected) return;
    const warning = document.createElement('p');
    warning.className = 'warning';
    warning.textContent = 'Could not load the offline basemap. The GPS route is shown without geographic context; check that map assets are installed and restart the server.';
    container.append(warning);
  });
  for (let index = 1; index < 4; index++) {
    svg.append(element('line', { x1: pad + index * (W - pad * 2) / 4, x2: pad + index * (W - pad * 2) / 4, y1: pad, y2: H - pad, class: 'grid-line' }));
    svg.append(element('line', { x1: pad, x2: W - pad, y1: pad + index * (H - pad * 2) / 4, y2: pad + index * (H - pad * 2) / 4, class: 'grid-line' }));
  }
  const palette = ['#54dbcb', '#9eafff', '#f5bc72', '#ff8b88', '#8ad3ff', '#d2a4ff'];
  for (const [index, route] of routes.entries()) {
    const position = point => [xOffset + (longitude(point.lon) - minX) * scale, H - yOffset - (point.lat - minY) * scale];
    const points = route.points.map(point => position(point).join(','));
    const line = element('polyline', { points: points.join(' '), fill: 'none', stroke: palette[index % palette.length],
      'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.9 });
    tooltip(line, `${route.activity.date?.slice(0, 10)} / ${route.activity.name}: ${route.activity.distance > 0 ? number(route.activity.distance / 1000) + ' km' : 'distance unavailable'}`);
    const link = element('a', { href: `#activity=${encodeURIComponent(route.activity.id)}`, 'aria-label': `Analyze ${route.activity.name}` });
    link.append(line);
    svg.append(link);
    for (const [point, label, fill] of [[route.points[0], 'Start', '#54dbcb'], [route.points.at(-1), 'Finish', '#f5bc72']]) {
      const [cx, cy] = position(point);
      const marker = element('circle', { cx, cy, r: 6, fill, stroke: '#0c1923', 'stroke-width': 2 });
      tooltip(marker, `${label} / ${route.activity.name}`);
      link.append(marker);
    }
  }
  svg.append(element('text', { x: 24, y: 25, class: 'axis-text' }, 'N'));
  svg.append(element('text', { x: W - 24, y: H - 15, 'text-anchor': 'end', class: 'axis-text' }, 'START / FINISH'));
}

export function heatmap(container, cells) {
  container.replaceChildren();
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const max = Math.max(1, ...cells.flat());
  const svg = element('svg', { viewBox: '0 0 780 250', role: 'img', 'aria-label': 'Session starts by local weekday and hour; brighter cells mean more sessions.' });
  svg.append(element('title', {}, 'Session starts by local weekday and hour'));
  days.forEach((day, row) => {
    svg.append(element('text', { x: 38, y: 40 + row * 28, 'text-anchor': 'end', class: 'axis-text' }, day));
    cells[row].forEach((count, hour) => {
      const cell = element('rect', { x: 50 + hour * 30, y: 24 + row * 28, width: 25, height: 22, rx: 4,
        fill: count ? '#54dbcb' : '#1c303e', 'fill-opacity': count ? 0.2 + 0.8 * count / max : 1 });
      tooltip(cell, `${day} ${String(hour).padStart(2, '0')}:00 - ${hour + 1}:00: ${count} session starts`);
      svg.append(cell);
    });
  });
  for (let hour = 0; hour < 24; hour++) svg.append(element('text', { x: 62 + hour * 30, y: 238, 'text-anchor': 'middle', class: 'axis-text' }, String(hour).padStart(2, '0')));
  container.append(svg);
}
