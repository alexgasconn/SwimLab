import { activityAnalysis, lengthTrend, lengthCorrelation, positive } from './analytics.mjs';
import { metricChart, lengthRibbon, routeMap, paceLabel, strokeColors, strokeNames } from './charts.js';

const format = value => Number.isFinite(value) ? new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value) : '--';
const formatTempo = value => Number.isFinite(value) ? new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) : '--';
const time = value => {
  if (!Number.isFinite(value)) return '--';
  const seconds = Math.round(value);
  return `${Math.floor(seconds / 3600) ? Math.floor(seconds / 3600) + 'h ' : ''}${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`;
};
const strokeName = value => strokeNames[value] ?? 'Unclassified';
const node = (tag, className, text) => {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text != null) result.textContent = text;
  return result;
};
function card(container, label, value, note) {
  const result = node('article', 'summary-card');
  result.append(node('h3', '', label), node('strong', '', value), node('small', '', note));
  container.append(result);
}
function panel(container, title, note) {
  const result = node('article', 'panel detail-panel');
  result.append(node('h3', '', title));
  if (note) result.append(node('p', 'hint', note));
  const content = node('div', 'detail-chart');
  result.append(content);
  container.append(result);
  return content;
}
function table(container, headings, values) {
  const wrap = node('div', 'table-wrap detail-table');
  wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', headings.join(', '));
  const result = node('table');
  const head = node('thead'), header = node('tr'), body = node('tbody');
  for (const title of headings) {
    const th = node('th', '', title);
    th.scope = 'col';
    header.append(th);
  }
  head.append(header);
  for (const valuesRow of values) {
    const tr = node('tr');
    for (const value of valuesRow) {
      const td = node('td');
      if (value instanceof Node) td.append(value);
      else td.textContent = value == null ? '--' : String(value);
      tr.append(td);
    }
    body.append(tr);
  }
  result.append(head, body);
  wrap.append(result);
  container.append(wrap);
}

