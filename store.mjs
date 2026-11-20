import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { deriveMetrics } from './analytics.mjs';

export const defaultDatabase = () => process.env.GARMIN_DB_PATH
  || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'GarminSwim', 'swim.sqlite');

const fields = {
  id: 'id', name: 'name', date: 'local_start', type: 'swim_type', distance: 'distance_m',
  movingTime: 'moving_time_s', elapsedTime: 'elapsed_time_s', timerTime: 'timer_time_s',
  poolLength: 'pool_length_m', lengths: 'active_lengths', strokes: 'strokes', heartRate: 'average_hr',
  swolf: 'swolf', reportedSpm: 'reported_spm', temperature: 'temperature_c',
  minTemperature: 'min_temperature_c', maxTemperature: 'max_temperature_c',
  freestylePct: 'freestyle_pct', breaststrokePct: 'breaststroke_pct', backstrokePct: 'backstroke_pct',
  butterflyPct: 'butterfly_pct', otherPct: 'other_stroke_pct',
};
const textFields = new Set(['id', 'name', 'date', 'type']);
const fitFields = new Set(['poolLength', 'temperature', 'freestylePct', 'breaststrokePct', 'backstrokePct', 'butterflyPct', 'otherPct']);

export function openStore(path = defaultDatabase()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activities (
      ${Object.entries(fields).map(([field, column]) => `${column} ${textFields.has(field) ? 'TEXT' : 'REAL'}${field === 'id' ? ' PRIMARY KEY' : ''}`).join(',')},
      raw_metrics TEXT NOT NULL, fit_status TEXT NOT NULL DEFAULT 'pending', fit_error TEXT,
      route_status TEXT NOT NULL DEFAULT 'pending',
      records_status TEXT NOT NULL DEFAULT 'pending',
      review TEXT CHECK(review IS NULL OR review IN ('include','exclude')), imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lengths (
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL, active INTEGER NOT NULL, start_s REAL, duration_s REAL,
      timer_time_s REAL, distance_m REAL, strokes REAL, stroke TEXT,
      PRIMARY KEY(activity_id,sequence)
    );
    CREATE TABLE IF NOT EXISTS route_points (
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
      PRIMARY KEY(activity_id,sequence)
    );
    CREATE TABLE IF NOT EXISTS activity_records (
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL, timestamp_s REAL NOT NULL, heart_rate REAL,
      distance_m REAL, speed_mps REAL, cadence REAL, temperature_c REAL,
      PRIMARY KEY(activity_id,sequence)
    );
    CREATE INDEX IF NOT EXISTS activities_date ON activities(local_start);
    CREATE VIEW IF NOT EXISTS swim_metrics AS SELECT *,
      100.0 * moving_time_s / NULLIF(distance_m,0) AS pace_s_per_100m,
      1.0 * moving_time_s / NULLIF(elapsed_time_s,0) AS moving_ratio,
      60.0 * strokes / NULLIF(moving_time_s,0) AS strokes_per_minute,
      1.0 * strokes / NULLIF(active_lengths,0) AS strokes_per_length,
      1.0 * distance_m / NULLIF(strokes,0) AS distance_per_stroke_m,
      1.0 * moving_time_s / NULLIF(active_lengths,0) AS time_per_length_s,
      60.0 * active_lengths / NULLIF(moving_time_s,0) AS lengths_per_minute
      FROM activities;`);
  const activityColumns = new Set(db.prepare('PRAGMA table_info(activities)').all().map(row => row.name));
  if (!activityColumns.has('route_status')) {
    db.exec("ALTER TABLE activities ADD COLUMN route_status TEXT NOT NULL DEFAULT 'pending'; UPDATE activities SET route_status='not_applicable' WHERE swim_type='pool';");
  }
  if (!activityColumns.has('records_status')) db.exec("ALTER TABLE activities ADD COLUMN records_status TEXT NOT NULL DEFAULT 'pending';");
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const metadata = key => db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value ?? null;
  const setMetadata = (key, value) => db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  const columns = Object.values(fields);
  const upsert = db.prepare(`INSERT INTO activities (${columns.join(',')},raw_metrics,imported_at)
    VALUES (${Array(columns.length + 2).fill('?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${Object.entries(fields).filter(([f]) => f !== 'id').map(([field, column]) =>
      `${column}=${fitFields.has(field) ? `CASE WHEN activities.fit_status='complete' AND activities.raw_metrics=excluded.raw_metrics AND activities.swim_type=excluded.swim_type THEN activities.${column} ELSE excluded.${column} END` : `excluded.${column}`}`).join(',')},
      fit_status=CASE WHEN activities.raw_metrics=excluded.raw_metrics AND activities.swim_type=excluded.swim_type THEN activities.fit_status ELSE 'pending' END,
      fit_error=CASE WHEN activities.raw_metrics=excluded.raw_metrics AND activities.swim_type=excluded.swim_type THEN activities.fit_error ELSE NULL END,
      raw_metrics=excluded.raw_metrics, imported_at=excluded.imported_at`);
  return {
    path,
    close: () => db.close(),
    saveHistory(history) {
      return transaction(() => {
        const fingerprint = history.owner ? createHash('sha256').update(history.owner).digest('hex') : null;
        const existing = metadata('account');
        if (history.activities.length && !fingerprint) throw new Error('Garmin did not identify the account; refusing to mix personal databases.');
        if (existing && fingerprint && existing !== fingerprint) throw new Error('This database belongs to another Garmin account. Choose a separate GARMIN_DB_PATH.');
        if (fingerprint) setMetadata('account', fingerprint);
        for (const a of history.activities) {
          const raw = JSON.stringify(a.raw);
          const previous = db.prepare('SELECT raw_metrics,swim_type FROM activities WHERE id=?').get(a.id);
          const changed = previous && (previous.raw_metrics !== raw || previous.swim_type !== a.type);
          if (changed) {
            db.prepare('DELETE FROM lengths WHERE activity_id=?').run(a.id);
            db.prepare('DELETE FROM route_points WHERE activity_id=?').run(a.id);
            db.prepare('DELETE FROM activity_records WHERE activity_id=?').run(a.id);
          }
          upsert.run(...Object.keys(fields).map(field => a[field] ?? null), raw, new Date().toISOString());
          if (!previous || changed) {
            db.prepare('UPDATE activities SET route_status=? WHERE id=?')
              .run(a.type === 'open_water' ? 'pending' : 'not_applicable', a.id);
            db.prepare("UPDATE activities SET records_status='pending' WHERE id=?").run(a.id);
          }
        }
        setMetadata('history', JSON.stringify({ scanned: history.scanned, truncated: history.truncated, syncedAt: new Date().toISOString() }));
      });
    },
    pending() {
      return db.prepare("SELECT id FROM activities WHERE fit_status IN ('pending','error') OR (swim_type='open_water' AND route_status='pending') OR (fit_status='complete' AND records_status='pending') ORDER BY local_start DESC").all().map(row => row.id);
    },
    saveFit(id, data) {
      transaction(() => {
        db.prepare('DELETE FROM lengths WHERE activity_id=?').run(id);
        db.prepare('DELETE FROM route_points WHERE activity_id=?').run(id);
        db.prepare('DELETE FROM activity_records WHERE activity_id=?').run(id);
        const insert = db.prepare('INSERT INTO lengths VALUES (?,?,?,?,?,?,?,?,?)');
        for (const l of data.lengths) insert.run(id, l.sequence, Number(l.active), l.start, l.duration, l.timerTime, l.distance, l.strokes, l.stroke);
        const entries = Object.entries(data.metrics).filter(([field]) => fitFields.has(field));
        const activity = db.prepare('SELECT swim_type FROM activities WHERE id=?').get(id);
        if (!activity) throw new Error('Cannot save FIT data for an unknown activity.');
        const routePoints = activity.swim_type === 'open_water' ? (data.routePoints ?? []) : [];
        const routeInsert = db.prepare('INSERT INTO route_points VALUES (?,?,?,?)');
        for (const point of routePoints) routeInsert.run(id, point.sequence, point.lat, point.lon);
        const records = data.records ?? [];
        const recordInsert = db.prepare('INSERT INTO activity_records VALUES (?,?,?,?,?,?,?,?)');
        for (const record of records) recordInsert.run(id, record.sequence, record.timestamp, record.heartRate,
          record.distance, record.speed, record.cadence, record.temperature);
        db.prepare(`UPDATE activities SET ${entries.map(([field]) => `${fields[field]}=?`).join(',')}${entries.length ? ',' : ''}
          fit_status='complete',fit_error=NULL,route_status=?,records_status=? WHERE id=?`)
          .run(...entries.map(([, value]) => value), activity.swim_type !== 'open_water' ? 'not_applicable'
            : routePoints.length >= 2 ? 'complete' : 'unavailable', records.length ? 'complete' : 'unavailable', id);
      });
    },
    markFit(id, state, error) {
      db.prepare(`UPDATE activities SET fit_status=?,fit_error=?,
        route_status=CASE WHEN swim_type='open_water' AND ?='unavailable' THEN 'unavailable' ELSE route_status END
        WHERE id=?`).run(state, error, state, id);
    },
    review(id, decision) {
      return db.prepare('UPDATE activities SET review=? WHERE id=?').run(decision, id).changes;
    },
    activityRecords(id) {
      const activity = db.prepare('SELECT records_status FROM activities WHERE id=?').get(id);
      if (!activity) return null;
      const records = db.prepare('SELECT * FROM activity_records WHERE activity_id=? ORDER BY timestamp_s,sequence').all(id)
        .map(row => ({ sequence: row.sequence, timestamp: row.timestamp_s, heartRate: row.heart_rate,
          distance: row.distance_m, speed: row.speed_mps, cadence: row.cadence, temperature: row.temperature_c }));
      return { records, recordsStatus: activity.records_status };
    },
    data() {
      const activities = db.prepare('SELECT * FROM activities ORDER BY local_start DESC').all().map(row => deriveMetrics({
        ...Object.fromEntries(Object.entries(fields).map(([field, column]) => [field, row[column]])),
        review: row.review, fitStatus: row.fit_status, fitError: row.fit_error, routeStatus: row.route_status, recordsStatus: row.records_status,
      }));
      const lengths = db.prepare('SELECT * FROM lengths ORDER BY activity_id,sequence').all().map(l => ({
        activityId: l.activity_id, sequence: l.sequence, active: Boolean(l.active), start: l.start_s,
        duration: l.duration_s, timerTime: l.timer_time_s, distance: l.distance_m, strokes: l.strokes, stroke: l.stroke,
      }));
      const routePoints = db.prepare('SELECT activity_id,sequence,latitude,longitude FROM route_points ORDER BY activity_id,sequence').all()
        .map(point => ({ activityId: point.activity_id, sequence: point.sequence, lat: point.latitude, lon: point.longitude }));
      return { activities, lengths, routePoints, history: JSON.parse(metadata('history') ?? 'null') };
    },
  };
}
