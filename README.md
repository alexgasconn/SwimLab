# SWIMLAB

Local-first Garmin swimming analytics, in English. Node.js **22.16+**.
No framework, chart CDN or external analytics. Uses the official Garmin FIT SDK,
fflate for Garmin's ZIP exports, and Node's built-in SQLite.

```powershell
Set-Location 'C:\path\to\SwimLab'
npm ci
npm start
```

Open <http://127.0.0.1:8787>. Paste a **Garmin Personal API** key and select
**Sync Garmin + FIT**. The first import retrieves your swim history and FIT files;
progress appears in the connection panel. Reloading the page reconnects to an
in-progress sync. Stop the server with Ctrl+C. Tests: `npm test`.
SQLite is experimental in Node 22 and may print a warning.

## Dashboard

- Separate Overview, Performance, Training patterns, Open-water routes, Personal bests
  and Swim logbook tabs. Filters are shared across analytics tabs.
- Moving pace vs distance scatterplot; pace and distance histograms.
- Session SWOLF trend and pool / open-water summaries, including counts, session
  share, average distance and pace, and pool-length breakdowns.
- Weekly distance and trailing four-week mean, **including empty weeks**.
  Monday-Sunday weeks intersecting the selected date range are displayed;
  the mean can use earlier weeks outside the view. Four weeks are required.
  The current week is incomplete and is labelled in chart tooltips.
- Monday-Sunday x 24-hour heatmap: counts **session starts** in Garmin's local
  start time, not the computer's conversion of GPS timestamps or hours swum.
- Pool / open-water, date-range and excluded-session filters affect the dashboard.
- Configurable top 3/5/10 rankings by distance, pace or SWOLF. Exact-length
  50/100/200/400 m efforts by stroke, 100/200/1000 m efforts, 100/200/400 m IM
  efforts, and longest / fastest sessions use the current filtered view. Use
  the stroke selector to explore each group independently.
- Overall stroke mix is weighted by recorded active pool-length distance in the
  filtered view. Drills, mixed and unknown lengths remain in the denominator,
  even though they are not displayed as a separate stroke. Sessions without
  recorded lengths and open-water sessions do not contribute; coverage is shown.
- Locally rendered open-water GPS routes when Garmin FIT files contain position
  records. All routes in the current view are drawn together with start/finish
  markers on the approximate offline Natural Earth coastline map. It has no streets or local
  detail, is not suitable for navigation and loads no external map tiles.
- Full metric logbook with sortable columns and distance / pool-length filters.
  These filters also apply to CSV export, but not the other dashboard views.
  Reversible per-session review and import warnings remain available.
- Demo data is explicitly synthetic and never written to SQLite.

## Metric definitions

Distance is metres; all stored durations are seconds.
**Pace = 100 x moving time / distance**, not elapsed or timer time.
Overall pace is distance-weighted, using only sessions with both metrics.
Moving ratio = moving / elapsed; SPM = strokes / moving minutes;
SPL = strokes / active lengths; DPS = distance / strokes;
TPL = moving seconds / active lengths; LPM = active lengths / moving minutes.
SPM follows the device's stroke-count convention: no assumed doubling of arm strokes.
The source-reported cadence is also retained in the database.
In particular, LPM is *not* cadence or strokes per minute.

The list API's pool length is in centimetres; decoded FIT pool length is in metres.
FIT lengths supply distance-weighted freestyle, breaststroke, backstroke and butterfly
percentages. Drills, mixed and unknown strokes remain in the denominator, so known
styles are not inflated to 100%. Open-water percentages and pool-only metrics normally stay
unavailable. Temperature is the recorded session average when present, not an
invented mean of minimum and maximum. Missing values are `NULL` / `--`.

## Efforts, not invented records