export function renderActivity(container, activity, dataset, recordData, { demo = false, onBack } = {}) {
  const details = activityAnalysis(activity, dataset.lengths, recordData.records);
  container.replaceChildren();
  const back = node('button', 'secondary', '← Back to dashboard');
  back.type = 'button';
  back.addEventListener('click', onBack);
  const hero = node('header', 'activity-hero');
  const title = node('div');
  title.append(node('p', 'eyebrow', `${demo ? 'SYNTHETIC DEMO / ' : ''}ACTIVITY LAB / ${activity.type === 'pool' ? 'POOL' : 'OPEN WATER'}`));
  const heading = node('h1', '', activity.name);
  heading.tabIndex = -1;
  title.append(heading, node('p', 'subtitle', `${activity.date?.replace('T', ' ')} · ${activity.type === 'pool' ? `${format(activity.poolLength)} m pool` : 'GPS swim'} · ID ${activity.id}`));
  hero.append(title, node('span', 'badge', `${format(activity.distance / 1000)} KM`));
  const coverage = node('p', 'hint detail-coverage',
    `${details.active.length} usable active lengths / ${activity.lengths ?? '--'} reported · ${details.blocks.length} detected blocks · ${details.samples.length} timed records · ${details.hr.count} HR samples. Session totals and length metrics are kept separate. Tempo = 60 / SPM, using the recorded stroke-count convention without assumed doubling; it represents a same-arm cycle only if the device counts it that way.`);
  if (activity.review === 'exclude' || activity.excluded) coverage.append(node('strong', '', ' This activity is excluded or flagged in dashboard analytics; its raw detail is still shown.'));
  container.append(back, hero, coverage);
  if (recordData.error) container.append(node('p', 'detail-warning', `Sensor records could not be loaded: ${recordData.error} Reload this activity to retry.`));
  else if (!details.samples.length) {
    container.append(node('p', 'detail-warning', activity.fitStatus === 'error'
      ? `FIT import failed: ${activity.fitError ?? 'unknown error'}. Retry Garmin sync to retrieve temporal records.`
      : activity.fitStatus === 'unavailable' || recordData.recordsStatus === 'unavailable'
        ? 'This FIT export contains no timed sensor records. Only recorded session summaries and available lengths are shown.'
        : 'Temporal records have not been imported yet. Sync Garmin + FIT to complete older cached activities. No HR curve is inferred from the session average.'));
  }
  for (const warning of details.warnings) container.append(node('p', 'detail-warning', warning));
  const nav = node('div', 'tabs detail-tabs');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Activity analysis sections');
  const sections = {};
  const tabButtons = [];
  const activate = key => {
    for (const button of tabButtons) {
      const active = button.dataset.section === key;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      sections[button.dataset.section].hidden = !active;
    }
  };
  for (const [key, label] of [['summary', 'Overview'], ['lengths', 'Sets & lengths'], ['technique', 'Technique & trends'], ['sensors', 'HR & GPS']]) {
    const button = node('button', '', label);
    button.type = 'button';
    button.id = `activity-${key}-tab`;
    button.dataset.section = key;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `activity-${key}`);
    button.addEventListener('click', () => activate(key));
    button.addEventListener('keydown', event => {
      const index = tabButtons.indexOf(button);
      const next = event.key === 'ArrowRight' ? (index + 1) % tabButtons.length
        : event.key === 'ArrowLeft' ? (index + tabButtons.length - 1) % tabButtons.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); activate(tabButtons[next].dataset.section); tabButtons[next].focus(); }
    });
    tabButtons.push(button);
    nav.append(button);
    const section = node('section', 'activity-section');
    section.id = `activity-${key}`;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', button.id);
    sections[key] = section;
  }
  container.append(nav, ...Object.values(sections));
  activate('summary');
  renderSummary(sections.summary, activity, details);
  renderLengths(sections.lengths, details);
  renderTechnique(sections.technique, details, activity);
  renderSensors(sections.sensors, details, activity, dataset);
  heading.focus({ preventScroll: true });
}

