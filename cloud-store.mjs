import pg from 'pg';
import { createHash } from 'node:crypto';
import { deriveMetrics } from './analytics.mjs';

const fitFields = ['poolLength', 'temperature', 'freestylePct', 'breaststrokePct', 'backstrokePct', 'butterflyPct', 'otherPct'];
const initialJob = { state: 'idle', done: 0, total: 0, message: 'Ready to sync.' };

export function createCloudStore(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });

  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [18671300]);
      await client.query(`CREATE TABLE IF NOT EXISTS swimlab_meta (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
      await client.query(`CREATE TABLE IF NOT EXISTS swimlab_activities (
        id TEXT PRIMARY KEY, source JSONB NOT NULL, raw TEXT NOT NULL,
        lengths JSONB NOT NULL DEFAULT '[]', route JSONB NOT NULL DEFAULT '[]'
      )`);
      await client.query("ALTER TABLE swimlab_activities ADD COLUMN IF NOT EXISTS records JSONB NOT NULL DEFAULT '[]'");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const getMeta = async (client, key) => (await client.query('SELECT value FROM swimlab_meta WHERE key=$1', [key])).rows[0]?.value ?? null;
  const setMeta = (client, key, value) => client.query(
    'INSERT INTO swimlab_meta(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, JSON.stringify(value)],
  );
  return {
    close: () => pool.end(),
    async job() {
      return transaction(async client => await getMeta(client, 'job') ?? initialJob);
    },
    async start() {
      return transaction(async client => {
        const job = await getMeta(client, 'job');
        if (job?.state === 'running') return job;
        const next = { state: 'running', phase: 'history', page: 0, scanned: 0, done: 0, total: 0, errors: 0, message: 'Retrieving Garmin history...' };
        await setMeta(client, 'job', next);
        return next;
      });
    },
    async step(connect) {
      return transaction(async client => {
        const job = await getMeta(client, 'job') ?? initialJob;
        if (job.state !== 'running') return job;
        try {
          const garmin = await connect();
          if (job.phase === 'history') {
            const batch = await garmin.historyPage(job.page);
            const fingerprint = batch.owner ? createHash('sha256').update(batch.owner).digest('hex') : null;
            const existing = await getMeta(client, 'account');
            if (batch.activities.length && !fingerprint) throw new Error('Garmin did not identify the account; refusing to mix personal databases.');
            if (existing && fingerprint && existing !== fingerprint) throw new Error('This database belongs to another Garmin account.');
            if (fingerprint) await setMeta(client, 'account', fingerprint);
            for (const activity of batch.activities) {
              const prior = (await client.query('SELECT source, raw, lengths, route, records FROM swimlab_activities WHERE id=$1 FOR UPDATE', [activity.id])).rows[0];
              const raw = JSON.stringify(activity.raw);
              const unchanged = prior && prior.raw === raw && prior.source.type === activity.type;
              const saved = { ...activity, review: prior?.source.review ?? null, fitStatus: unchanged ? prior.source.fitStatus : 'pending',
                fitError: unchanged ? prior.source.fitError : null, routeStatus: unchanged ? prior.source.routeStatus : activity.type === 'pool' ? 'not_applicable' : 'pending',
                recordsStatus: unchanged ? prior.source.recordsStatus ?? 'pending' : 'pending' };
              if (unchanged && prior.source.fitStatus === 'complete') {
                for (const field of fitFields) saved[field] = prior.source[field] ?? null;
              }
              delete saved.raw;
              await client.query(`INSERT INTO swimlab_activities(id,source,raw,lengths,route,records) VALUES($1,$2::jsonb,$3,$4::jsonb,$5::jsonb,$6::jsonb)
                ON CONFLICT(id) DO UPDATE SET source=excluded.source,raw=excluded.raw,lengths=excluded.lengths,route=excluded.route,records=excluded.records`,
              [activity.id, JSON.stringify(saved), raw, JSON.stringify(unchanged ? prior.lengths : []), JSON.stringify(unchanged ? prior.route : []), JSON.stringify(unchanged ? prior.records : [])]);
            }
            job.scanned += batch.scanned;
            job.page++;
            if (batch.scanned < 100 || job.page === 50) {
              await setMeta(client, 'history', { scanned: job.scanned, truncated: batch.scanned === 100, syncedAt: new Date().toISOString() });
              const pending = await client.query(`SELECT id FROM swimlab_activities
                WHERE source->>'fitStatus' IN ('pending','error') OR (source->>'type'='open_water' AND source->>'routeStatus'='pending')
                  OR (source->>'fitStatus'='complete' AND COALESCE(source->>'recordsStatus','pending')='pending')
                ORDER BY source->>'date' DESC NULLS LAST`);
              job.queue = pending.rows.map(row => row.id);
              job.total = job.queue.length;
              job.phase = 'fit';
              job.message = `History saved. Importing ${job.total} FIT files.`;
            } else {
              job.message = `Scanned ${job.scanned} activities.`;
            }
          } else if (job.queue.length) {
            const id = job.queue[0];
            const row = (await client.query('SELECT source FROM swimlab_activities WHERE id=$1 FOR UPDATE', [id])).rows[0];
            if (!row) throw new Error('A pending activity no longer exists.');
            const activity = row.source;
            try {
              const data = await garmin.fit(id);
              for (const field of fitFields) activity[field] = data.metrics[field] ?? null;
              activity.fitStatus = 'complete';
              activity.fitError = null;
              const records = data.records ?? [];
              activity.recordsStatus = records.length ? 'complete' : 'unavailable';
              const route = activity.type === 'open_water' ? data.routePoints : [];
              activity.routeStatus = activity.type === 'pool' ? 'not_applicable' : route.length >= 2 ? 'complete' : 'unavailable';
              await client.query('UPDATE swimlab_activities SET source=$2::jsonb,lengths=$3::jsonb,route=$4::jsonb,records=$5::jsonb WHERE id=$1',
                [id, JSON.stringify(activity), JSON.stringify(data.lengths), JSON.stringify(route), JSON.stringify(records)]);
            } catch (error) {
              if (![204, 404].includes(error.status)) throw error;
              activity.fitStatus = 'unavailable';
              activity.fitError = error.message;
              if (activity.type === 'open_water') activity.routeStatus = 'unavailable';
              await client.query('UPDATE swimlab_activities SET source=$2::jsonb WHERE id=$1', [id, JSON.stringify(activity)]);
              job.errors++;
            }
            job.queue.shift();
            job.done++;
            job.message = `Imported ${job.done} / ${job.total} FIT files.`;
          }
          if (job.phase === 'fit' && !job.queue.length) {
            job.state = job.errors ? 'partial' : 'complete';
            job.message = job.errors ? 'Sync finished with FIT gaps. Review import warnings.' : 'Sync complete. Data saved to PostgreSQL.';
            delete job.queue;
          }
        } catch (error) {
          if (!/^(Garmin |FIT |The history |This database )/.test(error.message)) throw error;
          job.state = 'error';
          job.message = error.message;
          delete job.queue;
        }
        await setMeta(client, 'job', job);
        return job;
      });
    },
    async review(id, decision) {
      return transaction(async client => {
        const row = (await client.query('SELECT source FROM swimlab_activities WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!row) return false;
        row.source.review = decision;
        await client.query('UPDATE swimlab_activities SET source=$2::jsonb WHERE id=$1', [id, JSON.stringify(row.source)]);
        return true;
      });
    },
    async activityRecords(id) {
      return transaction(async client => {
        const row = (await client.query('SELECT source,records FROM swimlab_activities WHERE id=$1', [id])).rows[0];
        return row ? { records: row.records, recordsStatus: row.source.recordsStatus ?? 'pending' } : null;
      });
    },
    async data(offset) {
      return transaction(async client => {
        const rows = (await client.query('SELECT id,source,lengths,route FROM swimlab_activities ORDER BY id LIMIT 11 OFFSET $1', [offset])).rows;
        const more = rows.length > 10;
        const page = rows.slice(0, 10);
        return {
          storage: 'cloud',
          activities: page.map(row => deriveMetrics(row.source)),
          lengths: page.flatMap(row => row.lengths.map(length => ({ ...length, activityId: row.id }))),
          routePoints: page.flatMap(row => row.route.map(point => ({ ...point, activityId: row.id }))),
          history: await getMeta(client, 'history'),
          nextOffset: more ? offset + 10 : null,
        };
      });
    },
  };
}
