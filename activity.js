import { activityAnalysis, lengthTrend, lengthCorrelation, correlationMatrix, positive } from './analytics.mjs';
import { metricChart, lengthRibbon, routeMap, paceLabel, strokeColors, strokeNames, correlationMatrixChart } from './charts.js';

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
  const heading = node('div', 'detail-panel-heading');
  heading.append(node('span', 'panel-kicker', 'GRÁFICO'), node('h3', '', title));
  result.append(heading);
  if (note) result.append(node('p', 'hint', note));
  const content = node('div', 'detail-chart');
  result.append(content);
  container.append(result);
  return content;
}
function chartLegend(container, items) {
  const legend = node('div', 'detail-chart-legend');
  for (const [color, label] of items) {
    const item = node('span');
    const dot = node('i');
    dot.style.background = color;
    item.append(dot, document.createTextNode(label));
    legend.append(item);
  }
  container.append(legend);
}
function insightCard(container, label, value, note, tone = '') {
  const result = node('article', `activity-insight${tone ? ` ${tone}` : ''}`);
  result.append(node('span', '', label), node('strong', '', value), node('small', '', note));
  container.append(result);
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
  hero.append(title);
  const quick = node('div', 'activity-quick');
  quick.append(
    node('span', 'badge', `${format(activity.distance / 1000)} km`),
    node('span', 'badge', `${paceLabel(activity.pace)} /100 m`),
    node('span', 'badge', `${format(activity.movingRatio == null ? null : activity.movingRatio * 100)}% en movimiento`),
  );
  hero.append(quick);
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
  renderExecutiveReadout(container, activity, details, dataset.activities);
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
  for (const [key, label] of [['summary', 'Resumen'], ['lengths', 'Cronología'], ['technique', 'Técnica y relaciones'], ['sensors', 'Sensores y GPS']]) {
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

function renderExecutiveReadout(container, activity, details, savedActivities) {
  const wrapper = node('section', 'activity-executive panel');
  const heading = node('div', 'activity-executive-heading');
  heading.append(node('p', 'eyebrow', 'LECTURA RÁPIDA'), node('h2', '', 'Qué cuenta esta sesión'));
  wrapper.append(heading);
  const insights = node('div', 'activity-insights');
  const lengthDistance = details.active.reduce((sum, row) => sum + (row.distance ?? 0), 0);
  const coverage = activity.distance > 0 ? lengthDistance / activity.distance * 100 : null;
  const longest = details.blocks.reduce((best, block) => !best || block.distance > best.distance ? block : best, null);
  const comparable = savedActivities.filter(a => a.type === activity.type && a.pace > 0);
  const sorted = comparable.map(a => a.pace).sort((a, b) => a - b);
  const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
  const paceDelta = median && activity.pace ? (activity.pace / median - 1) * 100 : null;
  insightCard(insights, 'Continuidad', activity.movingRatio == null ? '--' : `${format(activity.movingRatio * 100)}%`,
    'Tiempo en movimiento / tiempo total. Incluye pausas y series.', activity.movingRatio >= .7 ? 'positive' : 'attention');
  insightCard(insights, 'Cobertura FIT', coverage == null ? '--' : `${format(coverage)}%`,
    activity.type === 'pool' ? 'Distancia de largos activos / total de sesión.' : 'Los OW no tienen largos de piscina.', coverage != null && coverage >= 90 ? 'positive' : '');
  insightCard(insights, 'Bloque más largo', longest ? `${format(longest.distance)} m` : '--',
    longest ? `${time(longest.duration)} activos · ${paceLabel(longest.pace)} /100 m` : 'Sin bloques de largos detectados.');
  insightCard(insights, 'Ritmo relativo', paceDelta == null ? '--' : `${paceDelta >= 0 ? '+' : ''}${format(paceDelta)}%`,
    median ? `Frente a la mediana ${activity.type === 'pool' ? 'de piscina' : 'OW'} (${paceLabel(median)} /100 m); negativo es más rápido.` : 'Sin sesiones comparables.',
    paceDelta != null && paceDelta <= 0 ? 'positive' : paceDelta > 5 ? 'attention' : '');
  wrapper.append(insights);
  const dominant = Object.keys(strokeNames).map(stroke => ({
    stroke, distance: details.active.filter(row => row.stroke === stroke)
      .reduce((sum, row) => sum + (row.distance ?? 0), 0),
  })).sort((a, b) => b.distance - a.distance)[0];
  const readout = node('p', 'activity-takeaway');
  if (activity.type === 'pool' && dominant?.distance && details.active.length >= 8) {
    const rows = details.active.filter(row => row.stroke === dominant.stroke && row.distance === activity.poolLength);
    const pace = lengthTrend(rows, 'pace'), dps = lengthTrend(rows, 'dps');
    readout.textContent = pace.change == null || dps.change == null
      ? 'Hay largos medidos, pero todavía faltan suficientes repeticiones comparables para leer el desgaste dentro de la sesión.'
      : `En ${strokeName(dominant.stroke).toLowerCase()}, el último cuarto fue ${Math.abs(pace.change).toFixed(1)}% ${pace.change >= 0 ? 'más lento' : 'más rápido'} y la distancia por brazada cambió un ${Math.abs(dps.change).toFixed(1)}% ${dps.change >= 0 ? 'al alza' : 'a la baja'}. Úsalo como señal descriptiva, no como diagnóstico técnico.`;
  } else if (activity.type === 'open_water') {
    readout.textContent = 'En aguas abiertas prioriza continuidad, ritmo de movimiento y evolución temporal/GPS; los indicadores de largos y SWOLF no son aplicables.';
  } else {
    readout.textContent = 'Esta sesión no contiene suficientes largos FIT para separar fatiga, eficiencia y técnica de forma fiable.';
  }
  wrapper.append(readout);
  container.append(wrapper);
}

function renderSummary(container, activity, details) {
  const cards = node('div', 'summary-grid detail-stats');
  card(cards, 'Distancia', `${format(activity.distance / 1000)} km`, 'Total Garmin de la sesión');
  card(cards, 'Ritmo en movimiento', `${paceLabel(activity.pace)} /100 m`, 'Tiempo en movimiento / distancia');
  card(cards, 'Movimiento / total', `${time(activity.movingTime)} / ${time(activity.elapsedTime)}`, 'No se calcula desde los largos FIT');
  const rest = activity.elapsedTime >= activity.movingTime && activity.movingTime != null ? activity.elapsedTime - activity.movingTime : null;
  card(cards, 'Tiempo no móvil', time(rest), `${format(activity.movingRatio == null ? null : activity.movingRatio * 100)}% en movimiento`);
  card(cards, 'FC media', `${format(activity.heartRate)} bpm`, 'Resumen Garmin; no es la media temporal estimada');
  if (activity.type === 'pool') card(cards, 'Brazadas / SWOLF', `${format(activity.strokes)} / ${format(activity.swolf)}`, 'Resumen Garmin de la sesión');
  else card(cards, 'Brazadas registradas', format(activity.strokes), 'SWOLF de piscina no aplicable en OW');
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
  const ribbon = panel(overview, 'Línea temporal de la sesión', 'Cada bloque es un largo activo o descanso registrado. Los huecos blancos son tiempo sin registro, no descanso asumido. Los colores identifican el estilo.');
  lengthRibbon(ribbon, details.rows, details.origin);
  chartLegend(ribbon, [['#54dbcb', 'Nado activo'], ['#516072', 'Descanso registrado'], ['#f5bc72', 'Tiempo sin registro']]);
  const mix = panel(overview, 'Distribución de distancia por estilo', 'Cada porcentaje usa metros activos registrados. El ritmo sólo incluye largos con tiempo válido; SWOLF es tiempo del largo + brazadas.');
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
  container.append(node('h2', '', 'Cronología real de la sesión'), node('p', 'hint', 'Un bloque agrupa largos activos hasta un descanso registrado, aunque cambie el estilo. Un hueco no es automáticamente descanso y estos bloques no son vueltas oficiales Garmin.'));
  if (!details.rows.length) { container.append(node('p', 'empty', 'No hay largos FIT disponibles para esta actividad.')); return; }
  const blocks = panel(container, 'Bloques, largos y descansos', 'Abre cada bloque para ver sus métricas. El tiempo activo excluye descansos; los huecos sin registro aparecen indicados al expandir.');
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
  const pacePanel = panel(grid, 'Ritmo por largo', 'Menos es más rápido. Puntos = largos exactos; línea dorada = media móvil de 5 largos. Separa estilos por color.');
  metricChart(pacePanel, details.active, { yKey: 'pace', yLabel: 'Ritmo /100 m', format: paceLabel, rollingWindow: 5 });
  chartLegend(pacePanel, [['#54dbcb', 'Valor de cada largo'], ['#f5bc72', 'Tendencia de 5 largos']]);
  const strokesPanel = panel(grid, 'Brazadas por largo', 'Brazadas registradas por el dispositivo; los valores ausentes no se rellenan con medias de sesión.');
  metricChart(strokesPanel, details.active, { yKey: 'spl', yLabel: 'Brazadas / largo', rollingWindow: 5 });
  chartLegend(strokesPanel, [['#54dbcb', 'Valor de cada largo'], ['#f5bc72', 'Tendencia de 5 largos']]);
  container.append(grid);
  const data = panel(container, 'Datos exactos por largo', 'Duración y SWOLF usan tiempo FIT del largo. FC es la media de muestras situadas dentro del intervalo, no un resumen Garmin de largo.');
  table(data, ['#', 'Stroke / state', 'Start +min', 'Distance m', 'Duration s', 'Timer s', 'Pace /100', 'Strokes', 'DPS m', 'SPM', 'Tempo s/stroke', 'LPM', 'SWOLF', 'HR bpm', 'HR n'],
    details.rows.map(r => [r.index ?? 'Rest', r.active ? strokeName(r.stroke) : 'Recorded rest',
      format(Number.isFinite(r.start) && details.origin != null ? (r.start - details.origin) / 60 : null),
      r.active ? format(r.distance) : '0', format(r.duration), format(r.timerTime), paceLabel(r.pace),
      r.active ? format(r.strokes) : '--', format(r.dps), format(r.spm), formatTempo(r.tempo), format(r.lpm), format(r.swolf), format(r.heartRate), r.hrSamples]));
}

function renderTechnique(container, details, activity) {
  container.append(node('h2', '', 'Evolución técnica y relaciones'), node('p', 'hint', 'Compara un estilo y una longitud de piscina dentro de la misma sesión. Puntos = largos; línea dorada = media móvil. DPS, ritmo, SWOLF y tempo comparten fórmulas, así que las relaciones se interpretan como señales descriptivas y nunca como causa.'));
  const available = Object.keys(strokeNames).filter(stroke => details.active.some(r => r.stroke === stroke));
  if (!available.length) { container.append(node('p', 'empty', 'No classified, timed pool lengths available for technique analysis.')); return; }
  const label = node('label', 'detail-style-filter', 'Analizar estilo ');
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
    output.append(node('p', 'hint', `${rows.length} largos de ${strokeName(select.value).toLowerCase()} a ${format(activity.poolLength)} m. Los gráficos conservan el índice original; los huecos son largos de otros estilos.`));
    const trends = node('div', 'summary-grid detail-trends');
    for (const [key, title, unit, formatter] of [['pace', 'Pace drift', '/100 m', paceLabel], ['dps', 'DPS drift', 'm/stroke', format], ['swolf', 'SWOLF drift', '', format], ['tempo', 'Tempo drift', 's/stroke', formatTempo]]) {
      const trend = lengthTrend(rows, key);
      card(trends, title, trend.change == null ? '--' : `${trend.change >= 0 ? '+' : ''}${format(trend.change)}%`,
        trend.first == null ? `${trend.n} usable lengths; at least 8 required` : `First vs last quarter medians: ${formatter(trend.first)} → ${formatter(trend.last)} ${unit} (n=${trend.n}). ${key === 'dps' ? 'Higher DPS is more distance per stroke.' : key === 'tempo' ? 'Higher tempo means slower stroke frequency.' : 'Higher means slower pace / higher SWOLF.'}`);
    }
    output.append(trends);
    const grid = node('div', 'chart-grid');
    for (const [key, title, unit, formatter] of [['pace', 'Evolución del ritmo', 'Ritmo /100 m', paceLabel], ['swolf', 'Evolución de SWOLF', 'SWOLF', format],
      ['dps', 'Distancia por brazada', 'DPS (m/brazada)', format], ['spl', 'Brazadas por largo', 'SPL', format],
      ['spm', 'Frecuencia de brazada', 'SPM (brazadas/min)', format], ['tempo', 'Evolución del tempo', 'Tempo (s/brazada)', formatTempo], ['lpm', 'Frecuencia de largos', 'LPM (largos/min)', format]]) {
      const chart = panel(grid, title, key === 'pace'
        ? 'Menor es más rápido. Línea dorada: media móvil de 5 largos.'
        : key === 'tempo' ? 'Mayor tempo = ciclo de brazada más lento según el recuento del dispositivo.'
          : key === 'dps' ? 'Mayor = más metros por cada brazada registrada.'
            : 'Línea dorada: media móvil de 5 largos; compara dentro del mismo estilo y piscina.');
      metricChart(chart, rows, { yKey: key, yLabel: unit, format: formatter, maxGap: 1, color: strokeColors[select.value], rollingWindow: 5 });
      chartLegend(chart, [[strokeColors[select.value], 'Largo medido'], ['#f5bc72', 'Media móvil 5 largos']]);
    }
    for (const [xKey, yKey, title, xLabel, yLabel, xFormat, yFormat] of [
      ['dps', 'pace', 'Ritmo ↔ distancia por brazada', 'DPS (m/brazada)', 'Ritmo /100 m', format, paceLabel],
      ['spl', 'swolf', 'Brazadas ↔ SWOLF', 'Brazadas / largo', 'SWOLF', format, format],
      ['heartRate', 'pace', 'FC ↔ ritmo', 'FC (bpm)', 'Ritmo /100 m', format, paceLabel]]) {
      const correlation = lengthCorrelation(rows, xKey, yKey);
      metricChart(panel(grid, title, `Pearson r: ${correlation.r == null ? 'not evaluable (need ≥5 pairs and variation)' : format(correlation.r)} · n=${correlation.n}. Dashed line is the descriptive linear fit; HR uses measured, timestamp-aligned samples only.`),
        rows, { xKey, yKey, xLabel, yLabel, xFormat, format: yFormat, scatter: true, regression: correlation, color: strokeColors[select.value] });
    }
    output.append(grid);
    const matrixPanel = node('article', 'panel detail-panel correlation-panel');
    const matrixHeading = node('div', 'detail-panel-heading');
    matrixHeading.append(node('span', 'panel-kicker', 'MATRIZ COMPLETA'), node('h3', '', 'Dónde se concentran las relaciones'));
    matrixPanel.append(matrixHeading, node('p', 'hint', 'Todas las métricas medibles del largo. Busca asociaciones fuertes, pero separa siempre variables que comparten fórmula. -- significa menos de 5 pares válidos o valores sin variación.'));
    const correlationContainer = node('div', 'correlation-matrix');
    const definitions = [
      ['distance', 'Distancia', 'm'], ['duration', 'Duración', 'Dur'], ['timerTime', 'Timer FIT', 'Timer'],
      ['pace', 'Ritmo', 'Pace'], ['strokes', 'Brazadas', 'Braz'], ['spm', 'Brazadas/min', 'SPM'],
      ['tempo', 'Tempo', 'Tempo'], ['spl', 'Brazadas/largo', 'SPL'], ['dps', 'Metros/brazada', 'DPS'],
      ['tpl', 'Tiempo/largo', 'TPL'], ['lpm', 'Largos/min', 'LPM'], ['swolf', 'SWOLF', 'SWOLF'],
      ['heartRate', 'FC alineada', 'FC'], ['efficiency', 'Swim index', 'Index'],
    ].map(([key, label, shortLabel]) => ({ key, label, shortLabel }));
    const matrixRows = rows.map(row => ({ ...row,
      efficiency: row.pace > 0 && row.dps > 0 ? 100 / row.pace * row.dps : null,
    }));
    correlationMatrixChart(correlationContainer, correlationMatrix(matrixRows, definitions),
      `Correlaciones de ${strokeName(select.value)}`);
    matrixPanel.append(correlationContainer);
    output.append(matrixPanel);
  };
  select.addEventListener('change', render);
  render();
}

function renderSensors(container, details, activity, dataset) {
  container.append(node('h2', '', 'La señal realmente registrada'), node('p', 'hint', 'Muestras FIT con tiempo real; no se interpola FC. Los cortes indican datos ausentes o grandes huecos de grabación. Sin zonas personales configuradas, no se inventan umbrales fisiológicos.'));
  const cards = node('div', 'summary-grid');
  card(cards, 'Rango de FC registrada', `${format(details.hr.min)}–${format(details.hr.max)} bpm`, `${details.hr.count} muestras válidas`);
  card(cards, 'Mediana de FC', `${format(details.hr.median)} bpm`, 'Mediana de muestras, no ponderada por tiempo');
  card(cards, 'FC media de sesión', `${format(activity.heartRate)} bpm`, 'Resumen Garmin separado; puede diferir');
  container.append(cards);
  const samples = details.samples.map(r => ({ ...r, minutes: (r.timestamp - details.origin) / 60,
    pace: positive(r.speed) ? 100 / r.speed : null }));
  const grid = node('div', 'chart-grid');
  metricChart(panel(grid, 'Frecuencia cardiaca en el tiempo', details.hr.count ? 'Bpm real. Los huecos no se unen y cada punto muestra su valor al pasar el cursor o recibir foco.' : 'No existen muestras temporales de FC. La media de sesión no se dibuja como una curva falsa.'),
    samples, { xKey: 'minutes', yKey: 'heartRate', xLabel: 'Minutos desde el primer registro', yLabel: 'FC (bpm)', maxGap: details.hr.gapLimit / 60, color: '#ee8bc5' });
  if (activity.type === 'open_water') {
    const map = panel(grid, 'Ruta de aguas abiertas', 'Mapa offline de coordenadas guardadas; no se consultan servicios externos.');
    const route = dataset.routePoints.filter(p => p.activityId === activity.id);
    if (route.length >= 2) routeMap(map, [activity], route);
    else map.append(node('p', 'empty', 'No saved GPS route is available for this activity.'));
    metricChart(panel(grid, 'Ritmo GPS en el tiempo', '100 / velocidad FIT. Menor es más rápido. El GPS puede oscilar; velocidad cero o ausente no se convierte en ritmo.'),
      samples, { xKey: 'minutes', yKey: 'pace', xLabel: 'Minutos desde el primer registro', yLabel: 'Ritmo /100 m', format: paceLabel, maxGap: details.hr.gapLimit / 60, color: '#9eafff' });
    metricChart(panel(grid, 'Progresión de distancia', 'Distancia acumulada FIT; no se recalcula a partir del mapa. La pendiente representa distancia ganada por minuto.'),
      samples, { xKey: 'minutes', yKey: 'distance', xLabel: 'Minutos desde el primer registro', yLabel: 'Distancia (m)', maxGap: details.hr.gapLimit / 60 });
  }
  if (samples.some(r => Number.isFinite(r.temperature))) {
    metricChart(panel(grid, 'Temperatura del sensor', 'Lectura del dispositivo; puede no equivaler a la temperatura del agua.'),
      samples, { xKey: 'minutes', yKey: 'temperature', xLabel: 'Minutos desde el primer registro', yLabel: 'Temperatura (°C)', maxGap: details.hr.gapLimit / 60, color: '#f5bc72' });
  }
  if (samples.some(r => Number.isFinite(r.cadence))) {
    metricChart(panel(grid, 'Cadencia FIT registrada', 'Valor bruto del archivo FIT; no se dobla ni se convierte en LPM de piscina.'),
      samples, { xKey: 'minutes', yKey: 'cadence', xLabel: 'Minutos desde el primer registro', yLabel: 'Cadencia FIT', maxGap: details.hr.gapLimit / 60 });
  }
  container.append(grid);
}