function renderSummary(container, activity, details) {
  const cards = node('div', 'summary-grid detail-stats');
  card(cards, 'Distance', `${format(activity.distance / 1000)} km`, 'Garmin session total');
  card(cards, 'Moving pace', `${paceLabel(activity.pace)} /100 m`, 'Session moving time / distance');
  card(cards, 'Moving / elapsed', `${time(activity.movingTime)} / ${time(activity.elapsedTime)}`, 'Not inferred from length durations');
  const rest = activity.elapsedTime >= activity.movingTime && activity.movingTime != null ? activity.elapsedTime - activity.movingTime : null;
  card(cards, 'Non-moving time', time(rest), `${format(activity.movingRatio == null ? null : activity.movingRatio * 100)}% moving; elapsed minus moving`);
  card(cards, 'Average HR', `${format(activity.heartRate)} bpm`, 'Garmin session average; not sample mean');
  if (activity.type === 'pool') card(cards, 'Strokes / SWOLF', `${format(activity.strokes)} / ${format(activity.swolf)}`, 'Garmin session summary');
  else card(cards, 'Recorded strokes', format(activity.strokes), 'Garmin session count; pool SWOLF is not applicable');
  container.append(cards);
  const metrics = node('div', 'detail-metric-chips');
  for (const [name, value, unit] of [['DPS', activity.dps, 'm/stroke'], ['SPL', activity.spl, 'strokes/length'],
    ['SPM', activity.spm, 'strokes/min'], ['LPM', activity.lpm, 'lengths/min'], ['TPL', activity.tpl, 's/length']]) {
    metrics.append(node('span', 'badge', `${name} ${format(value)} ${unit}`));
  }
  const tempo = node('span', 'badge', `Tempo ${formatTempo(activity.tempo)} s/stroke`);
  if (activity.type === 'pool') {
    metrics.append(tempo);
    container.append(metrics);
  } else {
    const openWaterMetrics = node('div', 'detail-metric-chips');
    openWaterMetrics.append(node('span', 'badge', `SPM ${format(activity.spm)} strokes/min`), tempo);
    container.append(openWaterMetrics);
  }
  if (!details.rows.length) {
    container.append(node('p', 'empty', activity.type === 'pool' ? 'No FIT lengths saved. Sync Garmin + FIT to enable length and stroke analysis.' : 'Open water has no pool lengths: stroke, SWOLF and set analysis are not applicable.'));
    return;
  }
  const overview = node('div', 'chart-grid');
  lengthRibbon(panel(overview, 'Your swim, length by length', 'Stroke colors are constant across every chart. Blank time intervals are unrecorded, not assumed to be rest.'), details.rows, details.origin);
  const mix = panel(overview, 'Stroke distance breakdown', 'Distance shares use all recorded active-length distances, including unclassified lengths. Stroke pace uses only timed lengths. SWOLF is elapsed seconds per active length + recorded strokes.');
  const recorded = details.rows.filter(r => r.active && positive(r.distance));
  const total = recorded.reduce((sum, r) => sum + r.distance, 0);
  const bar = node('div', 'stroke-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', 'Stroke distance shares; the unfilled part is unclassified recorded distance.');
  mix.append(bar);
  const values = [];
  for (const stroke of Object.keys(strokeNames)) {
    const rows = recorded.filter(r => r.stroke === stroke);
    if (!rows.length) continue;
    const distance = rows.reduce((sum, r) => sum + r.distance, 0);
    const timed = rows.filter(r => r.pace != null);
    const duration = timed.reduce((sum, r) => sum + r.duration, 0);
    const timedDistance = timed.reduce((sum, r) => sum + r.distance, 0);
    const segment = node('span', 'stroke-segment');
    segment.style.width = `${distance / total * 100}%`;
    segment.style.setProperty('--stroke-color', strokeColors[stroke]);
    segment.title = `${strokeName(stroke)} ${format(distance / total * 100)}%`;
    bar.append(segment);
    const label = node('span', 'stroke-tag', strokeName(stroke));
    label.style.setProperty('--stroke-color', strokeColors[stroke]);
    values.push([label, `${format(distance)} m`, `${format(total ? distance / total * 100 : null)}%`, rows.length, `${paceLabel(timedDistance ? duration * 100 / timedDistance : null)}/100 m`]);
  }
  table(mix, ['Stroke', 'Distance', 'Share', 'Lengths', 'Pace'], values);
  container.append(overview);
}

function intervalMetrics(values) {
  const list = node('span', 'interval-metrics');
  for (const [label, value] of values) {
    const item = node('span');
    item.append(node('small', '', label), node('strong', '', value));
    list.append(item);
  }
  return list;
}

