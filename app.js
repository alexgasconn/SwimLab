import { annotateOutliers, deriveMetrics, divide, localDate, dateKey, weeklyTrend, trainingHeatmap, personalBests, sessionRankings, trainingSummary, strokeMix, sortSessions, filterLogbook } from './analytics.mjs';
import { scatterplot, distribution, weeklyChart, heatmap, paceLabel, swolfChart, routeMap } from './charts.js';

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
const format = (value, digits = 1) => value == null || !Number.isFinite(value) ? '--' : new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(value);
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
  const weeklyScope = scope.filter(a => (include || !a.excluded) && localDate(a.date) <= to);
  let weeks = weeklyTrend(weeklyScope);
  if (from) {
    const firstMonday = new Date(from);
    firstMonday.setDate(firstMonday.getDate() - (firstMonday.getDay() + 6) % 7);
    weeks = weeks.filter(w => w.date >= dateKey(firstMonday));
  }
  weeks = weeks.filter(w => w.date <= dateKey(to));
  weeklyChart($('weekly'), weeks);
  heatmap($('heatmap'), trainingHeatmap(visible));
  swolfChart($('swolf-chart'), visible);
  renderSummary(trainingSummary(visible));
  renderStrokeMix(strokeMix(visible, dataset.lengths));
  renderRoutes();
  const limit = Number($('record-limit').value);
  const metric = $('ranking-metric').value;
  const metricLabel = metric === 'distance' ? 'Longest distance' : metric === 'pace' ? 'Fastest pace' : 'Lowest SWOLF';
  $('ranking-title').textContent = metricLabel;
  $('ranking-count').textContent = `TOP ${limit}`;
  renderRankings(sessionRankings(visible, metric, limit), metric);
  renderRecords(personalBests(visible, dataset.lengths, limit));
  renderPoolOptions();
  applyLogbookFilters();
  renderQuality(dated);
  renderWarnings();
}
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
function renderSummary(summary) {
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
    const stats = document.createElement('p');
    stats.textContent = `${format(cardData.distance / 1000, 2)} km total / ${format(cardData.averageDistance, 0)} m average / ${paceLabel(cardData.averagePace)} /100 m avg pace / ${format(cardData.averageSwolf, 1)} avg SWOLF`;
    card.append(heading, count, share, stats);
    container.append(card);
  }
  if (!cards.length) container.textContent = 'No sessions match these filters.';
}
function renderRankings(entries, metric) {
  const container = $('ranking-list');
  container.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'record-empty';
    empty.textContent = 'No eligible sessions in this view.';
    container.append(empty);
    return;
  }
  for (const [index, entry] of entries.entries()) {
    const row = document.createElement('div');
    row.className = 'podium';
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const details = document.createElement('div');
    details.textContent = `${entry.date?.slice(0, 10)} / ${entry.type === 'pool' ? 'Pool' : 'Open water'}`;
    const pace = document.createElement('small');
    pace.textContent = `${paceLabel(entry.pace)} /100 m`;
    details.append(pace);
    const value = document.createElement('strong');
    value.textContent = metric === 'distance' ? `${format(entry.value / 1000, 2)} km`
      : metric === 'pace' ? `${paceLabel(entry.value)}/100` : format(entry.value, 1);
    row.append(rank, details, value);
    container.append(row);
  }
}
function renderRecords(records) {
  $('record-cards').replaceChildren();
  const groups = {
    freestyle: key => key.endsWith(' freestyle'),
    breaststroke: key => key.endsWith(' breaststroke'),
    backstroke: key => key.endsWith(' backstroke'),
    butterfly: key => key.endsWith(' butterfly'),
    im: key => key.endsWith(' IM'),
    mixed: key => /^\d+m$/.test(key),
    session: key => key.endsWith(' session'),
  };
  for (const [category, entries] of Object.entries(records).filter(([key]) => groups[recordGroup](key))) {
    const card = document.createElement('article');
    card.className = 'record-card';
    const heading = document.createElement('h3');
    heading.textContent = category.replace(/ (freestyle|breaststroke|backstroke|butterfly)$/, '');
    card.append(heading);
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'record-empty';
      empty.textContent = category.includes('session') ? 'No eligible sessions.' : 'No qualifying FIT lengths. No estimated record.';
      card.append(empty);
    }
    entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'podium';
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      const details = document.createElement('div');
      details.textContent = entry.date?.slice(0, 10);
      const pace = document.createElement('small');
      pace.textContent = `${paceLabel(entry.pace)} /100 m`;
      details.append(pace);
      const value = document.createElement('strong');
      value.textContent = category === 'Longest session' ? `${format(entry.value / 1000, 2)} km`
        : category === 'Fastest session' ? `${paceLabel(entry.value)}/100` : paceLabel(entry.value);
      row.append(rank, details, value);
      card.append(row);
    });
    $('record-cards').append(card);
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
    for (const [, get] of columns) {
      const cell = document.createElement('td');
      cell.textContent = get(a);
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
for (const id of ['period', 'environment', 'outliers', 'from', 'to', 'record-limit', 'ranking-metric']) {
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
  dataset = { activities: [], lengths: [], routePoints: [], history: null };
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
    if (open) {
      for (let point = 0; point < 18; point++) dataset.routePoints.push({
        activityId: id, sequence: point, lat: 0.02 + point * 0.0004,
        lon: 0.01 + Math.sin(point / 3) * 0.002,
      });
    }
    if (!open) {
      const perLength = movingTime / count;
      for (let j = 0; j < count; j++) dataset.lengths.push({
        activityId: id, sequence: j, active: true, start: date.getTime() / 1000 + j * (perLength + 1),
        duration: perLength, distance: 25, strokes: 12,
        stroke: ['butterfly', 'backstroke', 'breaststroke', 'freestyle'][Math.floor(j / (i % 2 ? 2 : 1)) % 4],
      });
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
  status('Demo loaded: synthetic data only. Storage has not been changed.');
});

if (cloud) {
  $('key-label').hidden = true;
  $('key').hidden = true;
  $('key').required = false;
  $('storage-label').textContent = 'CLOUD / PRIVATE';
  $('storage-note').textContent = 'Data is stored in PostgreSQL. Your Garmin key stays on the server.';
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
