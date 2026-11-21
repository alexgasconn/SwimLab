import { annotateOutliers, deriveMetrics, divide, localDate, dateKey, weeklyTrend, weeklyMetrics, trainingHeatmap, personalBests, recordDistanceGroups, openWaterRecordDistances, trainingSummary, strokeMix, sortSessions, filterLogbook, oceanmanPlanRows, oceanmanRollingVolumes, oceanmanReadiness, oceanmanReadinessHistory } from './analytics.mjs';
import { scatterplot, distribution, weeklyChart, heatmap, paceLabel, swolfChart, routeMap } from './charts.js';
import { renderActivity } from './activity.js';

const $ = id => document.getElementById(id);
const cloud = document.documentElement.dataset.storage === 'cloud';
let dataset = { activities: [], lengths: [], routePoints: [], history: null };
let demo = false;
let running = false;
let visible = [];
let logbookRows = [];
let currentPoll = null;
let tableSort = null;
let recordGroup = 'freestyle';
let checkFilter = 'all';
let trendPeriod = 'day';
let readinessChecks = [];
let readinessHistory = [];
let activityRequest = 0;
let activityOpenedFromDashboard = false;
let activityReturnFocus = null;
const format = (value, digits = 1) => value == null || !Number.isFinite(value) ? '--' : new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(value);
const oceanmanFormat = (value, digits = 1) => value == null || !Number.isFinite(value) ? '--' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }).format(value);
const percent = value => value == null ? '--' : `${format(value, 1)}%`;
const time = value => {
  if (value == null) return '--';
  const total = Math.round(value);
  return `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const columns = [
  ['ID', a => a.id], ['Local date', a => a.date?.replace('T', ' ') ?? '--'],
  ['Activity', a => a.name], ['Weekday', a => localDate(a.date).toLocaleDateString('en', { weekday: 'short' })],
  ['Environment', a => a.type === 'pool' ? 'Pool' : 'Open water'], ['Pool (m)', a => format(a.poolLength, 2)],
  ['Distance (m)', a => format(a.distance, 2)], ['Moving', a => time(a.movingTime)],
  ['Elapsed', a => time(a.elapsedTime)], ['Timer', a => time(a.timerTime)],
  ['Moving %', a => percent(a.movingRatio == null ? null : a.movingRatio * 100)],
  ['Pace /100 m', a => paceLabel(a.pace)], ['HR avg', a => format(a.heartRate, 0)],
  ['Lengths', a => format(a.lengths, 0)], ['Strokes', a => format(a.strokes, 0)],
  ['SPM', a => format(a.spm)], ['SPL', a => format(a.spl)],
  ['DPS (m)', a => format(a.dps, 3)], ['TPL (s)', a => format(a.tpl, 2)],
  ['LPM', a => format(a.lpm, 2)], ['SWOLF', a => format(a.swolf)],
  ['Temp (C)', a => format(a.temperature)], ['Min temp (C)', a => format(a.minTemperature)],
  ['Max temp (C)', a => format(a.maxTemperature)],
  ['Free %', a => percent(a.freestylePct)], ['Breast %', a => percent(a.breaststrokePct)],
  ['Back %', a => percent(a.backstrokePct)], ['Fly %', a => percent(a.butterflyPct)],
  ['FIT', a => a.fitStatus ?? 'pending'], ['Excluded', a => a.excluded ? 'Yes' : 'No'],
  ['Quality flags', a => a.reasons.join('; ')], ['Review', a => a.review ?? 'Automatic'],
];
const sortFields = [
  a => a.id, a => localDate(a.date).getTime(), a => a.name, a => (localDate(a.date).getDay() + 6) % 7,
  a => a.type, a => a.poolLength, a => a.distance, a => a.movingTime, a => a.elapsedTime, a => a.timerTime,
  a => a.movingRatio, a => a.pace, a => a.heartRate, a => a.lengths, a => a.strokes,
  a => a.spm, a => a.spl, a => a.dps, a => a.tpl, a => a.lpm, a => a.swolf,
  a => a.temperature, a => a.minTemperature, a => a.maxTemperature,
  a => a.freestylePct, a => a.breaststrokePct, a => a.backstrokePct, a => a.butterflyPct,
  a => a.fitStatus ?? 'pending', a => a.excluded ? 'Yes' : 'No', a => a.reasons.join('; '), a => a.review ?? 'Automatic',
];
const strokeLabels = { freestyle: 'Freestyle', breaststroke: 'Breaststroke', backstroke: 'Backstroke', butterfly: 'Butterfly' };
function status(message, error = false) {
  $('status').textContent = message;
  $('status').className = error ? 'error' : '';
}
async function api(path, body) {
  const timeout = cloud ? 110000 : 20000;
  const response = await fetch(path, body === undefined ? { signal: AbortSignal.timeout(timeout) } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (HTTP ${response.status}).`);
  return data;
}
function setRunning(value) {
  running = value;
  for (const id of ['submit', 'demo', 'cached']) $(id).disabled = value;
  $('progress').hidden = !value;
}
function range() {
  const now = new Date();
  let from = null, to = now;
  if ($('period').value === 'custom') {
    from = $('from').value ? localDate(`${$('from').value}T00:00:00`) : null;
    to = $('to').value ? localDate(`${$('to').value}T23:59:59.999`) : now;
  } else if ($('period').value !== 'all') {
    from = new Date(now);
    from.setDate(from.getDate() - Number($('period').value) + 1);
    from.setHours(0, 0, 0, 0);
  }
  if (from && from > to) throw new Error('The start date must not be after the end date.');
  return { from, to };
}
function inRange(a, from, to) {
  const date = localDate(a.date);
  if (Number.isNaN(date.getTime())) return $('period').value === 'all';
  return (!from || date >= from) && date <= to;
}
function render() {
  const { from, to } = range();
  const annotated = annotateOutliers(dataset.activities);
  const environment = $('environment').value;
  const scope = annotated.filter(a => environment === 'all' || a.type === environment);
  const dated = scope.filter(a => inRange(a, from, to));
  const include = $('outliers').checked;
  visible = dated.filter(a => include || !a.excluded);
  const distanceRows = visible.filter(a => a.distance > 0);
  const timed = visible.filter(a => a.distance > 0 && a.movingTime > 0);
  const totalDistance = distanceRows.reduce((s, a) => s + a.distance, 0);
  const moving = visible.reduce((s, a) => s + (a.movingTime ?? 0), 0);
  const elapsed = visible.reduce((s, a) => s + (a.elapsedTime ?? 0), 0);
  $('source').textContent = demo ? 'DEMO / SYNTHETIC DATA' : dataset.activities.length ? cloud ? 'CLOUD POSTGRES / GARMIN' : 'LOCAL SQLITE / GARMIN' : 'NO DATA';
  $('source').className = `badge${demo ? ' demo' : ''}`;
  $('distance').textContent = format(totalDistance / 1000, 2);
  const pool = visible.filter(a => a.type === 'pool').reduce((s, a) => s + (a.distance ?? 0), 0);
  $('distance-note').textContent = `${format(pool / 1000)} km pool / ${format((totalDistance - pool) / 1000)} km open water`;
  $('duration').textContent = `${Math.floor(moving / 3600)}h ${Math.floor(moving % 3600 / 60)}m`;
  $('moving-note').textContent = `${time(elapsed)} elapsed / ${percent(divide(moving * 100, elapsed))} moving`;
  $('pace').textContent = paceLabel(divide(timed.reduce((s, a) => s + a.movingTime * 100, 0), timed.reduce((s, a) => s + a.distance, 0)));
  $('count').textContent = visible.length;
  $('count-note').textContent = `${dated.filter(a => a.excluded).length} flagged or manually excluded${include ? ' (included in this view)' : ' hidden'}`;
  const complete = dataset.activities.filter(a => a.fitStatus === 'complete').length;
  const history = dataset.history;
  $('coverage').textContent = demo ? 'Synthetic demo only. No demo data is written to storage.'
    : `${dataset.activities.length} saved swims / ${complete} FIT imports / ${dataset.lengths.filter(l => l.active).length} active pool lengths. ${history ? `Last history sync: ${new Date(history.syncedAt).toLocaleString('en')}. ${history.truncated ? 'Scan capped at 5,000 activities; older history may be missing.' : `${history.scanned} activities scanned across all sports.`}` : 'Connect Garmin to build your database.'}`;
  scatterplot($('scatter'), visible);
  distribution($('distance-hist'), visible.map(a => a.distance == null ? null : a.distance / 1000), false);
  distribution($('pace-hist'), visible.map(a => a.pace), true);
  renderWeekly(scope.filter(a => (include || !a.excluded) && localDate(a.date) <= to), from, to);
  heatmap($('heatmap'), trainingHeatmap(visible));
  swolfChart($('swolf-chart'), visible);
  renderSummary(trainingSummary(visible), annotated.filter(a => a.type === 'open_water').length);
  renderStrokeMix(strokeMix(visible, dataset.lengths));
  renderRoutes();
  const limit = Number($('record-limit').value);
  renderRecords(personalBests(visible, dataset.lengths, limit));
  renderPoolOptions();
  applyLogbookFilters();
  renderQuality(dated);
  renderWarnings();
  renderOceanman(annotated.filter(a => include || !a.excluded));
}
function renderWeekly(scope, from, to) {
  const metric = $('weekly-metric').value;
  const distance = metric === 'distance';
  const firstMonday = from ? new Date(from) : null;
  if (firstMonday) firstMonday.setDate(firstMonday.getDate() - (firstMonday.getDay() + 6) % 7);
  const first = firstMonday ? dateKey(firstMonday) : null;
  const weeks = weeklyTrend(scope, new Date(), metric)
    .filter(w => (!first || w.date >= first) && w.date <= dateKey(to));
  $('weekly-method').textContent = distance ? 'Weekly total; weeks without swims count as zero.'
    : `${metric === 'pace' ? 'Pool and open-water' : 'Pool-only'} session averages; weeks without measurements are skipped.${metric === 'efficiency' ? ' Swim index = moving speed (m/s) × distance per stroke (m/stroke).' : ''}`;
  weeklyChart($('weekly'), weeks, weeklyMetrics[metric].label, { distance, format: metric === 'pace' ? paceLabel : undefined });
}
$('weekly-metric').addEventListener('change', safeRender);