function renderLengths(container, details) {
  container.append(node('h2', '', 'Inside the session'), node('p', 'hint', 'Sets group active lengths until a recorded rest, even if stroke changes or timestamps overlap. Unrecorded gaps are not assumed to be rests. These are not official Garmin laps or a claimed workout prescription.'));
  if (!details.rows.length) { container.append(node('p', 'empty', 'No FIT lengths are available for this activity.')); return; }
  const blocks = panel(container, 'Swim intervals', 'Expand each set for more metrics and its lengths. Metrics use recorded active lengths only; -- means unavailable. Unrecorded gaps inside sets are shown when expanded.');
  lengthRibbon(blocks, details.rows, details.origin);
  const list = node('div', 'swim-intervals');
  blocks.append(list);
  for (const block of details.intervals) {
    const offset = Number.isFinite(block.start) && details.origin != null ? time(block.start - details.origin) : '--';
    const elapsed = node('span', 'interval-offset', offset);
    if (block.kind !== 'swim') {
      const row = node('div', `interval-summary interval-${block.kind}`);
      row.append(elapsed, node('strong', '', block.kind === 'rest' ? 'Recorded rest' : 'Unrecorded gap'),
        node('span', '', time(block.duration)));
      list.append(row);
      continue;
    }
    const row = node('details', 'detected-block interval-swim');
    row.style.setProperty('--stroke-color', strokeColors[block.stroke] ?? '#78879a');
    const label = node('summary', 'interval-summary');
    const stroke = node('span', 'interval-stroke');
    stroke.append(node('strong', '', `Set ${block.number} · ${block.mixed ? 'Mixed strokes' : strokeName(block.stroke)}`),
      node('small', '', `${block.rows.length} lengths`));
    const pace = node('span', 'interval-pace');
    pace.append(node('strong', '', time(block.duration)), node('small', '', `${paceLabel(block.pace)} /100 m`));
    const m = block.metrics;
    label.append(elapsed, stroke, node('strong', '', `${format(block.distance)} m`), pace,
      intervalMetrics([['DPS (m/stroke)', format(m.dps)], ['SPM', format(m.spm)], ['Tempo (s/stroke)', formatTempo(m.tempo)], ['SWOLF', format(m.swolf)]]));
    const extra = intervalMetrics([
      ['Strokes', format(m.strokes)], ['SPL', format(m.spl)], ['TPL (s)', format(m.tpl)],
      ['LPM', format(m.lpm)], ['Efficiency', format(m.efficiency)], ['Elapsed span', time(block.elapsed)],
      ['FIT timer', time(m.timerTime)], ['HR (bpm)', format(m.heartRate)], ['HR samples', format(m.hrSamples)],
    ]);
    const ribbon = node('div', 'block-lengths');
    for (const r of block.rows) {
      const tile = node('span', 'length-tile', r.index);
      tile.tabIndex = 0;
      tile.style.setProperty('--stroke-color', strokeColors[r.stroke] ?? '#78879a');
      tile.title = `Length ${r.index} · ${strokeName(r.stroke)}: ${format(r.distance)} m · ${time(r.duration)} · ${paceLabel(r.pace)}/100 m · ${format(r.strokes)} strokes · tempo ${formatTempo(r.tempo)} s/stroke`;
      tile.setAttribute('aria-label', tile.title);
      ribbon.append(tile);
    }
    const detail = node('div', 'interval-detail');
    detail.append(extra, ribbon);
    for (const gap of block.gaps) {
      detail.append(node('p', 'hint', `Unrecorded gap at ${time(gap.start - details.origin)}: ${time(gap.duration)}. Not assumed to be rest.`));
    }
    row.append(label, detail);
    list.append(row);
  }
  const grid = node('div', 'chart-grid');
  metricChart(panel(grid, 'Pace per length', 'Lower is faster. Every point is one active FIT length; mixed styles are shown in their own colors.'), details.active, { yKey: 'pace', yLabel: 'Pace /100 m', format: paceLabel });
  metricChart(panel(grid, 'Stroke count per length', 'Recorded counts only. Missing stroke counts are not replaced with session averages.'), details.active, { yKey: 'spl', yLabel: 'Strokes / length' });
  container.append(grid);
  const data = panel(container, 'Length-level data', 'Duration and SWOLF use FIT elapsed length time. HR is the mean of recorded samples whose timestamps lie within the length, not a Garmin length summary.');
  table(data, ['#', 'Stroke / state', 'Start +min', 'Distance m', 'Duration s', 'Timer s', 'Pace /100', 'Strokes', 'DPS m', 'SPM', 'Tempo s/stroke', 'LPM', 'SWOLF', 'HR bpm', 'HR n'],
    details.rows.map(r => [r.index ?? 'Rest', r.active ? strokeName(r.stroke) : 'Recorded rest',
      format(Number.isFinite(r.start) && details.origin != null ? (r.start - details.origin) / 60 : null),
      r.active ? format(r.distance) : '0', format(r.duration), format(r.timerTime), paceLabel(r.pace),
      r.active ? format(r.strokes) : '--', format(r.dps), format(r.spm), formatTempo(r.tempo), format(r.lpm), format(r.swolf), format(r.heartRate), r.hrSamples]));
}

