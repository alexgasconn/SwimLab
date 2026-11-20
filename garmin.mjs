import { Decoder, Stream } from '@garmin/fitsdk';
import { unzipSync } from 'fflate';
import { positive, nonnegative, deriveMetrics } from './analytics.mjs';

const base = 'https://personal.connectapi.garmin.com';
const maxBytes = 32 * 1024 * 1024;
export class GarminError extends Error {
  constructor(status, context, retryAfter = null) {
    const retrySeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
    super(`Garmin HTTP ${status} (${context}). ${status === 429 ? 'Rate limit reached; wait before syncing again.'
      : status === 401 || status === 403 ? 'Check your key, expiry and permissions.' : 'The requested data could not be retrieved.'}${retrySeconds ? ` Retry after at least ${retrySeconds} seconds.` : ''}`);
    this.status = status;
  }
}

export function normalizeActivities(activities) {
  return activities.filter(a => /swim/i.test(a.activityType?.typeKey ?? '')).map(a => {
    if (!Number.isSafeInteger(a.activityId) || a.activityId <= 0) throw new Error('Garmin returned an invalid activity ID.');
    const raw = Object.fromEntries([
      'distance', 'movingDuration', 'elapsedDuration', 'duration', 'activeLengths', 'strokes',
      'poolLength', 'averageHR', 'averageSwolf', 'averageSwimCadenceInStrokesPerMinute',
      'avgStrokeDistance', 'avgStrokes', 'minTemperature', 'maxTemperature',
    ].filter(key => a[key] !== undefined).map(key => [key, a[key]]));
    return deriveMetrics({
      id: String(a.activityId), name: a.activityName ?? 'Swimming', date: a.startTimeLocal ?? null,
      type: /open_water/i.test(a.activityType.typeKey) ? 'open_water' : 'pool',
      distance: positive(a.distance), movingTime: positive(a.movingDuration),
      elapsedTime: positive(a.elapsedDuration), timerTime: positive(a.duration),
      // The list API stores pool length in centimetres; FIT uses metres.
      poolLength: positive(a.poolLength) ? a.poolLength / 100 : null,
      lengths: positive(a.activeLengths), strokes: nonnegative(a.strokes),
      heartRate: positive(a.averageHR), swolf: positive(a.averageSwolf),
      reportedSpm: positive(a.averageSwimCadenceInStrokesPerMinute),
      temperature: null, minTemperature: nonnegative(a.minTemperature), maxTemperature: nonnegative(a.maxTemperature),
      freestylePct: null, breaststrokePct: null, backstrokePct: null, butterflyPct: null, otherPct: null,
      raw,
    });
  });
}

async function request(path, authorization, fetcher, method = 'GET', binary = false) {
  const response = await fetcher(`${base}${path}`, {
    method, headers: { Authorization: authorization, Accept: binary || method === 'POST' ? '*/*' : 'application/json' },
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!response.ok || response.status === 204) throw new GarminError(response.status, binary ? 'FIT export' : method === 'POST' ? 'token' : 'activity history', response.headers.get('retry-after'));
  return response;
}

export async function connectGarmin(key, fetcher = fetch) {
  const response = await request('/personalapitoken-service/personal-api/personal-api-key/token', `ApiKey ${key}`, fetcher, 'POST');
  const token = response.headers.get('content-type')?.includes('text/plain') ? (await response.text()).trim() : await response.json();
  const accessToken = typeof token === 'string' ? token : token?.access_token ?? token?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken || /[\r\n]/.test(accessToken)) throw new Error('Garmin returned an unrecognized token response.');
  const authorization = `Bearer ${accessToken}`;
  async function historyPage(page) {
    const r = await request(`/activitylist-service/activities/search/activities?start=${page * 100}&limit=100`, authorization, fetcher);
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.some(a => !a || typeof a !== 'object')) throw new Error('Garmin returned an unrecognized activity list.');
    const owners = [...new Set(batch.map(a => a.ownerId).filter(id => id != null).map(String))];
    if (owners.length > 1) throw new Error('The history contains multiple accounts; sync cancelled.');
    return { activities: normalizeActivities(batch), owner: owners[0] ?? null, scanned: batch.length };
  }
  return {
    historyPage,
    async history() {
      const activities = [];
      const owners = new Set();
      let scanned = 0;
      let truncated = true;
      for (let page = 0; page < 50; page++) {
        const batch = await historyPage(page);
        activities.push(...batch.activities);
        scanned += batch.scanned;
        if (batch.owner) owners.add(batch.owner);
        if (batch.scanned < 100) { truncated = false; break; }
      }
      if (owners.size > 1) throw new Error('The history contains multiple accounts; sync cancelled.');
      return { activities, owner: [...owners][0] ?? null, scanned, truncated };
    },
    async fit(id) {
      const r = await request(`/download-service/files/activity/${encodeURIComponent(id)}`, authorization, fetcher, 'GET', true);
      const chunks = [];
      let size = 0;
      for await (const chunk of r.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('FIT export exceeds the 32 MB safety limit.');
        chunks.push(chunk);
      }
      return decodeFit(Buffer.concat(chunks));
    },
  };
}

