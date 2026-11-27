# NREC status

[![API](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Fapi.json)](https://caleno.github.io/nrec-status/)
[![API BGO](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Fapi-bgo.json)](https://caleno.github.io/nrec-status/)
[![API OSL](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Fapi-osl.json)](https://caleno.github.io/nrec-status/)
[![dashboard.nrec.no](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Fdashboard.json)](https://caleno.github.io/nrec-status/)
[![access.nrec.no](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Faccess.json)](https://caleno.github.io/nrec-status/)
[![docs.nrec.no](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Fdocs.json)](https://caleno.github.io/nrec-status/)

A static status page for [NREC](https://nrec.no), meant to replace the Grafana
dashboard at status.nrec.no. It is built by GitHub Actions and served from
GitHub Pages, so it stays up when NREC itself is down.

It shows:

- **Services**: shared services (dashboard, sign-up, docs) and regional ones
  (the API in BGO and OSL), from UptimeRobot, with 90 days of daily uptime.
  Endpoints without an UptimeRobot key are checked by the workflow itself.
- **Active now**: ongoing incidents and current or planned maintenance.
- **News & issues**: messages from three sources, merged by date:
  report.nrec.no, files in [`messages/`](messages/), and GitHub issues.
- **Usage**: instances per region, projects and users. These are
  **sample numbers** until a real source is connected.

It also publishes `feed.xml` (RSS of all messages), `status.json` (a summary
other sites can read) and a
[shields.io endpoint badge](https://shields.io/badges/endpoint-badge) per
endpoint under `badges/`, used at the top of this README. A service that runs
in several regions also gets one combined badge (`api.json`: *up*, *partly
down* or *down*).

## Service status and UptimeRobot

Each endpoint in `config/site.json` has:

| Field | Meaning |
|---|---|
| `id` | Unique name, e.g. `api-bgo`. Also the name of its UptimeRobot key (below). |
| `service` | Groups the same service across regions (`api`). Defaults to `id`. |
| `region` | `bgo`, `osl`, … or left out for shared services. |
| `impact` | `core` or `minor`. Only **core** services (API, dashboard) being down changes the headline to an outage. A **minor** one (docs, sign-up) shows *Core services operational · docs.nrec.no not responding*. |
| `url` | Optional. Used for the link and for our own check when there's no UptimeRobot key. |
| `uptimerobot` | Optional. The key name, if it differs from `id`. |

**UptimeRobot keys** live in one repository secret,
`UPTIMEROBOT_MONITOR_KEYS` (Settings → Secrets and variables → Actions), one
[monitor-specific API key](https://uptimerobot.com/api/legacy/) per line:

```
api-bgo=m123456789-...
api-osl=m987654321-...
# dashboard=...
```

- Names are matched to endpoint ids, ignoring case; `_` and spaces count as `-`.
- A key whose name matches no endpoint is still shown, under its UptimeRobot
  monitor name, until you add it to the config.
- One API call per key per run (the free plan allows 10 a minute; calls are
  spaced out above 8 keys). The 90 daily bars come from the same call.
- Only what the page shows (name, status, uptime, response time, time of the
  last change) is saved. Keys and monitor settings never reach the public
  `data` branch, and keys are never logged.
- If UptimeRobot can't be reached or a key fails, that endpoint falls back to
  our own check (if it has a `url`) for that run.

## Publishing news, maintenance and incidents

There are three ways, and they can be mixed. All support Markdown, links and
emoji (typed 🎉 or as `:tada:` shortcodes).

| | Best for | How |
|---|---|---|
| **GitHub issue** | Incidents that get updates; maintenance | [New issue](../../issues/new/choose) → *Status incident*, *Planned maintenance* or *News*. Each comment becomes an update; closing the issue resolves it. Published within a minute or two. |
| **File in `messages/`** | News, planned maintenance, anything you want reviewed in a pull request | Add a `.md` or `.txt` file with a small header. See [`messages/README.md`](messages/README.md) and the `_template-*.md` files. Published when merged to `main`. |
| **report.nrec.no** | The existing tool | Unchanged; its messages are read from its RSS feed every 15 minutes. |

Issues are published only when they have one of the labels `incident`,
`maintenance` or `news` **and** were written by someone with write access to
the repository (owner, member or collaborator, or a user listed in
`issues.trustedUsers` in `config/site.json`). The same applies to each comment.
Anyone else can still open issues; they just don't appear on the page.
A leading `Incident:`, `Maintenance:` or `News:` in a title (pre-filled by the
issue forms) is dropped on the page, since the label already sets the type.
Raw HTML in issues is shown as text, and only http(s) and mailto links are kept.

Incidents and maintenance get a phase from their dates and state:
*Ongoing* / *Resolved* for incidents, *Scheduled* / *In progress* /
*Completed* for maintenance. Everything that isn't finished is shown under
**Active now**, and an ongoing incident or maintenance changes the headline
at the top when all checks are green.

## How it works

```
GitHub Actions: every 15 min, on push to main, on issue changes
  ├─ UptimeRobot monitors, or our own checks         ─┐
  ├─ fetch report.nrec.no/api/v1/status/rss           ├─► data branch (JSON)
  ├─ fetch labelled GitHub issues and comments       ─┘
  └─ build static HTML from the data + messages/ ─────► GitHub Pages
```

- `config/site.json`: endpoints (regions, impact), news feed URL, thresholds.
- `scripts/collect.mjs`: gets service status, news and issues into a data
  directory. A failed fetch keeps the last good copy.
- `scripts/lib/uptimerobot.mjs`: reads one UptimeRobot monitor per key.
- `scripts/lib/messages.mjs`: turns all three sources into one kind of message
  (Markdown, issue forms, dates, phases).
- `scripts/build.mjs` + `src/page.mjs`: render the page, feed, badges and `status.json`.
- `messages/`: message files. `.github/ISSUE_TEMPLATE/`: the issue forms.
- `assets/`: Bootstrap, `nrec.css` and the logo are copied from
  [norcams.github.io](https://github.com/norcams/norcams.github.io);
  `status.css` and `status.js` are this site's additions.
- The **`data` branch** holds collected data. It is replaced by one commit each
  run, so history doesn't grow; the JSON keeps 7 days of raw checks and 90 days
  of daily totals.

Needs Node 22. Dependencies: `marked` (Markdown) and `node-emoji`.

## Run it locally

Build from sample data (no network needed). It includes example issues and
files, dated relative to today, so every kind of message shows up:

```bash
npm install
```

```bash
npm run sample && npm run serve
```

Or collect live data and build from that:

```bash
npm run collect && npm run build && npm run serve
```

Then open http://localhost:8000.

## Setup on GitHub

1. Settings → Pages → Source: **GitHub Actions**.
2. The workflow runs on push to `main`, every 15 minutes, and on demand from
   the Actions tab.
3. To serve it as status.nrec.no: set the custom domain under Settings → Pages
   and point a `CNAME` record for status.nrec.no to `caleno.github.io`, then
   update `siteUrl` in `config/site.json` and the badge URLs above.

## Metrics: the contract

`metrics.json` is the one file a real metrics source has to produce. The
source can be Keystone, Graphite, Gnocchi or a new `/stats` endpoint on
report.nrec.no; the site doesn't care.

```json
{
  "updated": "2026-11-26T13:00:00Z",
  "source": "report.nrec.no",
  "series": [
    { "date": "2026-11-26", "users": 2489, "projects": 1312,
      "instances": { "bgo": 1576, "osl": 1852 } }
  ]
}
```

`series` is one entry per day, oldest first; the last entry is shown as the
current value. Until it exists, the workflow uses `sample-data/metrics.json`
and the page labels the numbers "Sample data".

## Open questions

- **Metrics source**: a public, aggregate-only `/stats` endpoint on
  report.nrec.no would let the workflow fetch metrics like it fetches news,
  with no internal cron job.
- **Which source to keep**: files and issues both work now. Running all
  three long term means three places to look; picking one or two is simpler.
- **report.nrec.no JSON API**: `GET /api/v1/status` returns HTTP 500 because
  the response (a list) doesn't match its OpenAPI spec (an object), so this
  site reads the RSS feed instead.
- **Fresher updates**: the page only changes when the workflow runs, and
  GitHub's schedule is unreliable. An UptimeRobot webhook or a cron job on an
  NREC server could start the workflow instead.