function renderTechnique(container, details, activity) {
  container.append(node('h2', '', 'How your technique evolves'), node('p', 'hint', 'Compare one stroke within this session and pool length. Turning technique, drills, rests and Garmin stroke-count conventions affect these metrics. Relationships are descriptive, not causal; pace/DPS/SWOLF share distance, duration and strokes mathematically.'));
  const available = Object.keys(strokeNames).filter(stroke => details.active.some(r => r.stroke === stroke));
  if (!available.length) { container.append(node('p', 'empty', 'No classified, timed pool lengths available for technique analysis.')); return; }
  const label = node('label', 'detail-style-filter', 'Analyze stroke ');
  const select = node('select');
  for (const stroke of available) {
    const option = node('option', '', strokeName(stroke));
    option.value = stroke;
    select.append(option);
  }
  label.append(select);
  const output = node('div');
  container.append(label, output);
  const render = () => {
    output.replaceChildren();
    const rows = details.active.filter(r => r.stroke === select.value && r.distance === activity.poolLength);
    output.append(node('p', 'hint', `${rows.length} ${strokeName(select.value).toLowerCase()} lengths matching the ${format(activity.poolLength)} m pool. Length charts keep the original active-length index; gaps mark intervening lengths of other strokes.`));
    const trends = node('div', 'summary-grid detail-trends');
    for (const [key, title, unit, formatter] of [['pace', 'Pace drift', '/100 m', paceLabel], ['dps', 'DPS drift', 'm/stroke', format], ['swolf', 'SWOLF drift', '', format], ['tempo', 'Tempo drift', 's/stroke', formatTempo]]) {
      const trend = lengthTrend(rows, key);
      card(trends, title, trend.change == null ? '--' : `${trend.change >= 0 ? '+' : ''}${format(trend.change)}%`,
        trend.first == null ? `${trend.n} usable lengths; at least 8 required` : `First vs last quarter medians: ${formatter(trend.first)} → ${formatter(trend.last)} ${unit} (n=${trend.n}). ${key === 'dps' ? 'Higher DPS is more distance per stroke.' : key === 'tempo' ? 'Higher tempo means slower stroke frequency.' : 'Higher means slower pace / higher SWOLF.'}`);
    }
    output.append(trends);
    const grid = node('div', 'chart-grid');
    for (const [key, title, unit, formatter] of [['pace', 'Pace evolution', 'Pace /100 m', paceLabel], ['swolf', 'SWOLF evolution', 'SWOLF', format],
      ['dps', 'Distance per stroke', 'DPS (m/stroke)', format], ['spl', 'Strokes per length', 'SPL', format],
      ['spm', 'Stroke frequency', 'SPM (strokes/min)', format], ['tempo', 'Tempo evolution', 'Tempo (s/stroke)', formatTempo], ['lpm', 'Length frequency', 'LPM (lengths/min)', format]]) {
      metricChart(panel(grid, title), rows, { yKey: key, yLabel: unit, format: formatter, maxGap: 1, color: strokeColors[select.value] });
    }
    for (const [xKey, yKey, title, xLabel, yLabel, xFormat, yFormat] of [
      ['dps', 'pace', 'Pace ↔ distance per stroke', 'DPS (m/stroke)', 'Pace /100 m', format, paceLabel],
      ['spl', 'swolf', 'Stroke count ↔ SWOLF', 'Strokes / length', 'SWOLF', format, format],
      ['heartRate', 'pace', 'HR ↔ pace', 'HR (bpm)', 'Pace /100 m', format, paceLabel]]) {
      const correlation = lengthCorrelation(rows, xKey, yKey);
      metricChart(panel(grid, title, `Pearson r: ${correlation.r == null ? 'not evaluable (need ≥5 pairs and variation)' : format(correlation.r)} · n=${correlation.n}. Dashed line is the descriptive linear fit; HR uses measured, timestamp-aligned samples only.`),
        rows, { xKey, yKey, xLabel, yLabel, xFormat, format: yFormat, scatter: true, regression: correlation, color: strokeColors[select.value] });
    }
    output.append(grid);
  };
  select.addEventListener('change', render);
  render();
}

