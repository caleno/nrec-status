#!/usr/bin/env node
// Builds the static status site from a data directory.
//
// Usage: node scripts/build.mjs --data data --out _site
//
// Output:
//   index.html            the status page
//   feed.xml              RSS feed of all messages (all sources)
//   status.json           machine-readable summary (for nrec.no, the dashboard, ...)
//   badges/<id>.json      shields.io endpoint badges, one per checked endpoint
//   badges/overall.json
//   assets/               css, images

import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ROOT, loadConfig, readJson, writeJson, parseArgs, dayKey, escapeHtml } from './lib/util.mjs';
import { loadFileMessages, fromReport, fromIssue, phaseOf } from './lib/messages.mjs';
import { renderPage } from '../src/page.mjs';

const args = parseArgs();
const dataDir = resolve(args.data || 'data');
const outDir = resolve(args.out || '_site');
const config = await loadConfig();
const now = new Date();

const checks = await readJson(join(dataDir, 'checks.json'), { endpoints: {} });
const news = await readJson(join(dataDir, 'news.json'), { items: [] });
const metrics = await readJson(join(dataDir, 'metrics.json'), null);
const issues = await readJson(join(dataDir, 'issues.json'), { items: [] });

// ---- messages: report.nrec.no + files in the repo + GitHub issues ---------
const tz = config.timezone;
const repoUrl = `https://github.com/${config.repo}`;
const fileOpts = { tz, repoUrl, repoPath: config.messages.dir };
const messages = [
  ...fromReport(news.items),
  ...await loadFileMessages(join(ROOT, config.messages.dir), fileOpts),
  // Extra message files that belong to a data set (used by sample-data/).
  ...await loadFileMessages(join(dataDir, 'messages'), { ...fileOpts, repoUrl: null }),
  ...(issues.items || []).map((is) => fromIssue(is, {
    tz, labels: config.issues.labels, regions: config.regions, services: config.services,
  })),
]
  .filter((m) => m.timestamp)
  .map((m) => ({ ...m, phase: phaseOf(m, now) }))
  .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

// Shown at the top: ongoing incidents, maintenance in progress or coming up.
const active = messages
  .filter((m) => ['ongoing', 'in-progress', 'scheduled'].includes(m.phase))
  .sort((a, b) => (a.start || a.timestamp).localeCompare(b.start || b.timestamp));
const sourceErrors = [
  news.lastError && { source: 'report.nrec.no', ...news.lastError },
  issues.lastError && { source: 'GitHub issues', ...issues.lastError },
].filter(Boolean);

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
// A declared incident or maintenance outranks "all operational".
if (overall.level === 'up' || overall.level === 'unknown') {
  const incident = active.find((m) => m.phase === 'ongoing');
  const maint = active.find((m) => m.phase === 'in-progress');
  if (incident) overall = { level: 'partial', text: `Ongoing incident: ${incident.title || 'see below'}` };
  else if (maint) overall = { level: 'maintenance', text: `Maintenance in progress: ${maint.title || 'see below'}` };
}

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

const model = { config, now, checksUpdated: checks.updated, endpoints, overall, messages, active, sourceErrors, usage };
await writeFile(join(outDir, 'index.html'), renderPage(model));

// shields.io "endpoint" badges: https://shields.io/badges/endpoint-badge
const badgeColor = { up: 'brightgreen', down: 'red', partial: 'orange', maintenance: 'blue', unknown: 'lightgrey' };
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
  active: active.map(summary),
  latest: messages.slice(0, 10).map(summary),
});

function summary(m) {
  return {
    id: m.id, source: m.source, type: m.type, phase: m.phase, title: m.title,
    published: m.timestamp, start: m.start, end: m.end,
    regions: m.regions, services: m.services, url: m.url,
  };
}

// RSS feed with every source, so subscribers don't need report.nrec.no's too.
const feedItems = messages.slice(0, 50).map((m) => {
  const plain = m.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const title = m.title || (plain.length > 90 ? plain.slice(0, 87) + '…' : plain);
  const updates = m.updates.map((u) => `<p><strong>Update ${new Date(u.timestamp).toUTCString()}:</strong></p>${u.html}`).join('');
  return `    <item>
      <title>${escapeHtml(title)}</title>
      <link>${escapeHtml(m.source === 'issue' ? m.url : `${config.siteUrl}#${m.id.replace(/[^\w-]/g, '-')}`)}</link>
      <guid isPermaLink="false">${escapeHtml(m.id)}</guid>
      <category>${escapeHtml(m.type)}</category>
      <pubDate>${new Date(m.timestamp).toUTCString()}</pubDate>
      <description>${escapeHtml(m.html + updates)}</description>
    </item>`;
}).join('\n');
await writeFile(join(outDir, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(config.title)}</title>
    <link>${escapeHtml(config.siteUrl)}</link>
    <description>News, maintenance and incidents for NREC</description>
    <language>en</language>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
${feedItems}
  </channel>
</rss>
`);

console.log(`built ${outDir} (${overall.text})`);
