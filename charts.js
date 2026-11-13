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
    svg.append(dot);
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

export function weeklyChart(container, weeks) {
  const svg = chart(container, 'Weekly swim distance and trailing four-week mean. Weeks without sessions count as zero.', !weeks.length);
  if (!svg) return;
  const max = Math.max(1, ...weeks.map(w => w.km)) * 1.15;
  const { x, y } = axes(svg, -0.5, Math.max(0.5, weeks.length - 0.5), max, 'Week starting Monday', 'Distance (km)',
    value => weeks[Math.max(0, Math.min(weeks.length - 1, Math.round(value)))]?.date.slice(5) ?? '');
  const barWidth = Math.max(1, plotW / weeks.length * 0.7);
  for (const [index, week] of weeks.entries()) {
    const bar = element('rect', { x: x(index) - barWidth / 2, y: y(week.km), width: barWidth, height: y(0) - y(week.km), fill: colors.weekly, rx: 2 });
    tooltip(bar, `${week.date}${week.partial ? ' (current, incomplete week)' : ''}: ${number(week.km)} km; 4-week mean ${week.rolling == null ? 'not yet available' : number(week.rolling) + ' km'}`);
    svg.append(bar);
  }
  const points = weeks.map((week, index) => week.rolling == null ? null : `${x(index)},${y(week.rolling)}`).filter(Boolean);
  if (points.length) svg.append(element('polyline', { points: points.join(' '), fill: 'none', stroke: colors.rolling, 'stroke-width': 3 }));
  for (const [index, week] of weeks.entries()) {
    if (week.rolling == null) continue;
    const dot = element('circle', { cx: x(index), cy: y(week.rolling), r: 3, fill: colors.rolling });
    tooltip(dot, `${week.date}: trailing 4-week mean ${number(week.rolling)} km`);
    svg.append(dot);
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
    svg.append(dot);
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
    svg.append(line);
    for (const [point, label, fill] of [[route.points[0], 'Start', '#54dbcb'], [route.points.at(-1), 'Finish', '#f5bc72']]) {
      const [cx, cy] = position(point);
      const marker = element('circle', { cx, cy, r: 6, fill, stroke: '#0c1923', 'stroke-width': 2 });
      tooltip(marker, `${label} / ${route.activity.name}`);
      svg.append(marker);
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
