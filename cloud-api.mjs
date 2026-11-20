import { createCloudStore } from './cloud-store.mjs';
import { connectGarmin } from './garmin.mjs';

let store;
function getStore() {
  if (!store) store = createCloudStore(process.env.DATABASE_URL);
  return store;
}

export function cloudHandler(endpoint, dependencies = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status, data) => res.status(status).json(data);
    try {
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (!origin || origin !== `https://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) {
          return send(403, { error: 'Request not allowed.' });
        }
      }
      const database = dependencies.store ?? getStore();
      if (endpoint === 'data' && req.method === 'GET') {
        if (req.query?.id !== undefined) {
          const id = req.query.id;
          if (Object.keys(req.query).length !== 1 || typeof id !== 'string' || !/^\d+$/.test(id)) return send(400, { error: 'Invalid activity ID.' });
          const details = await database.activityRecords(id);
          return details ? send(200, details) : send(404, { error: 'Activity not found.' });
        }
        const value = req.query?.offset ?? '0';
        if (typeof value !== 'string' || !/^\d{1,8}$/.test(value)) return send(400, { error: 'Invalid offset.' });
        return send(200, await database.data(Number(value)));
      }
      if (endpoint === 'review' && req.method === 'POST') {
        const body = req.body;
        if (typeof body?.id !== 'string' || !/^\d+$/.test(body.id) || ![null, 'include', 'exclude'].includes(body.decision)) {
          return send(400, { error: 'Invalid activity review.' });
        }
        if (!await database.review(body.id, body.decision)) return send(404, { error: 'Activity not found.' });
        return send(200, { saved: true });
      }
      if (endpoint === 'sync' && req.method === 'GET') return send(200, { ...await database.job(), mode: 'cloud' });
      if (endpoint === 'sync' && req.method === 'POST') {
        const key = dependencies.apiKey ?? process.env.GARMIN_API_KEY;
        if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) return send(503, { error: 'GARMIN_API_KEY is not configured on the server.' });
        if (req.body?.action === 'start') return send(200, { ...await database.start(), mode: 'cloud' });
        if (req.body?.action === 'step') {
          const connect = dependencies.connect ?? (() => connectGarmin(key.trim()));
          return send(200, { ...await database.step(connect), mode: 'cloud' });
        }
        return send(400, { error: 'Invalid sync action.' });
      }
      return send(405, { error: 'Method not allowed.' });
    } catch (error) {
      console.error(`Cloud request failed: ${error.message}`);
      return send(500, { error: 'Cloud storage or network error. Check server configuration and logs.' });
    }
  };
}
