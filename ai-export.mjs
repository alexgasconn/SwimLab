import { localDate, personalBestHistory, strokeMix, trainingSummary, weeklyMetrics, weeklyTrend } from './analytics.mjs';
import { paceLabel } from './charts.js';

const text = value => String(value ?? '--').replaceAll('\\', '\\\\').replaceAll('|', '\\|')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\r\n]+/g, ' ');
const number = value => typeof value === 'number' && Number.isFinite(value)
  ? String(Math.round(value * 100) / 100) : '--';
const table = (headers, rows) => [
  `| ${headers.map(text).join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map(row => `| ${row.map(text).join(' | ')} |`),
].join('\n');

export function swimmerContext({ activities, lengths, records, columns, filters, coverage, demo, asOf, readiness, rolling }) {
  const summary = trainingSummary(activities);
  const mix = strokeMix(activities, lengths);
  const totalTime = activities.reduce((sum, activity) => sum + (activity.movingTime ?? 0), 0);
  const totalElapsed = activities.reduce((sum, activity) => sum + (activity.elapsedTime ?? 0), 0);
  const paced = activities.filter(activity => activity.distance > 0 && activity.movingTime > 0);
  const paceDistance = paced.reduce((sum, activity) => sum + activity.distance, 0);
  const overallPace = paceDistance ? paced.reduce((sum, activity) => sum + activity.movingTime, 0) * 100 / paceDistance : null;
  const sections = [
    '# Contexto de natación para IA',
    `Generado: ${asOf.toISOString()}. ${demo ? 'DATOS DE DEMOSTRACIÓN SINTÉTICOS.' : 'Datos personales: revisa el contenido antes de compartirlo.'}`,
    '## Instrucciones para la IA\nAnaliza este perfil de natación usando únicamente los datos proporcionados. Identifica tendencias, fortalezas, limitaciones y oportunidades de entrenamiento; distingue hechos de hipótesis y no inventes datos. Pide contexto adicional cuando sea necesario. No interpretes estas métricas como un diagnóstico médico.',
    `## Alcance y calidad\n- Periodo: ${text(filters.period)}; desde ${text(filters.from)} hasta ${text(filters.to)} (fechas locales).\n- Entorno: ${text(filters.environment)}. Sesiones excluidas: ${filters.includeExcluded ? 'incluidas' : 'omitidas'}.\n- Se ocultan las sesiones con distancia registrada inferior a 500 m. El logbook de este informe contiene todas las sesiones que cumplen los filtros generales, sin aplicar los filtros propios de la tabla.\n- ${text(coverage)}\n- "--" significa dato no disponible, no cero. Los datos pueden estar incompletos; no se incluyen coordenadas GPS ni series de sensores FIT.`,
    `## Resumen\n- Sesiones: ${summary.totalSessions}\n- Distancia registrada: ${number((summary.pool.distance + summary.openWater.distance) / 1000)} km\n- Tiempo en movimiento registrado: ${number(totalTime)} s\n- Tiempo total transcurrido registrado: ${number(totalElapsed)} s\n- Ritmo medio en movimiento, ponderado por distancia: ${paceLabel(overallPace)} /100 m (${paced.length} sesiones con distancia y tiempo disponibles).`,
  ];
  const summaryRows = [['Piscina', summary.pool], ['Aguas abiertas', summary.openWater],
    ...summary.poolLengths.map(row => [row.length == null ? 'Piscina sin longitud' : `Piscina ${number(row.length)} m`, row])];
  sections.push('## Resumen por entorno y longitud de piscina\nEl ritmo es ponderado por distancia; las demás medias usan las sesiones con datos disponibles.\n' +
    table(['Entorno', 'Sesiones', 'Distancia m', 'Media m', 'Ritmo /100 m', 'Movimiento medio s', 'FC media bpm',
      'SPM', 'DPS m/brazada', 'SPL', 'TPL s', 'LPM', 'SWOLF', 'Índice de nado'],
    summaryRows.map(([name, row]) => [name, row.sessions, number(row.distance), number(row.averageDistance),
      paceLabel(row.averagePace), number(row.averageMovingTime), number(row.averageHeartRate), number(row.averageSpm),
      number(row.averageDps), number(row.averageSpl), number(row.averageTpl), number(row.averageLpm),
      number(row.averageSwolf), number(row.averageEfficiency)])));
  sections.push(`## Estilos en piscina\n${number(mix.total)} m de largos activos registrados en ${mix.sessions} de ${mix.poolSessions} sesiones de piscina. Incluye largos no clasificados; no incluye aguas abiertas.\n` +
    table(['Estilo', 'Distancia m', 'Porcentaje'], mix.strokes.map(row => [row.stroke, number(row.distance), number(row.percentage)])));
  const metrics = Object.keys(weeklyMetrics);
  const weekly = new Map();
  for (const metric of metrics) {
    for (const week of weeklyTrend(activities, asOf, metric)) {
      if (filters.to && week.date > filters.to) continue;
      if (!weekly.has(week.date)) weekly.set(week.date, { date: week.date, partial: week.partial });
      weekly.get(week.date)[metric] = week.value;
    }
  }
  sections.push('## Tendencias semanales\nSemanas desde el lunes; distancia total en km (cero si no hay sesión). Ritmo es media de sesiones en segundos/100 m; técnica: medias de sesiones de piscina. La semana actual está incompleta.\n' +
    table(['Inicio', 'Incompleta', ...metrics.map(metric => weeklyMetrics[metric].label)],
      [...weekly.values()].map(week => [week.date, week.partial ? 'sí' : 'no', ...metrics.map(metric => number(week[metric]))])));
  const categories = Object.entries(records).filter(([key]) => key !== 'attempts');
  sections.push('## Personal bests\nPiscina: esfuerzos exactos de largos FIT, incluyendo descansos, un mejor esfuerzo por sesión; IM en orden mariposa/espalda/braza/crol. Aguas abiertas: actividades completas dentro de ±7% de la distancia, clasificadas por tiempo en movimiento; el ritmo usa la distancia real. Son cálculos locales, no récords oficiales de Garmin.\n' +
    table(['Categoría', 'Intentos o sesiones válidas', 'Mejor tiempo s', 'Ritmo /100 m', 'Fecha', 'Actividad', 'Distancia real m'],
      categories.map(([key, entries]) => {
        const best = entries[0];
        return [key, records.attempts[key], number(best?.value), paceLabel(best?.pace),
          best?.date, best?.id, number(best?.distance)];
      })));
  const history = categories.flatMap(([category, entries]) => personalBestHistory(entries, 'month').map(row =>
    [category, row.date, number(row.entry.value), number(row.best.value), row.entry.id, row.best.id]));
  sections.push('## Evolución mensual de personal bests\nMejor tiempo del mes y mejor acumulado hasta ese mes dentro de los filtros; los meses sin esfuerzos se omiten.\n' +
    table(['Categoría', 'Mes', 'Mejor mensual s', 'Mejor acumulado s', 'Actividad mensual', 'Actividad acumulada'], history));
  sections.push('## Oceanman 14K\nEsta sección usa todo el historial guardado, independientemente de los filtros de fecha y entorno, respetando la inclusión de excluidas. Es un indicador de entrenamiento, no una evaluación clínica.\n' +
    `Índice: ${number(readiness.score)}%; cobertura evaluable: ${number(readiness.evidenceWeight)}%; checks superados: ${readiness.completed}.\n` +
    table(['Check', 'Estado', 'Valor', 'Progreso %', 'Peso %', 'Base', 'Descripción'],
      readiness.checks.map(check => [check.title, check.status, check.display, number(check.progress), check.weight, check.base, check.description])) +
    '\n\n' + table(['Ventana días', 'Distancia km', 'Objetivo km', 'Progreso %'],
      rolling.map(row => [row.days, number(row.actualKm), number(row.targetKm), number(row.progress)])));
  sections.push(`## Logbook completo (${activities.length} sesiones)\nTiempos de sesión en horas:minutos:segundos; ritmo en minutos:segundos por 100 m. FC = frecuencia cardíaca; SPM = brazadas/minuto en movimiento; SPL = brazadas/largo; DPS = metros/brazada; TPL = segundos en movimiento/largo; LPM = largos/minuto en movimiento. Los motivos de revisión son indicadores, no pruebas de error.\n` +
    table(columns.map(([title]) => title), [...activities]
      .sort((a, b) => localDate(b.date) - localDate(a.date))
      .map(activity => columns.map(([, get]) => get(activity)))));
  return sections.join('\n\n') + '\n';
}
