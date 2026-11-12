import { annotateOutliers, deriveMetrics, divide, localDate, dateKey, weeklyTrend, trainingHeatmap, personalBests, sessionRankings, trainingSummary } from './analytics.mjs';
import { scatterplot, distribution, weeklyChart, heatmap, paceLabel, swolfChart, routeMap } from './charts.js';

const $ = id => document.getElementById(id);
let dataset = { activities: [], lengths: [], routePoints: [], history: null };
let demo = false;
let running = false;
let visible = [];
let currentPoll = null;
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
  ['Back %', a => percent(a.backstrokePct)], ['Fly %', a => percent(a.butterflyPct)], ['Other %', a => percent(a.otherPct)],
  ['FIT', a => a.fitStatus ?? 'pending'], ['Excluded', a => a.excluded ? 'Yes' : 'No'],
  ['Quality flags', a => a.reasons.join('; ')], ['Review', a => a.review ?? 'Automatic'],
];
function status(message, error = false) {
  $('status').textContent = message;
  $('status').className = error ? 'error' : '';
}
async function api(path, body) {
  const response = await fetch(path, body === undefined ? { signal: AbortSignal.timeout(20000) } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
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
  $('source').textContent = demo ? 'DEMO / SYNTHETIC DATA' : dataset.activities.length ? 'LOCAL SQLITE / GARMIN' : 'NO DATA';
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
  $('coverage').textContent = demo ? 'Synthetic demo only. No demo data is written to SQLite.'
    : `${dataset.activities.length} saved swims / ${complete} FIT imports / ${dataset.lengths.filter(l => l.active).length} active pool lengths. ${history ? `Last history sync: ${new Date(history.syncedAt).toLocaleString('en')}. ${history.truncated ? 'Scan capped at 5,000 activities; older history may be missing.' : `${history.scanned} activities scanned across all sports.`}` : 'Connect Garmin to build your local database.'}`;
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
  routeMap($('route-map'), visible, dataset.routePoints ?? []);
  const limit = Number($('record-limit').value);
  const metric = $('ranking-metric').value;
  const metricLabel = metric === 'distance' ? 'Longest distance' : metric === 'pace' ? 'Fastest pace' : 'Lowest SWOLF';
  $('ranking-title').textContent = metricLabel;
  $('ranking-count').textContent = `TOP ${limit}`;
  renderRankings(sessionRankings(visible, metric, limit), metric);
  renderRecords(personalBests(visible, dataset.lengths, limit));
  renderTable();
  renderQuality(dated);
  renderWarnings();
  $('export').disabled = visible.length === 0;
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
    const name = document.createElement('small');
    name.textContent = entry.name;
    details.append(name);
    const value = document.createElement('strong');
    value.textContent = metric === 'distance' ? `${format(entry.value / 1000, 2)} km`
      : metric === 'pace' ? `${paceLabel(entry.value)}/100` : format(entry.value, 1);
    row.append(rank, details, value);
    container.append(row);
  }
}
function renderRecords(records) {
  $('record-cards').replaceChildren();
  for (const [category, entries] of Object.entries(records)) {
    const card = document.createElement('article');
    card.className = 'record-card';
    const heading = document.createElement('h3');
    heading.textContent = category;
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
      const name = document.createElement('small');
      name.textContent = entry.name;
      details.append(name);
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
  $('table-count').textContent = `${visible.length} SESSIONS`;
  const header = document.createElement('tr');
  for (const [title] of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = title;
    header.append(th);
  }
  $('table-head').replaceChildren(header);
  const fragment = document.createDocumentFragment();
  for (const a of visible) {
    const row = document.createElement('tr');
    if (a.excluded) row.className = 'excluded';
    for (const [, get] of columns) {
      const cell = document.createElement('td');
      cell.textContent = get(a);
      row.append(cell);
    }
    fragment.append(row);
  }
  if (!visible.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns.length;
    cell.textContent = 'No sessions match these filters.';
    row.append(cell);
    fragment.append(row);
  }
  $('sessions').replaceChildren(fragment);
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
        dataset = await api('/api/data');
      }
      render();
      status(demo ? 'Demo review updated in memory only.' : 'Review saved to SQLite.');
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
async function loadSaved() {
  dataset = await api('/api/data');
  demo = false;
  render();
}
async function pollSync() {
  try {
    const job = await api('/api/sync');
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
    status(`Cannot check sync progress: ${error.message} Reload to reconnect; the server may still be syncing.`, true);
  }
}
$('connect').addEventListener('submit', async event => {
  event.preventDefault();
  if (running) return;
  const apiKey = $('key').value.trim();
  $('key').value = '';
  setRunning(true);
  status('Connecting to Garmin...');
  try {
    await api('/api/sync', { apiKey });
    if (currentPoll) clearTimeout(currentPoll);
    await pollSync();
  } catch (error) { setRunning(false); status(error.message, true); }
});
$('cached').addEventListener('click', async () => {
  try { await loadSaved(); status('Loaded locally saved metrics. No Garmin request was made.'); }
  catch (error) { status(error.message, true); }
});
$('export').addEventListener('click', () => {
  const escape = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = [columns.map(([title]) => title), ...visible.map(a => columns.map(([, get]) => get(a)))].map(row => row.map(escape).join(',')).join('\r\n');
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
  status('Demo loaded: synthetic data only. SQLite has not been changed.');
});

try {
  await loadSaved();
  const job = await api('/api/sync');
  if (job.state === 'running') await pollSync();
  else status(dataset.activities.length ? 'Loaded your saved swimming history. Sync Garmin to retrieve new activities.' : 'No saved history yet. Connect Garmin or explore the demo.');
} catch (error) {
  status(`Cannot load local history: ${error.message}`, true);
}
