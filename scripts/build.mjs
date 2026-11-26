#!/usr/bin/env node
// Builds the static status site from a data directory.
//
// Usage: node scripts/build.mjs --data data --out _site
//
// Output:
//   index.html            the status page
//   status.json           machine-readable summary (for nrec.no, the dashboard, ...)
//   badges/<id>.json      shields.io endpoint badges, one per checked endpoint
//   badges/overall.json
//   assets/               css, images

import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ROOT, loadConfig, readJson, writeJson, parseArgs, dayKey } from './lib/util.mjs';
import { renderPage } from '../src/page.mjs';

const args = parseArgs();
const dataDir = resolve(args.data || 'data');
const outDir = resolve(args.out || '_site');
const config = await loadConfig();
const now = new Date();

const checks = await readJson(join(dataDir, 'checks.json'), { endpoints: {} });
const news = await readJson(join(dataDir, 'news.json'), { items: [] });
const metrics = await readJson(join(dataDir, 'metrics.json'), null);

// ---- endpoints -----------------------------------------------------------
const DAYS = config.checks.keepDailyDays;
const endpoints = config.endpoints.map((ep) => {
  const e = checks.endpoints?.[ep.id];
  const latest = e?.latest || null;
  const days = [];
  let up = 0, total = 0;
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = dayKey(now.getTime() - i * 864e5);
    const d = e?.daily?.[date];
    if (d && d[1] > 0) {
      up += d[0]; total += d[1];
      days.push({ date, pct: (100 * d[0]) / d[1], checks: d[1] });
    } else {
      days.push({ date, pct: null, checks: 0 });
    }
  }
  const status = !latest ? 'unknown' : latest.ok ? 'up' : 'down';
  return {
    ...ep,
    status,
    latest,
    uptime: total ? (100 * up) / total : null,
    days,
  };
});

const known = endpoints.filter((e) => e.status !== 'unknown');
const down = known.filter((e) => e.status === 'down');
let overall;
if (!known.length) overall = { level: 'unknown', text: 'Status unknown' };
else if (!down.length) overall = { level: 'up', text: 'All systems operational' };
else if (down.length === known.length) overall = { level: 'down', text: 'Major outage' };
else overall = { level: 'partial', text: `${down.map((e) => e.name).join(', ')} not responding` };

// ---- metrics -------------------------------------------------------------
let usage = null;
if (metrics?.series?.length) {
  const s = metrics.series;
  const last = s.at(-1);
  const total = (p) => Object.values(p.instances || {}).reduce((a, b) => a + b, 0);
  usage = {
    source: metrics.source,
    updated: metrics.updated,
    tiles: [
      {
        id: 'instances', label: 'Instances', value: total(last),
        breakdown: config.regions.map((r) => ({ name: r.name, value: last.instances?.[r.id] ?? 0 })),
        series: s.map((p) => [p.date, total(p)]),
      },
      { id: 'projects', label: 'Projects', value: last.projects, series: s.map((p) => [p.date, p.projects]) },
      { id: 'users', label: 'Users', value: last.users, series: s.map((p) => [p.date, p.users]) },
    ],
  };
}

// ---- write ---------------------------------------------------------------
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(join(ROOT, 'assets'), join(outDir, 'assets'), { recursive: true });
await writeFile(join(outDir, '.nojekyll'), '');

const model = { config, now, checksUpdated: checks.updated, endpoints, overall, news, usage };
await writeFile(join(outDir, 'index.html'), renderPage(model));

// shields.io "endpoint" badges: https://shields.io/badges/endpoint-badge
const badgeColor = { up: 'brightgreen', down: 'red', partial: 'orange', unknown: 'lightgrey' };
await mkdir(join(outDir, 'badges'), { recursive: true });
for (const ep of endpoints) {
  await writeJson(join(outDir, 'badges', `${ep.id}.json`), {
    schemaVersion: 1,
    label: ep.name,
    message: { up: 'up', down: 'down', unknown: 'no data' }[ep.status],
    color: badgeColor[ep.status],
    cacheSeconds: 300,
  });
}
await writeJson(join(outDir, 'badges', 'overall.json'), {
  schemaVersion: 1,
  label: 'NREC',
  message: overall.text.toLowerCase(),
  color: badgeColor[overall.level],
  cacheSeconds: 300,
});

await writeJson(join(outDir, 'status.json'), {
  generated: now.toISOString(),
  checksUpdated: checks.updated || null,
  overall,
  endpoints: endpoints.map(({ id, name, url, status, latest, uptime }) => ({
    id, name, url, status,
    lastCheck: latest?.t || null,
    responseMs: latest?.ms ?? null,
    uptime90d: uptime === null ? null : Number(uptime.toFixed(3)),
  })),
  latestNews: (news.items || []).slice(0, 5),
});

console.log(`built ${outDir} (${overall.text})`);
