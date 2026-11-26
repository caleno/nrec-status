#!/usr/bin/env node
// Generates sample-data/ so the site can be built and previewed without
// network access: mock usage metrics and 90 days of mock check history.
// News comes from a saved snapshot of the report.nrec.no feed.
//
// Usage: node scripts/make-sample.mjs

import { join } from 'node:path';
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
const endpoints = {};
for (const ep of config.endpoints) {
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
  const latest = { t: now.toISOString(), ok: true, code: 200, ms: recent.at(-1)[2] };
  endpoints[ep.id] = { latest, recent, daily };
}
// Show what a current outage looks like on one endpoint.
endpoints.dashboard.latest = { t: now.toISOString(), ok: false, code: 503, ms: 1204 };
await writeJson(join(out, 'checks.json'), { updated: now.toISOString(), endpoints }, false);

console.log('wrote sample-data/metrics.json and sample-data/checks.json');
