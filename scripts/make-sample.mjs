#!/usr/bin/env node
// Generates sample-data/ so the site can be built and previewed without
// network access: mock usage metrics, 90 days of mock check history, and
// example GitHub issues and message files (dated relative to today, so the
// "Active now" section always has something to show).
// News from report.nrec.no comes from a saved snapshot of its feed.
//
// Usage: node scripts/make-sample.mjs

import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { ROOT, loadConfig, writeJson, dayKey } from './lib/util.mjs';

const config = await loadConfig();
const out = join(ROOT, 'sample-data');
const now = new Date();

// Deterministic pseudo-random numbers so the sample stays stable.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// --- metrics.json: the contract a future metrics source must fill -------
const days = 90;
const series = [];
let users = 2310, projects = 1265, bgo = 1480, osl = 1820;
for (let i = days - 1; i >= 0; i--) {
  users += Math.round(rand() * 4);
  projects += Math.round(rand() * 2 - 0.4);
  bgo = Math.max(0, bgo + Math.round(rand() * 30 - 14));
  osl = Math.max(0, osl + Math.round(rand() * 34 - 16));
  series.push({
    date: dayKey(now.getTime() - i * 864e5),
    users, projects,
    instances: { bgo, osl },
  });
}
await writeJson(join(out, 'metrics.json'), {
  updated: now.toISOString(),
  source: 'mock',
  series,
});

// --- checks.json --------------------------------------------------------
// Regional endpoints look like UptimeRobot data (daily percentages and
// uptime ratios); the rest look like our own checks (counts per day).
const endpoints = {};
for (const ep of config.endpoints) {
  if (ep.region) {
    const dailyPct = {};
    for (let i = days - 1; i >= 0; i--) {
      dailyPct[dayKey(now.getTime() - i * 864e5)] = rand() < 0.05 ? Number((100 - rand() * 8).toFixed(3)) : 100;
    }
    const vals = Object.values(dailyPct);
    const avg = (n) => Number((vals.slice(-n).reduce((a, b) => a + b, 0) / n).toFixed(3));
    endpoints[ep.id] = {
      source: 'uptimerobot',
      monitor: { id: 800000000 + endpoints.length, name: `NREC ${ep.name} ${ep.region.toUpperCase()}`, host: 'api.nrec.no:5000', interval: 300 },
      latest: { t: now.toISOString(), ok: true, state: 'up', ms: Math.round(150 + rand() * 200), since: new Date(now.getTime() - 9 * 864e5).toISOString() },
      uptime: { d1: avg(1), d7: avg(7), d30: avg(30), d90: avg(90) },
      dailyPct,
    };
    continue;
  }
  const daily = {};
  for (let i = days - 1; i >= 0; i--) {
    const total = i === 0 ? now.getUTCHours() * 4 + 1 : 96;
    let up = total;
    if (rand() < 0.05) up -= Math.ceil(rand() * 12); // an occasional bad day
    daily[dayKey(now.getTime() - i * 864e5)] = [up, total];
  }
  const recent = [];
  for (let i = 7 * 96; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 15 * 6e4).toISOString();
    recent.push([t, 1, Math.round(300 + rand() * 400), 200]);
  }
  const latest = { t: now.toISOString(), ok: true, state: 'up', code: 200, ms: recent.at(-1)[2] };
  endpoints[ep.id] = { source: 'probe', latest, recent, daily };
}
// Show what an outage looks like: the API in Oslo (core) and docs (minor).
endpoints['api-osl'].latest = {
  t: now.toISOString(), ok: false, state: 'down', ms: null,
  since: new Date(Math.floor(now.getTime() / 6e4) * 6e4 - 47 * 6e4).toISOString(), error: 'Connection Timeout',
};
endpoints.docs.latest = { t: now.toISOString(), ok: false, state: 'down', code: 502, ms: 840 };
await writeJson(join(out, 'checks.json'), { updated: now.toISOString(), endpoints }, false);

// --- issues.json: what collect.mjs stores for labelled GitHub issues -------
const iso = (ms) => new Date(ms).toISOString();
const hour = 36e5, day = 864e5;
const repo = `https://github.com/${config.repo}`;
// "YYYY-MM-DD HH:MM" in Oslo time, as a person would type it in an issue form.
const local = (ms) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(ms));
const t0 = Math.floor(now.getTime() / (15 * 6e4)) * 15 * 6e4;