function renderSensors(container, details, activity, dataset) {
  container.append(node('h2', '', 'The recorded signal'), node('p', 'hint', 'Actual timestamped FIT records, without interpolated HR. Breaks appear at missing values or large recording gaps. No HR zones or physiological thresholds are assumed without your personal settings.'));
  const cards = node('div', 'summary-grid');
  card(cards, 'Recorded HR range', `${format(details.hr.min)}–${format(details.hr.max)} bpm`, `${details.hr.count} valid HR samples`);
  card(cards, 'Median recorded HR', `${format(details.hr.median)} bpm`, 'Median of available samples, not time-weighted');
  card(cards, 'Session average HR', `${format(activity.heartRate)} bpm`, 'Separate Garmin summary; may differ from sample statistics');
  container.append(cards);
  const samples = details.samples.map(r => ({ ...r, minutes: (r.timestamp - details.origin) / 60,
    pace: positive(r.speed) ? 100 / r.speed : null }));
  const grid = node('div', 'chart-grid');
  metricChart(panel(grid, 'Heart rate over time', details.hr.count ? 'Recorded bpm; gaps are not bridged. Focus the dots for exact timestamp/value.' : 'No timestamped HR samples exist for this activity. The session average is not plotted as a fake curve.'),
    samples, { xKey: 'minutes', yKey: 'heartRate', xLabel: 'Minutes since first FIT timestamp', yLabel: 'HR (bpm)', maxGap: details.hr.gapLimit / 60, color: '#ee8bc5' });
  if (activity.type === 'open_water') {
    const map = panel(grid, 'Actual open-water route', 'Offline map of saved GPS coordinates; no third-party tile or location service.');
    const route = dataset.routePoints.filter(p => p.activityId === activity.id);
    if (route.length >= 2) routeMap(map, [activity], route);
    else map.append(node('p', 'empty', 'No saved GPS route is available for this activity.'));
    metricChart(panel(grid, 'Recorded pace over time', '100 / FIT speed (m/s). GPS-derived speed is noisy; zero / missing speed is not converted to pace.'),
      samples, { xKey: 'minutes', yKey: 'pace', xLabel: 'Minutes', yLabel: 'Pace /100 m', format: paceLabel, maxGap: details.hr.gapLimit / 60, color: '#9eafff' });
    metricChart(panel(grid, 'Recorded distance progression', 'FIT cumulative distance, not integrated or rescaled from map points.'),
      samples, { xKey: 'minutes', yKey: 'distance', xLabel: 'Minutes', yLabel: 'Distance (m)', maxGap: details.hr.gapLimit / 60 });
  }
  if (samples.some(r => Number.isFinite(r.temperature))) {
    metricChart(panel(grid, 'Sensor temperature', 'Device readings; not necessarily water temperature.'),
      samples, { xKey: 'minutes', yKey: 'temperature', xLabel: 'Minutes', yLabel: 'Temperature (°C)', maxGap: details.hr.gapLimit / 60, color: '#f5bc72' });
  }
  if (samples.some(r => Number.isFinite(r.cadence))) {
    metricChart(panel(grid, 'Recorded cadence', 'Raw FIT cadence values; no assumed doubling of arm strokes or conversion into pool LPM.'),
      samples, { xKey: 'minutes', yKey: 'cadence', xLabel: 'Minutes', yLabel: 'FIT cadence', maxGap: details.hr.gapLimit / 60 });
  }
  container.append(grid);
}
