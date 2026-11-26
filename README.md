# NREC status

[![api.nrec.no](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Fapi.json)](https://caleno.github.io/nrec-status/)
[![dashboard.nrec.no](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Fdashboard.json)](https://caleno.github.io/nrec-status/)
[![access.nrec.no](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Faccess.json)](https://caleno.github.io/nrec-status/)
[![docs.nrec.no](https://img.shields.io/endpoint?url=https%3A%2F%2Fcaleno.github.io%2Fnrec-status%2Fbadges%2Fdocs.json)](https://caleno.github.io/nrec-status/)

A static status page for [NREC](https://nrec.no), meant to replace the Grafana
dashboard at status.nrec.no. It is built by GitHub Actions and served from
GitHub Pages, so it stays up when NREC itself is down.

It shows:

- **Services**: the four public endpoints, checked from outside NREC every
  15 minutes, with 90 days of daily uptime.
- **News & issues**: messages from report.nrec.no (its RSS feed).
- **Usage**: instances per region, projects and users. These are
  **sample numbers** until a real source is connected.

It also publishes `status.json` (a summary other sites can read) and a
[shields.io endpoint badge](https://shields.io/badges/endpoint-badge) per
endpoint under `badges/`, used at the top of this README.

## How it works

```
GitHub Actions, every 15 min and on push to main
  ├─ check api / dashboard / access / docs .nrec.no  ─┐
  ├─ fetch report.nrec.no/api/v1/status/rss           ├─► data branch (JSON)
  └─ build static HTML from the data ─────────────────┴─► GitHub Pages
```

- `config/site.json`: endpoints to check, news feed URL, regions, thresholds.
- `scripts/collect.mjs`: runs the checks and fetches news into a data directory.
  A failed news fetch keeps the last good copy.
- `scripts/build.mjs` + `src/page.mjs`: render the page, badges and `status.json`.
- `assets/`: Bootstrap, `nrec.css` and the logo are copied from
  [norcams.github.io](https://github.com/norcams/norcams.github.io);
  `status.css` and `status.js` are this site's additions.
- The **`data` branch** holds collected data. It is replaced by one commit each
  run, so history doesn't grow; the JSON keeps 7 days of raw checks and 90 days
  of daily totals.

No dependencies besides Node 22.

## Run it locally

Build from sample data (no network needed):

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
- **Richer messages** (emoji, links, formatting, maintenance windows with
  start/end and affected regions): could move to Markdown files in this repo
  or GitHub Issues. Plain messages with emoji and links already render.
- **report.nrec.no JSON API**: `GET /api/v1/status` returns HTTP 500 because
  the response (a list) doesn't match its OpenAPI spec (an object), so this
  site reads the RSS feed instead.
- **api.nrec.no check URL**: set to Keystone on port 5000 (`/v3`). It was not
  possible to verify from the development environment; confirm on the first
  workflow run.