await writeJson(join(out, 'issues.json'), {
  updated: now.toISOString(),
  repo: config.repo,
  items: [
    {
      number: 103,
      title: 'Incident: Slow volume attach in Oslo',
      body: `### Summary\n\nAttaching **block storage volumes** to instances in OSL takes several minutes. Running instances and existing volumes are not affected. :hourglass_flowing_sand:\n\n### Regions\n\n- [ ] Bergen (BGO)\n- [X] Oslo (OSL)\n\n### Services\n\n- [ ] Compute\n- [X] Block storage\n- [ ] Object storage\n- [ ] Network\n- [ ] DNS\n- [ ] Dashboard\n- [ ] API\n- [ ] Access\n\n### Start\n\n${local(t0 - 2 * hour)}`,
      labels: ['incident'],
      state: 'open',
      created_at: iso(t0 - 100 * 6e4),
      closed_at: null,
      html_url: `${repo}/issues/103`,
      author: 'nrec-ops',
      comments: [
        { body: 'We have found the cause, a degraded storage node, and are moving load away from it.', created_at: iso(t0 - 60 * 6e4), author: 'nrec-ops' },
        { body: 'Attach times are improving. Next update within an hour.', created_at: iso(t0 - 20 * 6e4), author: 'nrec-ops' },
      ],
    },
    {
      number: 102,
      title: 'Maintenance: dashboard and API upgrade',
      body: `### Summary\n\nWe are upgrading OpenStack. The dashboard and API will be unavailable during the window.\n\n- Running instances are **not** affected\n- Plan changes to your infrastructure before or after the window\n\nSee the [documentation](https://docs.nrec.no) for details.\n\n### Start\n\n${local(t0 + 12 * day)}\n\n### End\n\n${local(t0 + 12 * day + 4 * hour)}\n\n### Regions\n\n- [X] Bergen (BGO)\n- [X] Oslo (OSL)\n\n### Services\n\n- [ ] Compute\n- [ ] Block storage\n- [ ] Object storage\n- [ ] Network\n- [ ] DNS\n- [X] Dashboard\n- [X] API\n- [ ] Access`,
      labels: ['maintenance'],
      state: 'open',
      created_at: iso(t0 - 1 * day),
      closed_at: null,
      html_url: `${repo}/issues/102`,
      author: 'nrec-ops',
      comments: [],
    },
    {
      number: 101,
      title: 'DNS updates delayed',
      body: `### Summary\n\nChanges to DNS records took up to 30 minutes to appear.\n\n### Services\n\n- [X] DNS\n\n### Start\n\n${local(t0 - 6 * day - 3 * hour)}`,
      labels: ['incident'],
      state: 'closed',
      created_at: iso(t0 - 6 * day - 2.5 * hour),
      closed_at: iso(t0 - 6 * day),
      html_url: `${repo}/issues/101`,
      author: 'nrec-ops',
      comments: [
        { body: 'Fixed :white_check_mark: The DNS service was restarted and the backlog has been processed.', created_at: iso(t0 - 6 * day), author: 'nrec-ops' },
      ],
    },
    {
      number: 100,
      title: 'GPU flavors now available in Oslo :rocket:',
      body: 'New **vGPU flavors** are available in OSL. Read how to request access in the [GPU guide](https://docs.nrec.no/).',
      labels: ['news'],
      state: 'open',
      created_at: iso(t0 - 3 * day),
      closed_at: null,
      html_url: `${repo}/issues/100`,
      author: 'nrec-ops',
      comments: [],
    },
  ],
});

// --- messages/: example files ---------------------------------------------
await mkdir(join(out, 'messages'), { recursive: true });
const d = (ms) => local(ms).slice(0, 10);
await writeFile(join(out, 'messages', 'example-maintenance.md'), `---
title: Network maintenance in Bergen
type: maintenance
date: ${local(t0 - 2 * day)}
start: ${local(t0 + 4 * day)}
end: ${local(t0 + 4 * day + 2 * hour)}
regions: [bgo]
services: [network]
---

Short network interruptions (under a minute) are expected while we replace
switches in **Bergen** :wrench:
`);
await writeFile(join(out, 'messages', 'example-note.txt'), `---
title: Christmas support hours
type: info
date: ${d(t0 - 4 * day)}
---

Support will be limited between 23 December and 2 January. :christmas_tree:
Urgent problems can still be reported to support@nrec.no and we will respond as soon as we can.

More at https://docs.nrec.no
`);

console.log('wrote sample-data/: metrics, checks, issues and example messages');