These are locally calculated efforts, **not Garmin's official personal-record service**.
Exact-distance, consecutive active FIT lengths are used, with time from the first
length's start to the last length's end. **Intervening rests count.** There is no
interpolation, estimation from session pace, or conversion of yard efforts into exact
metre records. IM requires equal butterfly / backstroke / breaststroke / freestyle
legs, in that order. Drills, mixed/unknown strokes, overlapping timestamps and
implausible length times cannot qualify. Each session contributes at most one
best effort per category, so overlapping windows cannot fill a podium.
Fastest session uses moving pace and a minimum 100 m session distance.
Record cards show the pace per 100 m for the recorded effort, including rests;
session records and rankings show the session's moving pace when available.
When lengths are unavailable, the dashboard says so instead of displaying a fake record.

## Data quality

Suspect sessions are **excluded by default, never deleted**. Review reasons and
override with Automatic / Always include / Always exclude. An optional view toggle
includes all excluded sessions; it does not make invalid FIT lengths eligible for records.

Automatic flags:

- Missing/non-positive distance, moving/elapsed time; invalid local date.
- Moving time exceeds elapsed by more than two seconds.
- Distance over 100 km; pool length outside 10-100 m.
- Moving pace below 35 seconds/100 m, above 10 min/100 m in pools, or above
  20 min/100 m in open water.
- Pool distance vs active lengths x pool length differs by more than 2% (minimum 2 m).
- Within each environment, at least eight pace observations are required for a
  robust log-pace MAD score over 4.5, also requiring a multiplicative deviation
  greater than 1.5. Zero MAD does not trigger a statistical flag.

Legitimate drills can look unusual. Thresholds are review aids, not proof of bad data;
long distances alone are not removed as statistical outliers. Original swim metrics
remain in `activities.raw_metrics`; decisions survive resync.

## SQLite & privacy

Default location: `%LOCALAPPDATA%\GarminSwim\swim.sqlite`, **outside OneDrive**.
To choose a different database, before starting:

```powershell
$env:GARMIN_DB_PATH = 'C:\private\swim.sqlite'
npm start
```

`activities` has explicit source metric, stroke percentage, review and FIT status
columns. `lengths` stores recorded swimming lengths. `swim_metrics` is a queryable
SQL view adding pace, moving ratio, SPM, SPL, DPS, TPL and LPM.
Activity IDs are primary keys; history sync upserts without duplication.
Changed source measurements invalidate cached lengths for reimport.
Account fingerprints prevent accidental mixing of two people's databases.
History scans stop at 5,000 activities across all sports, with an explicit coverage
warning if capped. Existing saved activities are not deleted when absent from a scan.
Successful FIT imports are cached; failed imports retry next sync. HTTP 204/404
exports are marked unavailable. Rate limits or authentication errors stop the sync
explicitly; already saved work remains available. A stopped import resumes on next sync.
FIT requests are sequential with a 750 ms gap. This is not a guarantee against
Garmin quotas: respect any displayed `Retry-After` delay before syncing again.

Only allowlisted swim metrics, names, local start times, pool lengths and available
open-water GPS points are persisted. No profile details, keys, access tokens or
downloaded FIT files are stored. On the first sync after upgrading, saved open-water
activities are re-imported to check for route points; unavailable FIT exports remain
visible as import warnings.
Keys/tokens live only in memory during sync. The **unencrypted database contains
personal health data and may contain precise GPS routes**: protect it and its
WAL/SHM sidecars and backups.
CSV exports also contain personal data; choose a safe download location.
The app is single-user, loopback-only, with same-origin write checks and no CORS.
It is not designed for hosting, shared computers or public network exposure.
Revoke any API key you have shared in a chat.

## Integration

The server exchanges `Authorization: ApiKey ...` at
`POST /personalapitoken-service/personal-api/personal-api-key/token`, using
`Accept: */*` because the real endpoint returns a `text/plain` token and rejects
JSON-only negotiation. Activity lists use
`GET /activitylist-service/activities/search/activities?start=0&limit=100`.
FIT exports use `GET /download-service/files/activity/{activityId}`, decoded only
after integrity validation. ZIP contents are never written to disk.
All requests go directly to `https://personal.connectapi.garmin.com`.

Program reference: <https://developer.garmin.com/gc-developer-program/overview/>.
Endpoint paths were provided from the user's Personal API documentation.