function renderStrokeMix(mix) {
  $('stroke-coverage').textContent = mix.total
    ? `${format(mix.total / 1000, 2)} km of recorded active lengths across ${mix.sessions} of ${mix.poolSessions} pool sessions. Unclassified lengths remain in the denominator; open water and sessions without lengths are not included.`
    : 'No recorded pool lengths in this view. Open water and sessions without lengths are not included.';
  const known = mix.strokes.filter(item => Object.hasOwn(strokeLabels, item.stroke));
  $('stroke-bar').replaceChildren();
  $('stroke-bar').setAttribute('aria-label', mix.total ? known.map(item => `${strokeLabels[item.stroke]} ${percent(item.percentage)}`).join(', ') : 'No stroke data available');
  $('stroke-mix').replaceChildren();
  for (const item of known) {
    if (item.percentage > 0) {
      const segment = document.createElement('span');
      segment.className = `stroke-segment stroke-${item.stroke}`;
      segment.style.width = `${item.percentage}%`;
      $('stroke-bar').append(segment);
    }
    const card = document.createElement('div');
    card.className = `stroke-item stroke-${item.stroke}`;
    const title = document.createElement('span');
    title.textContent = strokeLabels[item.stroke];
    const value = document.createElement('strong');
    value.textContent = percent(item.percentage);
    const distance = document.createElement('small');
    distance.textContent = mix.total ? `${format(item.distance, 0)} m` : '--';
    card.append(title, value, distance);
    $('stroke-mix').append(card);
  }
}
function renderRoutes() {
  const counts = new Map();
  for (const point of dataset.routePoints ?? []) {
    if (Number.isFinite(point.lat) && Number.isFinite(point.lon)) counts.set(point.activityId, (counts.get(point.activityId) ?? 0) + 1);
  }
  const routes = visible.filter(a => a.type === 'open_water' && counts.get(a.id) >= 2)
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  $('route-count').textContent = `${routes.length} recorded routes in this view. Hover or focus a route for session details.`;
  routeMap($('route-map'), routes, dataset.routePoints ?? []);
}
function renderSummary(summary, savedOpenWater) {
  const container = $('environment-summary');
  container.replaceChildren();
  const cards = [
    { title: 'Pool', ...summary.pool },
    { title: 'Open water', ...summary.openWater },
    ...summary.poolLengths.map(row => ({ title: row.length == null ? 'Pool length unknown' : `${format(row.length, 2)} m pool`, ...row })),
  ];
  for (const cardData of cards) {
    const card = document.createElement('article');
    card.className = 'summary-card';
    const heading = document.createElement('h3');
    heading.textContent = cardData.title;
    const count = document.createElement('strong');
    count.textContent = `${cardData.sessions} sessions`;
    const share = document.createElement('small');
    share.textContent = `${percent(divide(cardData.sessions * 100, summary.totalSessions))} of filtered sessions`;
    const stats = document.createElement('dl');
    stats.className = 'environment-metrics';
    const metrics = [
      ['Total distance', `${format(cardData.distance / 1000, 2)} km`],
      ['Avg distance', `${format(cardData.averageDistance, 0)} m`],
      ['Avg pace', `${paceLabel(cardData.averagePace)} /100 m`],
      ['Avg moving time', time(cardData.averageMovingTime)],
      ['Avg HR', `${format(cardData.averageHeartRate, 0)} bpm`],
      ['Avg SPM', format(cardData.averageSpm, 1)],
      ['Avg DPS', `${format(cardData.averageDps, 2)} m/stroke`],
      ['Avg efficiency', format(cardData.averageEfficiency, 2)],
    ];
    if (cardData.title !== 'Open water') metrics.push(
      ['Avg SWOLF', format(cardData.averageSwolf, 1)],
      ['Avg SPL', format(cardData.averageSpl, 1)],
      ['Avg TPL', `${format(cardData.averageTpl, 1)} s`],
      ['Avg LPM', format(cardData.averageLpm, 1)],
    );
    for (const [label, value] of metrics) {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      const definition = document.createElement('dd');
      term.textContent = label;
      definition.textContent = value;
      item.append(term, definition);
      stats.append(item);
    }
    card.append(heading, count, share, stats);
    if (cardData.title === 'Open water' && !cardData.sessions) {
      const note = document.createElement('p');
      note.textContent = savedOpenWater
        ? `${savedOpenWater} open-water sessions saved, but none match the current filters. Check timeframe, environment and excluded sessions.`
        : 'No open-water sessions are saved. Sync Garmin to retrieve your swimming history.';
      card.append(note);
    }
    container.append(card);
  }
  if (!cards.length) container.textContent = 'No sessions match these filters.';
}
function renderOceanman(activities) {
  const now = new Date();
  const readiness = oceanmanReadiness(activities, now, dataset.lengths);
  readinessChecks = readiness.checks;
  readinessHistory = oceanmanReadinessHistory(activities, now, dataset.lengths);
  const percentValue = value => value == null ? '--' : `${oceanmanFormat(value, 1)}%`;
  $('readiness-score').textContent = percentValue(readiness.score);
  $('readiness-passed').textContent = `${readiness.completed} de 6 checks superados`;
  $('readiness-coverage').textContent = `Cobertura: ${readiness.evidenceWeight}% del índice con datos evaluables`;

  const rolling = $('rolling-windows');
  rolling.replaceChildren();
  for (const window of oceanmanRollingVolumes(activities, now)) {
    const card = document.createElement('article');
    card.className = 'rolling-card';
    const header = document.createElement('header');
    const heading = document.createElement('h3');
    heading.textContent = `Últimos ${window.days} días`;
    const target = document.createElement('span');
    target.textContent = `Meta ${oceanmanFormat(window.targetKm, 0)} km`;
    header.append(heading, target);
    const total = document.createElement('strong');
    total.textContent = oceanmanFormat(window.actualKm, 1);
    const unit = document.createElement('small');
    unit.textContent = ' km';
    total.append(unit);
    const track = document.createElement('div');
    track.className = 'progress-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', `Progreso últimos ${window.days} días`);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(window.progress)));
    const fill = document.createElement('span');
    fill.style.width = `${window.progress}%`;
    track.append(fill);
    const caption = document.createElement('p');
    caption.textContent = window.label;
    card.append(header, total, track, caption);
    rolling.append(card);
  }
  renderReadinessChecks(readinessChecks);
  renderReadinessTrend(readinessHistory);
  renderOceanmanPlan(oceanmanPlanRows(activities, now), now);
}
function renderReadinessChecks(checks) {
  const counts = Object.fromEntries(['completed', 'progress', 'pending'].map(state =>
    [state, checks.filter(check => check.status === state).length]));
  for (const [state, count] of Object.entries(counts)) {
    const button = document.querySelector(`[data-check-filter="${state}"]`);
    button.textContent = `${state === 'completed' ? 'Superados' : state === 'progress' ? 'En progreso' : 'Pendientes'} (${count})`;
  }
  const container = $('readiness-checks');
  container.replaceChildren();
  for (const [index, check] of checks.entries()) {
    if (checkFilter !== 'all' && check.status !== checkFilter) continue;
    const card = document.createElement('article');
    card.className = 'readiness-check';
    card.dataset.status = check.status;
    const top = document.createElement('div');
    top.className = 'readiness-check-top';
    const titleWrap = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = `#${index + 1} ${check.title}`;
    const weight = document.createElement('span');
    weight.className = 'weight';
    weight.textContent = `${check.weight}% del índice`;
    titleWrap.append(title, weight);
    const statusLabel = document.createElement('span');
    statusLabel.className = 'check-status';
    statusLabel.dataset.status = check.status;
    statusLabel.textContent = check.status === 'completed' ? 'Superado'
      : check.status === 'progress' ? 'En progreso' : 'Pendiente';
    top.append(titleWrap, statusLabel);
    const value = document.createElement('div');
    value.className = 'check-value';
    const current = document.createElement('strong');
    current.textContent = check.display;
    const progress = document.createElement('span');
    progress.textContent = percentValueForCheck(check.progress);
    value.append(current, progress);
    const track = document.createElement('div');
    track.className = 'progress-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', `Progreso de ${check.title}`);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    if (check.progress != null) track.setAttribute('aria-valuenow', String(Math.round(check.progress)));
    const fill = document.createElement('span');
    fill.style.width = `${check.progress ?? 0}%`;
    track.append(fill);
    const description = document.createElement('p');
    description.textContent = check.description;
    const base = document.createElement('p');
    base.className = 'check-base';
    base.textContent = `Base: ${check.base}`;
    const milestones = document.createElement('div');
    milestones.className = 'check-milestones';
    for (const milestone of check.milestones) {
      const item = document.createElement('span');
      item.className = 'check-milestone';
      item.dataset.done = String(milestone.done);
      item.textContent = `${milestone.done ? '✓ ' : ''}${milestone.label}`;
      milestones.append(item);
    }
    card.append(top, value, track, description, base, milestones);
    container.append(card);
  }
  if (!container.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'record-empty';
    empty.textContent = 'No hay checks en este estado.';
    container.append(empty);
  }
}
function percentValueForCheck(value) {
  return value == null ? '--' : `${oceanmanFormat(value, 0)}%`;
}
function renderReadinessTrend(history) {
  const container = $('readiness-trend');
  container.replaceChildren();
  const pointsByPeriod = new Map();
  for (const point of history) {
    const date = localDate(`${point.date}T12:00:00`);
    const key = trendPeriod === 'day' ? point.date
      : trendPeriod === 'week' ? dateKey(new Date(date.getTime() - ((date.getDay() + 6) % 7) * 86400000))
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    pointsByPeriod.set(key, point);
  }
  const points = [...pointsByPeriod.values()];
  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'trend-empty';
    empty.textContent = 'Importa tus actividades para empezar a ver la evolución de tu preparación.';
    container.append(empty);
    return;
  }
  const width = 900, height = 300, left = 54, right = 22, top = 24, bottom = 42;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const timestamps = points.map(point => localDate(`${point.date}T12:00:00`).getTime());
  const span = timestamps.at(-1) - timestamps[0];
  const x = index => left + (span ? (timestamps[index] - timestamps[0]) / span * plotWidth : plotWidth / 2);
  const y = score => top + (100 - score) * plotHeight / 100;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Evolución ${trendPeriod === 'day' ? 'diaria' : trendPeriod === 'week' ? 'semanal' : 'mensual'} del índice de preparación`);
  const title = document.createElementNS(svg.namespaceURI, 'title');
  title.textContent = 'Evolución histórica del porcentaje de preparación Oceanman';
  svg.append(title);
  for (const guide of [50, 70, 85]) {
    const line = document.createElementNS(svg.namespaceURI, 'line');
    line.setAttribute('x1', String(left)); line.setAttribute('x2', String(width - right));
    line.setAttribute('y1', String(y(guide))); line.setAttribute('y2', String(y(guide)));
    line.setAttribute('class', 'guide');
    svg.append(line);
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', String(left - 8)); label.setAttribute('y', String(y(guide) + 4));
    label.setAttribute('text-anchor', 'end'); label.setAttribute('class', 'guide-label');
    label.textContent = `${guide}%`;
    svg.append(label);
  }
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('class', 'readiness-line');
  path.setAttribute('d', points.map((point, index) =>
    `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.score ?? 0).toFixed(1)}`).join(' '));
  svg.append(path);
  const stride = Math.max(1, Math.ceil(points.length / 80));
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    circle.setAttribute('class', 'readiness-point');
    circle.setAttribute('cx', String(x(index))); circle.setAttribute('cy', String(y(point.score ?? 0)));
    circle.setAttribute('r', '3');
    const detail = document.createElementNS(svg.namespaceURI, 'title');
    detail.textContent = `${point.date}: ${oceanmanFormat(point.score, 1)}% · cobertura ${point.evidenceWeight}%`;
    circle.append(detail);
    svg.append(circle);
  }
  for (const index of [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]) {
    const date = localDate(`${points[index].date}T12:00:00`);
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', String(x(index))); label.setAttribute('y', String(height - 12));
    label.setAttribute('text-anchor', index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle');
    label.setAttribute('class', 'date-label');
    label.textContent = date.toLocaleDateString('es-ES');
    svg.append(label);
  }
  container.append(svg);
}
function renderOceanmanPlan(rows, now) {
  const headers = ['# WEEK', 'WEEK', 'KM Obj', 'KM Reals', 'Diff',
    'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte', 'Diumenge',
    '# swims', 'min', 'avg', 'max', 'OW'];
  const header = document.createElement('tr');
  for (const label of headers) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    header.append(cell);
  }
  $('oceanman-plan-head').replaceChildren(header);
  const today = new Date(now);
  const currentMonday = new Date(today);
  currentMonday.setDate(currentMonday.getDate() - (currentMonday.getDay() + 6) % 7);
  const currentKey = dateKey(currentMonday);
  const completedWeeks = rows.filter(row => row.week < currentKey).length;
  $('plan-progress').textContent = `${completedWeeks} / ${rows.length} semanas cerradas`;
  const body = document.createDocumentFragment();
  const maxDailyKm = Math.max(0, ...rows.flatMap(row => row.dailyKm ?? []));
  $('plan-color-scale').textContent = `Escala diaria: 0 → ${oceanmanFormat(maxDailyKm, 2)} km (más azul = más distancia).`;
  const km = value => value == null ? '--' : oceanmanFormat(value, 1);
  const dateFormatter = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = row.week === currentKey ? 'current-week'
      : row.week < currentKey ? 'completed-week' : 'future-week';
    const weekStart = localDate(`${row.week}T12:00:00`);
    const values = [row.number, dateFormatter.format(weekStart), km(row.targetKm), km(row.actualKm),
      row.diffKm == null ? '--' : `${row.diffKm > 0 ? '+' : ''}${km(row.diffKm)}`,
      ...(row.dailyKm ?? Array(7).fill(null)).map(km),
      row.swims == null ? '--' : row.swims, km(row.minKm), km(row.averageKm), km(row.maxKm), km(row.openWaterKm)];
    for (const [index, value] of values.entries()) {
      const td = document.createElement('td');
      td.textContent = String(value);
      if (index === 4 && row.diffKm != null) td.className = row.diffKm >= 0 ? 'positive-diff' : 'negative-diff';
      if (index >= 5 && index <= 11) {
        const dailyKm = row.dailyKm?.[index - 5];
        if (dailyKm > 0 && maxDailyKm > 0) {
          td.className = 'day-volume';
          td.style.setProperty('--day-intensity', `${dailyKm / maxDailyKm * 100}%`);
          td.title = `${headers[index]}: ${oceanmanFormat(dailyKm, 2)} km`;
        }
      }
      tr.append(td);
    }
    body.append(tr);
  }
  $('oceanman-plan-body').replaceChildren(body);
}
function podiumTime(duration, label) {
  const result = document.createElement('span');
  result.className = 'podium-time';
  const caption = document.createElement('small');
  caption.textContent = label;
  const value = document.createElement('strong');
  value.textContent = Math.round(duration) >= 3600 ? time(duration) : paceLabel(duration);
  result.append(caption, value);
  return result;
}

function renderRecords(records) {
  $('record-cards').replaceChildren();
  const openWater = recordGroup === 'open_water';
  $('record-method').textContent = openWater
    ? 'Whole open-water activities within ±7% of the target distance, ranked by moving time. Actual distance and moving pace are shown; shorter swims within the range may rank faster. No splits are used.'
    : 'Pool efforts use exact-distance windows of recorded FIT lengths, including rests. One best effort per session. IM requires equal butterfly / backstroke / breaststroke / freestyle legs in that order. These are locally calculated efforts, not Garmin official records.';
  const groups = openWater ? [{ title: 'Open water', distances: openWaterRecordDistances.map(item => item.distance) }]
    : recordGroup === 'im' ? [{ title: 'Individual medley', distances: [100, 200, 400] }] : recordDistanceGroups;
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'record-distance-group';
    const title = document.createElement('h3');
    title.textContent = group.title;
    const grid = document.createElement('div');
    grid.className = 'record-grid';
    section.append(title, grid);
    for (const distance of group.distances) {
      const category = `${distance}m ${openWater ? 'open water' : recordGroup === 'im' ? 'IM' : recordGroup}`;
      const entries = records[category];
      const card = document.createElement('article');
      card.className = 'record-card';
      const heading = document.createElement('h3');
      heading.textContent = openWater ? openWaterRecordDistances.find(item => item.distance === distance).label
        : recordGroup === 'im' ? category : `${distance}m`;
      card.append(heading);
      const attemptCount = records.attempts[category];
      const attempts = document.createElement('small');
      attempts.className = 'record-attempt-count';
      attempts.textContent = openWater ? `${attemptCount} qualifying ${attemptCount === 1 ? 'session' : 'sessions'}`
        : `${attemptCount} ${attemptCount === 1 ? 'attempt' : 'attempts'}`;
      card.append(attempts);
      if (!entries.length) {
        const empty = document.createElement('p');
        empty.className = 'record-empty';
        empty.textContent = openWater ? 'No qualifying open-water sessions in this view.' : 'No qualifying FIT lengths. No estimated record.';
        card.append(empty);
      }
      entries.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'podium';
        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = String(index + 1).padStart(2, '0');
        const details = document.createElement('a');
        details.href = `#activity=${encodeURIComponent(entry.id)}`;
        details.className = 'activity-link';
        details.setAttribute('aria-label', `Analyze activity from ${entry.date?.slice(0, 10)}`);
        details.textContent = entry.date?.slice(0, 10);
        const stats = document.createElement('small');
        stats.textContent = `${openWater ? `${format(entry.distance, 2)} m · ` : ''}${paceLabel(entry.pace)} /100 m`;
        details.append(stats);
        row.append(rank, details, podiumTime(entry.duration, openWater ? 'Moving time' : 'Effort time'));
        card.append(row);
      });
      grid.append(card);
    }
    $('record-cards').append(section);
  }
}
function renderTable() {
  $('table-count').textContent = `${logbookRows.length} SESSIONS`;
  const header = document.createElement('tr');
  for (const [[title], index] of columns.map((column, index) => [column, index])) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (tableSort?.index === index) th.setAttribute('aria-sort', tableSort.direction);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button';
    button.textContent = `${title}${tableSort?.index === index ? tableSort.direction === 'ascending' ? ' ↑' : ' ↓' : ' ↕'}`;
    button.setAttribute('aria-label', `Sort by ${title}`);
    button.addEventListener('click', () => {
      tableSort = { index, direction: tableSort?.index === index && tableSort.direction === 'ascending' ? 'descending' : 'ascending' };
      renderTable();
      $('table-head').querySelectorAll('button')[index].focus();
    });
    th.append(button);
    header.append(th);
  }
  $('table-head').replaceChildren(header);
  const fragment = document.createDocumentFragment();
  for (const a of sortedVisible()) {
    const row = document.createElement('tr');
    if (a.excluded) row.className = 'excluded';
    for (const [title, get] of columns) {
      const cell = document.createElement('td');
      if (['ID', 'Local date', 'Activity'].includes(title)) {
        const link = document.createElement('a');
        link.href = `#activity=${encodeURIComponent(a.id)}`;
        link.className = 'activity-link';
        link.textContent = get(a);
        cell.append(link);
      } else cell.textContent = get(a);
      row.append(cell);
    }
    fragment.append(row);
  }
  if (!logbookRows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns.length;
    cell.textContent = 'No sessions match these filters.';
    row.append(cell);
    fragment.append(row);
  }
  $('sessions').replaceChildren(fragment);
}
function sortedVisible() {
  return tableSort ? sortSessions(logbookRows, sortFields[tableSort.index], tableSort.direction) : logbookRows;
}
function renderPoolOptions() {
  const select = $('pool-filter');
  const selected = select.value;
  const lengths = [...new Set(dataset.activities.filter(a => a.type === 'pool' && a.poolLength > 0).map(a => a.poolLength))].sort((a, b) => a - b);
  select.replaceChildren();
  for (const [value, label] of [['all', 'All environments'], ['open_water', 'Open water'], ['unknown', 'Pool length unknown'],
    ...lengths.map(length => [String(length), `${format(length, 2)} m pool`])]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = [...select.options].some(option => option.value === selected) ? selected : 'all';
}
function applyLogbookFilters() {
  const minInput = $('distance-min'), maxInput = $('distance-max');
  const minDistance = minInput.value === '' ? null : minInput.valueAsNumber;
  const maxDistance = maxInput.value === '' ? null : maxInput.valueAsNumber;
  const invalid = minInput.validity.badInput || maxInput.validity.badInput
    || minDistance != null && (!Number.isFinite(minDistance) || minDistance < 0)
    || maxDistance != null && (!Number.isFinite(maxDistance) || maxDistance < 0)
    || minDistance != null && maxDistance != null && minDistance > maxDistance;
  $('logbook-filter-error').textContent = invalid ? 'Enter valid non-negative distances; the minimum cannot exceed the maximum.' : '';
  logbookRows = invalid ? [] : filterLogbook(visible, { minDistance, maxDistance, pool: $('pool-filter').value });
  $('export').disabled = invalid || logbookRows.length === 0;
  renderTable();
}
function renderQuality(activities) {
  $('quality').replaceChildren();
  const flagged = activities.filter(a => a.reasons.length || a.review);
  $('quality-count').textContent = `${flagged.length} to review`;
  for (const a of flagged) appendReview(a, $('quality'));
  if (!flagged.length) $('quality').textContent = 'No suspicious sessions or manual overrides in this view.';
  const label = document.createElement('p');
  label.className = 'hint';
  label.textContent = 'Review any other session:';
  const picker = document.createElement('select');
  picker.setAttribute('aria-label', 'Choose a session to review');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select session...';
  picker.append(placeholder);
  for (const a of activities.filter(a => !a.reasons.length && !a.review)) {
    const option = document.createElement('option');
    option.value = a.id;
    option.textContent = `${a.date?.slice(0, 10)} / ${a.name} / ${format(a.distance, 0)} m`;
    picker.append(option);
  }
  picker.addEventListener('change', () => {
    const a = activities.find(a => a.id === picker.value);
    if (a) { appendReview(a, $('quality')); picker.value = ''; }
  });
  $('quality').append(label, picker);
}
function appendReview(a, parent) {
  const row = document.createElement('div');
  row.className = 'quality-row';
  const description = document.createElement('div');
  description.textContent = `${a.date?.slice(0, 10)} / ${a.name} / ${format(a.distance, 0)} m / ${paceLabel(a.pace)}/100 m`;
  const reason = document.createElement('small');
  reason.textContent = `${a.excluded ? 'EXCLUDED' : 'INCLUDED'}: ${a.reasons.join('; ') || 'Manual review'}`;
  description.append(reason);
  const select = document.createElement('select');
  select.setAttribute('aria-label', `Review activity ${a.id}`);
  for (const [value, text] of [['', 'Automatic'], ['include', 'Always include'], ['exclude', 'Always exclude']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  select.value = a.review ?? '';
  select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      if (demo) {
        dataset.activities.find(activity => activity.id === a.id).review = select.value || null;
      } else {
        await api('/api/review', { id: a.id, decision: select.value || null });
        dataset = await fetchDataset();
      }
      render();
      status(demo ? 'Demo review updated in memory only.' : `Review saved to ${cloud ? 'PostgreSQL' : 'SQLite'}.`);
    } catch (error) {
      select.value = a.review ?? '';
      select.disabled = false;
      status(error.message, true);
    }
  });
  row.append(description, select);
  parent.append(row);
}
function renderWarnings() {
  const incomplete = dataset.activities.filter(a => a.fitStatus !== 'complete');
  const missingRoutes = dataset.activities.filter(a => a.type === 'open_water' && a.routeStatus === 'unavailable');
  $('import-count').textContent = `${incomplete.length} without complete FIT / ${missingRoutes.length} without GPS route`;
  $('import-warnings').replaceChildren();
  const explanation = document.createElement('p');
  explanation.textContent = 'Open-water sessions generally have no pool lengths: stroke percentages and pool efforts stay unavailable. Complete FIT import does not guarantee every optional field exists.';
  $('import-warnings').append(explanation);
  for (const a of incomplete) {
    const row = document.createElement('p');
    row.className = 'warning';
    row.textContent = `${a.date?.slice(0, 10)} / ${a.name}: ${a.fitStatus ?? 'pending'}. ${a.fitError ?? 'Sync to import lengths.'}`;
    $('import-warnings').append(row);
  }
  for (const a of missingRoutes) {
    const row = document.createElement('p');
    row.className = 'warning';
    row.textContent = `${a.date?.slice(0, 10)} / ${a.name}: the FIT export has no usable GPS route points.`;
    $('import-warnings').append(row);
  }
}
function safeRender() {
  try { render(); } catch (error) { $('export').disabled = true; status(error.message, true); }
}
const tabs = [...document.querySelectorAll('[role="tab"]')];
function activateTab(tab, moveFocus = false) {
  for (const candidate of tabs) {
    const active = candidate === tab;
    candidate.setAttribute('aria-selected', String(active));
    candidate.tabIndex = active ? 0 : -1;
    $(candidate.getAttribute('aria-controls')).hidden = !active;
  }
  if (moveFocus) tab.focus();
}
function closeActivity() {
  if (activityOpenedFromDashboard) history.back();
  else location.hash = '';
}
async function showActivity() {
  const request = ++activityRequest;
  const match = /^#activity=(\d+)$/.exec(location.hash);
  const isActivity = location.hash.startsWith('#activity=');
  document.body.classList.toggle('activity-mode', isActivity);
  $('activity-detail').hidden = !isActivity;
  if (!isActivity) {
    activateTab(tabs.find(tab => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]);
    document.title = 'SWIMLAB / Personal swim analytics';
    if (activityReturnFocus?.isConnected) activityReturnFocus.focus({ preventScroll: true });
    return;
  }
  for (const tab of tabs) $(tab.getAttribute('aria-controls')).hidden = true;
  const container = $('activity-detail');
  container.replaceChildren();
  const back = document.createElement('button');
  back.className = 'secondary';
  back.textContent = '← Back to dashboard';
  back.addEventListener('click', closeActivity);
  const message = document.createElement('p');
  message.className = 'hint';
  container.append(back, message);
  const activity = match ? annotateOutliers(dataset.activities).find(a => a.id === match[1]) : null;
  if (!activity) {
    message.textContent = match ? 'Activity not found in the loaded history. Return to the dashboard and load saved data or sync Garmin.' : 'Invalid activity link.';
    message.setAttribute('role', 'alert');
    document.title = 'SWIMLAB / Activity not found';
    return;
  }
  document.title = `SWIMLAB / ${activity.name}`;
  message.textContent = 'Loading recorded sensor data…';
  let records;
  try {
    records = demo ? { records: (dataset.records ?? []).filter(r => r.activityId === activity.id), recordsStatus: 'complete' }
      : await api(`/api/data?id=${encodeURIComponent(activity.id)}`);
  } catch (error) {
    records = { records: [], recordsStatus: activity.recordsStatus, error: error.message };
  }
  if (request !== activityRequest) return;
  try {
    renderActivity(container, activity, dataset, records, { demo, onBack: closeActivity });
  } catch (error) {
    message.textContent = `Activity analysis failed: ${error.message}`;
    message.setAttribute('role', 'alert');
    container.replaceChildren(back, message);
  }
}
addEventListener('hashchange', event => {
  if (!new URL(event.oldURL).hash.startsWith('#activity=') && location.hash.startsWith('#activity=')) {
    activityOpenedFromDashboard = true;
    activityReturnFocus = document.activeElement;
  }
  void showActivity();
});
for (const tab of tabs) {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next >= 0) {
      event.preventDefault();
      activateTab(tabs[next], true);
    }
  });
}
for (const id of ['period', 'environment', 'outliers', 'from', 'to', 'record-limit']) {
  $(id).addEventListener('change', () => {
    const custom = $('period').value === 'custom';
    $('from-label').hidden = !custom;
    $('to-label').hidden = !custom;
    safeRender();
  });
}
for (const id of ['distance-min', 'distance-max']) $(id).addEventListener('input', applyLogbookFilters);
$('pool-filter').addEventListener('change', applyLogbookFilters);
$('clear-logbook').addEventListener('click', () => {
  $('distance-min').value = '';
  $('distance-max').value = '';
  $('pool-filter').value = 'all';
  applyLogbookFilters();
});
for (const button of document.querySelectorAll('[data-check-filter]')) {
  button.addEventListener('click', () => {
    checkFilter = button.dataset.checkFilter;
    for (const option of document.querySelectorAll('[data-check-filter]')) {
      option.setAttribute('aria-pressed', String(option === button));
    }
    renderReadinessChecks(readinessChecks);
  });
}
for (const button of document.querySelectorAll('[data-trend-period]')) {
  button.addEventListener('click', () => {
    trendPeriod = button.dataset.trendPeriod;
    for (const option of document.querySelectorAll('[data-trend-period]')) {
      option.setAttribute('aria-pressed', String(option === button));
    }
    renderReadinessTrend(readinessHistory);
  });
}
for (const button of $('record-groups').querySelectorAll('button')) {
  button.addEventListener('click', () => {
    recordGroup = button.dataset.recordGroup;
    for (const option of $('record-groups').querySelectorAll('button')) {
      option.setAttribute('aria-pressed', String(option === button));
    }
    renderRecords(personalBests(visible, dataset.lengths, Number($('record-limit').value)));
  });
}
async function loadSaved() {
  dataset = await fetchDataset();
  demo = false;
  render();
  await showActivity();
}
async function fetchDataset() {
  const data = await api('/api/data');
  while (cloud && data.nextOffset != null) {
    const page = await api(`/api/data?offset=${data.nextOffset}`);
    data.activities.push(...page.activities);
    data.lengths.push(...page.lengths);
    data.routePoints.push(...page.routePoints);
    data.nextOffset = page.nextOffset;
  }
  return data;
}
async function pollSync() {
  try {
    const job = cloud ? await api('/api/sync', { action: 'step' }) : await api('/api/sync');
    setRunning(job.state === 'running');
    $('progress').max = Math.max(1, job.total);
    $('progress').value = job.done;
    status(job.message, ['error', 'partial'].includes(job.state));
    if (job.state === 'running') {
      currentPoll = setTimeout(pollSync, 1500);
    } else {
      currentPoll = null;
      await loadSaved();
      status(job.message, ['error', 'partial'].includes(job.state));
    }
  } catch (error) {
    setRunning(false);
    status(`Cannot check sync progress: ${error.message} Reload to reconnect or retry.`, true);
  }
}
$('connect').addEventListener('submit', async event => {
  event.preventDefault();
  if (running) return;
  const apiKey = cloud ? null : $('key').value.trim();
  $('key').value = '';
  setRunning(true);
  status('Connecting to Garmin...');
  try {
    await api('/api/sync', cloud ? { action: 'start' } : { apiKey });
    if (currentPoll) clearTimeout(currentPoll);
    await pollSync();
  } catch (error) { setRunning(false); status(error.message, true); }
});
$('cached').addEventListener('click', async () => {
  try { await loadSaved(); status(`Loaded ${cloud ? 'cloud' : 'locally'} saved metrics. No Garmin request was made.`); }
  catch (error) { status(error.message, true); }
});
$('export').addEventListener('click', () => {
  const escape = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = [columns.map(([title]) => title), ...sortedVisible().map(a => columns.map(([, get]) => get(a)))].map(row => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `swimlab-${demo ? 'DEMO-' : ''}${dateKey(new Date())}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('demo').addEventListener('click', () => {
  demo = true;
  $('key').value = '';
  dataset = { activities: [], lengths: [], routePoints: [], records: [], history: null };
  for (let i = 0; i < 72; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i * 3);
    date.setHours([7, 12, 17, 18, 19, 8][i % 6], 15, 0, 0);
    const open = i % 5 === 0;
    const count = 40 + i % 5 * 8;
    const distance = open ? 1800 + i % 4 * 400 : count * 25;
    const movingTime = distance * (1.05 + i % 7 * 0.07);
    const id = String(900000 + i);
    const activity = deriveMetrics({
      id, name: open ? 'Open-water endurance' : i % 2 ? 'Pool / technique & IM' : 'Pool / aerobic endurance',
      date: `${dateKey(date)}T${String(date.getHours()).padStart(2, '0')}:15:00`,
      type: open ? 'open_water' : 'pool', distance, movingTime, elapsedTime: movingTime / 0.82,
      timerTime: movingTime / 0.9, poolLength: open ? null : 25, lengths: open ? null : count,
      strokes: Math.round(distance / 2.1), heartRate: 120 + i % 20, swolf: 34 + i % 10,
      temperature: open ? 21 : null, minTemperature: null, maxTemperature: null,
      fitStatus: 'complete', fitError: null, review: null,
      freestylePct: open ? null : 25, breaststrokePct: open ? null : 25, backstrokePct: open ? null : 25,
      butterflyPct: open ? null : 25, otherPct: open ? null : 0,
    });
    dataset.activities.push(activity);
    for (let seconds = 0, sequence = 0; seconds <= activity.elapsedTime; seconds += 5, sequence++) {
      dataset.records.push({ activityId: id, sequence, timestamp: date.getTime() / 1000 + seconds,
        heartRate: Math.round(activity.heartRate + Math.sin(seconds / 70) * 8 + seconds / activity.elapsedTime * 5),
        distance: open ? distance * seconds / activity.elapsedTime : null,
        speed: open ? distance / activity.elapsedTime * (1 + Math.sin(seconds / 90) * 0.1) : null,
        cadence: null, temperature: open ? 21 + Math.sin(seconds / 600) : null });
    }
    if (open) {
      for (let point = 0; point < 18; point++) dataset.routePoints.push({
        activityId: id, sequence: point, lat: 0.02 + point * 0.0004,
        lon: 0.01 + Math.sin(point / 3) * 0.002,
      });
    }
    if (!open) {
      const perLength = movingTime / count;
      let start = date.getTime() / 1000, sequence = 0;
      for (let j = 0; j < count; j++) {
        const duration = perLength * (1 + (j / (count - 1) - 0.5) * 0.14 + Math.sin(j * 0.8) * 0.025);
        dataset.lengths.push({
          activityId: id, sequence: sequence++, active: true, start, duration, timerTime: duration,
          distance: 25, strokes: Math.round(12 + Math.sin(j * 0.6) * 2 + j / (count - 1) * 2),
          stroke: ['butterfly', 'backstroke', 'breaststroke', 'freestyle'][Math.floor(j / 2) % 4],
        });
        start += duration;
        if ((j + 1) % 8 === 0) {
          dataset.lengths.push({ activityId: id, sequence: sequence++, active: false, start, duration: 30,
            timerTime: 30, distance: 0, strokes: 0, stroke: 'unknown' });
          start += 30;
        } else start += 1;
      }
    }
  }
  const bad = { ...dataset.activities[1], id: '999999', name: 'Suspect sensor reading / review me', movingTime: 50, review: null };
  dataset.activities.push(deriveMetrics(bad));
  $('period').value = 'all';
  $('environment').value = 'all';
  $('outliers').checked = false;
  $('from-label').hidden = true;
  $('to-label').hidden = true;
  render();
  void showActivity();
  status('Demo loaded: synthetic data only. Storage has not been changed.');
});

if (cloud) {
  $('key-label').hidden = true;
  $('key').hidden = true;
  $('key').required = false;
  $('connection-note').textContent = 'The Garmin key is configured as a server environment variable. Swim metrics, pool lengths and available GPS routes are stored in PostgreSQL. Keep Vercel Deployment Protection enabled for all deployments.';
  $('privacy-note').textContent = 'SWIMLAB / Independent personal dashboard, not affiliated with Garmin. Cloud storage contains sensitive health and GPS data. Protect all deployments and database access.';
}
try {
  await loadSaved();
  const job = await api('/api/sync');
  if (job.state === 'running') await pollSync();
  else status(dataset.activities.length ? 'Loaded your saved swimming history. Sync Garmin to retrieve new activities.' : 'No saved history yet. Connect Garmin or explore the demo.');
} catch (error) {
  status(`Cannot load local history: ${error.message}`, true);
}