export function decodeFit(bytes) {
  let fit = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = unzipSync(bytes, { filter: file => /\.fit$/i.test(file.name) && file.originalSize <= maxBytes });
    const files = Object.values(entries);
    if (files.length !== 1) throw new Error('FIT export must contain exactly one supported FIT file.');
    fit = files[0];
  }
  const decoder = new Decoder(Stream.fromByteArray(fit));
  if (!decoder.isFIT() || !decoder.checkIntegrity()) throw new Error('FIT integrity validation failed.');
  const { messages, errors } = decoder.read();
  if (errors.length) throw new Error('FIT decoding failed; incomplete lengths were not imported.');
  return extractFitMetrics(messages);
}

export function extractFitMetrics(messages) {
  const sessions = (messages.sessionMesgs ?? []).filter(s => s.sport === 'swimming');
  if (sessions.length !== 1) throw new Error('FIT must contain exactly one swimming session.');
  const session = sessions[0];
  const poolLength = positive(session.poolLength);
  const lengths = (messages.lengthMesgs ?? []).map((l, sequence) => ({
    sequence, active: l.lengthType === 'active',
    start: l.startTime instanceof Date && Number.isFinite(l.startTime.getTime()) ? l.startTime.getTime() / 1000 : null,
    duration: positive(l.totalElapsedTime), timerTime: positive(l.totalTimerTime),
    distance: l.lengthType === 'active' ? poolLength : 0,
    strokes: nonnegative(l.totalStrokes), stroke: l.swimStroke ?? 'unknown',
  }));
  const active = lengths.filter(l => l.active);
  const total = active.reduce((sum, l) => sum + (l.distance ?? 0), 0);
  const percentages = {};
  for (const stroke of ['freestyle', 'breaststroke', 'backstroke', 'butterfly']) {
    percentages[`${stroke}Pct`] = total > 0 ? active.filter(l => l.stroke === stroke).reduce((sum, l) => sum + (l.distance ?? 0), 0) / total * 100 : null;
  }
  percentages.otherPct = total > 0 ? Math.max(0, 100 - Object.values(percentages).reduce((sum, pct) => sum + pct, 0)) : null;
  const routePoints = (messages.recordMesgs ?? []).flatMap((record, sequence) => {
    if (!Number.isSafeInteger(record.positionLat) || !Number.isSafeInteger(record.positionLong)) return [];
    const lat = record.positionLat * 180 / 2147483648;
    const lon = record.positionLong * 180 / 2147483648;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    return [{ sequence, lat, lon }];
  });
  const records = (messages.recordMesgs ?? []).flatMap((record, sequence) => {
    const timestamp = record.timestamp instanceof Date ? record.timestamp.getTime() / 1000 : null;
    if (!Number.isFinite(timestamp)) return [];
    return [{
      sequence, timestamp, heartRate: positive(record.heartRate),
      distance: nonnegative(record.distance),
      speed: positive(record.enhancedSpeed) ?? positive(record.speed),
      cadence: nonnegative(record.cadence),
      temperature: typeof record.temperature === 'number' && Number.isFinite(record.temperature) ? record.temperature : null,
    }];
  });
  return {
    metrics: {
      poolLength,
      temperature: typeof session.avgTemperature === 'number' && Number.isFinite(session.avgTemperature) ? session.avgTemperature : null,
      ...percentages,
    },
    lengths,
    routePoints, records,
  };
}

export async function loadSwimming(key, fetcher = fetch) {
  const history = await (await connectGarmin(key, fetcher)).history();
  return { activities: history.activities, scanned: history.scanned, truncated: history.truncated };
}
