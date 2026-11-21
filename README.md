# SWIMLAB

Local-first Garmin swimming analytics. The main dashboard is in English; the
Oceanman 14K preparation tab is in Spanish. Node.js **22.16+**.
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

SwimLab opens directly on the swim dashboard and syncs swimming activities only.
Sessions with a recorded distance below 500 m are hidden throughout the app,
including records and Oceanman, without deleting stored activities. Sessions
with an unknown distance remain available for data-quality review.

- Separate Overview, Performance, Training patterns, Open-water routes, Personal bests,
  Swim logbook and Oceanman 14K tabs.
- Timeframe, environment and excluded-session controls are in the collapsible
  filter section above the dashboard. CSV export remains in the header.
  The global date and environment filters apply to the existing analytics; Oceanman
  uses all saved dates and swim types, while respecting the excluded-session toggle.
- Moving pace vs distance scatterplot; pace and distance histograms.
- Session SWOLF trend and pool / open-water summaries, including counts, session
  share, distance, pace, moving time, heart rate and available technique averages,
  plus pool-length breakdowns. Pace is distance-weighted; other averages use
  measured sessions. Pool-length metrics are not applicable to open water.
- Weekly trends for distance, pace, DPS, SPL, SWOLF, TPL, efficiency and SPM.
  Distance is a weekly total and includes empty weeks as zero. Other metrics
  average measured sessions in each week; their trailing four-week means skip
  missing weeks. Technique uses pool sessions only. Efficiency is the swim index
  (moving speed in m/s × DPS in m/stroke). Weeks start on Monday, and the mean
  can use earlier weeks outside the selected date range. Four weeks are required.
  The current week is incomplete and is labelled in chart tooltips.
- Monday-Sunday x 24-hour heatmap: counts **session starts** in Garmin's local
  start time, not the computer's conversion of GPS timestamps or hours swum.
- Pool / open-water, date-range and excluded-session filters affect the dashboard.
- Configurable top 3/5/10 personal-best selector for exact-length efforts by stroke: sprint
  (40/50/80/100 m), middle distance (200/400/500 m), and long distance
  (800/1000/1500/2000 m), plus 100/200/400 m individual medley. Results use
  the current filtered view and recorded pool lengths only.
  Open-water records use whole activities within ±7% of 750/1000/1500/1852
  (nautical mile)/3000/5000 m, ranked by moving time. Actual distance and
  moving pace are shown; shorter activities within a range can rank faster.
- Overall stroke mix is weighted by recorded active pool-length distance in the
  filtered view. Drills, mixed and unknown lengths remain in the denominator,
  even though they are not displayed as a separate stroke. Sessions without
  recorded lengths and open-water sessions do not contribute; coverage is shown.
- Locally rendered open-water GPS routes when Garmin FIT files contain position
  records. All routes in the current view are drawn together with start/finish
  markers on the approximate offline Natural Earth coastline map. It has no streets or local
  detail, is not suitable for navigation and loads no external map tiles.
- Full metric logbook with sortable columns and distance / pool-length filters;
  FIT status, exclusion flags and review controls remain outside the table.
  These filters also apply to CSV export, but not the other dashboard views.
  Reversible per-session review and import warnings remain available.
- Oceanman tab with the supplied 35-week plan, weekday distance, swim-distance
  summaries, four rolling-volume targets, weighted readiness checks and daily /
  weekly / monthly readiness history. It analyzes the full saved history and
  respects the global excluded-session toggle; plan weekly volumes are shown in km.
  Daily distance cells share a blue heat scale across all 35 weeks; zero and
  future values are uncolored. The cumulative-deficit column is no longer used.
- Oceanman **Garmin v3** is a training-evidence index, not medical advice, a validated
  physiological model or a probability of finishing. Weights: long session 15%,
  recent open-water endurance 25%, weekly volume 25%, continuity 15%,
  consistency 10%, FIT technical stability 10%. Missing evidence adds no points
  and its weight is not redistributed; the evaluable weight is shown separately.
  The Lago d'Orta June climate panel is a static reference supplied for planning,
  not live or official race-condition data.
- Demo data is explicitly synthetic and never written to SQLite.

## Activity lab

Click an activity's ID, date or name in the logbook, a podium date, or a point in
the pace/SWOLF charts or a route on the map to open its dedicated `#activity=<id>` page. Links can be
copied and reloaded; Back returns to the previous dashboard tab and its filters.
The detail page shows the selected activity even if it is excluded from analytics.

