import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connectGarmin, GarminError } from './garmin.mjs';
import { openStore } from './store.mjs';

export { loadSwimming, normalizeActivities } from './garmin.mjs';
const origin = 'http://127.0.0.1:8787';
const safeError = error => {
  const allowed = /^(Garmin |FIT |The history |This database |Weekly history )/;
  return allowed.test(error.message) ? error.message : 'Local storage, network or response error. Check the database is writable and try again.';
};

export function createApp(fetcher = fetch, store = openStore()) {
  let job = { state: 'idle', done: 0, total: 0, errors: [], message: 'Ready to sync.' };
  async function sync(key) {
    try {
      const garmin = await connectGarmin(key, fetcher);
      key = null;
      const history = await garmin.history();
      store.saveHistory(history);
      const pending = store.pending();
      job.total = pending.length;
      job.message = `History saved. Importing ${pending.length} FIT files.`;
      for (const id of pending) {
        try {
          store.saveFit(id, await garmin.fit(id));
        } catch (error) {
          const message = safeError(error);
          const unavailable = error instanceof GarminError && [204, 404].includes(error.status);
          store.markFit(id, unavailable ? 'unavailable' : 'error', message);
          job.errors.push({ id, message });
          console.error(`FIT ${id}: ${message}`);
          if (error instanceof GarminError && [401, 403, 429].includes(error.status)) throw error;
        }
        job.done++;
        job.message = `Imported ${job.done} / ${job.total} FIT files.`;
        await delay(750);
      }
      job.state = job.errors.length ? 'partial' : 'complete';
      job.message = job.errors.length ? 'Sync finished with FIT gaps. Review import warnings; sync again to retry errors.' : 'Sync complete. Your data is saved locally.';
    } catch (error) {
      job.state = 'error';
      job.message = safeError(error);
      console.error(`Sync failed: ${job.message}`);
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    if (req.headers.host !== new URL(origin).host) { json(403, { error: 'Host not allowed. Use http://127.0.0.1:8787.' }); return; }
    try {
      if (req.method === 'GET' && req.url === '/api/data') { json(200, store.data()); return; }
      if (req.method === 'GET' && req.url === '/api/sync') { json(200, job); return; }
      if (req.method === 'POST' && ['/api/sync', '/api/review'].includes(req.url)) {
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') {
          json(403, { error: 'Request not allowed.' }); return;
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 4096) { json(413, { error: 'Request too large.' }); return; }
        }
        let data;
        try { data = JSON.parse(body); }
        catch { json(400, { error: 'Invalid JSON.' }); return; }
        if (req.url === '/api/review') {
          if (typeof data?.id !== 'string' || !/^\d+$/.test(data.id) || ![null, 'include', 'exclude'].includes(data.decision)) {
            json(400, { error: 'Invalid activity review.' }); return;
          }
          if (!store.review(data.id, data.decision)) { json(404, { error: 'Activity not found.' }); return; }
          json(200, { saved: true }); return;
        }
        if (job.state === 'running') { json(409, { error: 'A sync is already running.' }); return; }
        const key = data?.apiKey;
        if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) { json(400, { error: 'Enter a valid API key.' }); return; }
        job = { state: 'running', done: 0, total: 0, errors: [], message: 'Retrieving Garmin history...' };
        void sync(key.trim());
        json(202, job);
        return;
      }
      const files = {
        '/': ['index.html', 'text/html'],
        '/app.js': ['app.js', 'text/javascript'],
        '/charts.js': ['charts.js', 'text/javascript'],
        '/analytics.mjs': ['analytics.mjs', 'text/javascript'],
        '/style.css': ['style.css', 'text/css'],
      };
      const file = files[req.url];
      if (req.method !== 'GET' || !file) { json(404, { error: 'Route not found.' }); return; }
      const content = await readFile(new URL(file[0], import.meta.url));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` });
      res.end(content);
    } catch (error) {
      const message = safeError(error);
      console.error(`Request failed: ${message}`);
      json(500, { error: message });
    }
  });
  server.on('close', () => store.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createApp();
  server.on('error', error => { console.error(`Cannot start dashboard: ${error.message}`); process.exitCode = 1; });
  server.listen(8787, '127.0.0.1', () => console.log(`Swim analytics: ${origin}`));
}
