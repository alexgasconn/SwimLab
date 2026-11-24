import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMetrics, personalBests, oceanmanReadiness, oceanmanRollingVolumes } from './analytics.mjs';
import { swimmerContext } from './ai-export.mjs';

test('AI context includes all filtered sessions, records and period history without leaking unrelated data', () => {
  const asOf = new Date('2026-03-15T12:00:00');
  const activities = [
    { id: '1', name: 'Swim | <test>', date: '2026-01-05T12:00:00', type: 'open_water', distance: 1000, movingTime: 1200, elapsedTime: 1250 },
    { id: '2', name: 'Later', date: '2026-03-01T12:00:00', type: 'open_water', distance: 1000, movingTime: 1300, elapsedTime: 1350 },
  ].map(deriveMetrics);
  const records = personalBests(activities, [], Infinity);
  const content = swimmerContext({
    activities, lengths: [], records,
    columns: [['Activity', a => a.name], ['Distance', a => a.distance], ['HR', a => a.heartRate]],
    filters: { period: 'All', from: 'sin límite', to: '2026-03-15', environment: 'All', includeExcluded: false },
    coverage: '2 saved swims', demo: true, asOf,
    readiness: oceanmanReadiness(activities, asOf, []), rolling: oceanmanRollingVolumes(activities, asOf),
  });
  assert.match(content, /DATOS DE DEMOSTRACIÓN SINTÉTICOS/);
  assert.match(content, /sin aplicar los filtros propios de la tabla/);
  assert.match(content, /1000m open water \| 2 \| 1200 \| 2:00 \| 2026-01-05/);
  assert.match(content, /1000m open water \| 2026-03-01 \| 1300 \| 1200 \| 2 \| 1/);
  assert.match(content, /Swim \\\| &lt;test&gt; \| 1000 \| --/);
  assert.match(content, /Later \| 1000 \| --/);
  assert.match(content, /## Tendencias semanales/);
  assert.match(content, /## Oceanman 14K/);
  assert.match(content, /## Logbook completo \(2 sesiones\)/);
});