Four internal tabs keep the analysis readable:
- Overview: session totals, stroke distance shares and a timestamped length/rest ribbon.
- Sets & lengths: a chronological, expandable list of detected sets and recorded rests,
  with unrecorded gaps identified separately. Sets show DPS, SPM and mean SWOLF
  at a glance, plus stroke count, SPL, TPL, LPM, swim index, timing and sample-weighted
  heart rate when expanded. Stroke-derived set metrics require recorded counts for
  every length; missing values are not estimated. The tab also has pace/stroke charts and
  a detailed table including duration, timer, DPS, SPM, LPM, SWOLF and aligned HR.
- Technique & trends: per-stroke/pool-length charts, first/last-quarter medians
  (minimum eight measured lengths), and descriptive Pearson correlations
  (minimum five varying pairs). Shared metric formulas are not evidence of causation.
- HR & GPS: actual FIT HR samples, recording gaps, sample statistics, optional
  device temperature and open-water route, recorded speed/pace and distance.

FIT sensor records are saved separately in SQLite/PostgreSQL and fetched only for
the opened activity, not with every dashboard page. The next **Sync Garmin + FIT**
also enriches previously completed FIT caches once; an export with no timed records
is marked unavailable and is not repeatedly downloaded for missing HR.
Opening detail never contacts Garmin. Missing HR is explicitly reported: a session
average never becomes an invented temporal curve or personalized HR zones.

Length SWOLF is elapsed length seconds + recorded strokes; it may differ from the
Garmin summary. Length HR averages only samples in `[start, end)` and is not
time-weighted. Block boundaries come from rest, stroke changes, >15-second gaps,
missing/invalid lengths and overlaps; blocks are **inferred, not official Garmin laps**.
Blank timeline intervals are unrecorded, not assumed to be rest. OW pace is
`100 / recorded speed` and remains susceptible to GPS noise. Synthetic sensor
samples are available only in the clearly labelled demo.

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
Each distance card also shows the number of valid, non-overlapping attempts in the
current filtered view.
Fastest session uses moving pace and a minimum 100 m session distance.
Record cards highlight total effort time (including rests) and show pace per 100 m.
Whole-session records and rankings highlight elapsed time and show moving pace
separately when available. The ranking criteria are unchanged.
When lengths are unavailable, the dashboard says so instead of displaying a fake record.

## Oceanman Garmin v3

Long session, endurance, continuity and technique use the preceding 90 calendar days;
volume and consistency use the last eight **complete Monday-Sunday weeks**, with
unrecorded weeks counting as zero. The final targets remain 20 km/week and 10 km
open water, not the current phase's weekly plan target. History is recomputed with
this model at each saved session date and today, using no later sessions; timestamps
on the chart use a real date scale. History is not a record of past model versions.

- Long session replaces the former 14K projection: maximum recent pool/OW session
  distance with valid timing, >=1.5 km and >=70% moving/total time. Progress is
  distance / 5 km, capped at 100%. All strokes contribute, FIT is not required.
  This can include intervals and does not predict race time or uninterrupted endurance.
- OW endurance is the longest recent >=2 km session with valid timing and >=70%
  moving/total time. Old records and long rested sessions do not complete the check.
  The 70% minimum permits up to 30% recorded non-moving time; it is a relaxed
  evidence threshold, not proof of uninterrupted swimming.
- Continuity uses a median of at least three complete >=1.5 km pool/OW sessions
  with valid timing, including every style and planned rests between intervals.
  Progress runs from zero at 50% moving/total to 100% at 70%.
- Session freestyle stability replaces technical stability under continuous fatigue:
  last five eligible sessions (at least three), each with >=400 m and >=16 valid
  freestyle lengths. First/last quarters of those lengths are compared **within
  the same session, stroke and pool length**, even with intervening rests or styles.
  Lengths must have valid non-overlapping timestamps, plausible pace (30-900 s/100 m),
  the recorded pool length, and positive strokes; invalid lengths are omitted.
  This describes session stability, not continuous fatigue; workout intensity,
  warm-up, drills, wall push-offs and rests can change the result.
  Pace slowdown and DPS loss must each be <=5%; the worse deterioration drives
  progress from 100% at <=5% to zero at >=15%. These are explicit heuristic
  tolerances, not physiological thresholds. DPS, SPL, LPM and SWOLF are displayed
  by pool length as supporting evidence, not duplicate scores. No absolute
  SWOLF/SPL target or cross-pool comparison is used. Heart-rate averages alone no
  longer generate an "efficiency" score across dissimilar swims.

These checks cannot measure fueling, navigation, cold tolerance, recovery or the
actual race conditions; volume windows are distance totals, not a clinical ATL model.

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
