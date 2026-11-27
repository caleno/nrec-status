#!/usr/bin/env node
// Builds the static status site from a data directory.
//
// Usage: node scripts/build.mjs --data data --out _site
//
// Output:
//   index.html            the status page
//   feed.xml              RSS feed of all messages (all sources)
//   status.json           machine-readable summary (for nrec.no, the dashboard, ...)
//   badges/<id>.json      shields.io endpoint badges, one per endpoint, plus one
//                         per service that runs in several regions (e.g. api)
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

// UptimeRobot keys (including monitor-specific ones) can read account-wide
// alert contacts, so they belong in the UPTIMEROBOT_MONITOR_KEYS secret and
// never in published files.
if (/"[a-z]?\d{6,}-[A-Za-z0-9]{10,}"/.test(JSON.stringify(config)) || config.endpoints.some((e) => 'uptimerobotKey' in e)) {
  console.error('config/site.json seems to contain an UptimeRobot API key. Remove it, regenerate the key, and put it in the UPTIMEROBOT_MONITOR_KEYS secret instead.');
  process.exit(1);
}

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
// Configured endpoints, plus UptimeRobot monitors whose key name matched no
// endpoint (shown under their UptimeRobot name until added to the config).
const DAYS = config.checks.keepDailyDays;
const regionName = (id) => config.regions.find((r) => r.id === id)?.name || id;
const guessRegion = (s) => config.regions.find((r) => new RegExp(`\\b(${r.id}|${r.name})\\b`, 'i').test(s))?.id;
const autoEndpoints = Object.entries(checks.endpoints || {})
  .filter(([, e]) => e.auto && e.monitor)
  .map(([id, e]) => ({
    id, name: e.monitor.host || e.monitor.name, description: e.monitor.name,
    region: guessRegion(`${id} ${e.monitor.name}`), impact: 'minor', url: e.monitor.host ? `https://${e.monitor.host}/` : null,
  }));

const endpoints = [...config.endpoints, ...autoEndpoints].map((ep) => {
  const e = checks.endpoints?.[ep.id];
  const latest = e?.latest || null;
  const days = [];
  let up = 0, total = 0, pctSum = 0, pctDays = 0;
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = dayKey(now.getTime() - i * 864e5);
    const pct = e?.dailyPct?.[date];
    const d = e?.daily?.[date];
    if (Number.isFinite(pct)) {
      pctSum += pct; pctDays++;
      days.push({ date, pct, checks: null });
    } else if (d && d[1] > 0) {
      up += d[0]; total += d[1];
      pctSum += (100 * d[0]) / d[1]; pctDays++;
      days.push({ date, pct: (100 * d[0]) / d[1], checks: d[1] });
    } else {
      days.push({ date, pct: null, checks: 0 });
    }
  }
  const state = latest?.state || (latest ? (latest.ok ? 'up' : 'down') : 'unknown');
  const status = { up: 'up', down: 'down', paused: 'paused' }[state] || 'unknown';
  const uptime = Number.isFinite(e?.uptime?.d90) && e.source === 'uptimerobot'
    ? e.uptime.d90
    : pctDays ? pctSum / pctDays : null;
  return {
    impact: 'core',
    ...ep,
    service: ep.service || ep.id,
    label: ep.region ? `${ep.name} (${regionName(ep.region)})` : ep.name,
    regionName: ep.region ? regionName(ep.region) : null,
    source: e?.source || null,
    interval: e?.monitor?.interval || null,
    status,
    latest,
    uptime,
    days,
  };
});

// Headline. Core services (API, dashboard) decide whether there is an
// outage; a minor one (docs, sign-up) being down is mentioned but doesn't
// make it look like running instances are affected.
const known = endpoints.filter((e) => e.status === 'up' || e.status === 'down');
const core = known.filter((e) => e.impact !== 'minor');
const coreDown = core.filter((e) => e.status === 'down');
const minorDown = known.filter((e) => e.impact === 'minor' && e.status === 'down');
let overall;
if (!known.length) overall = { level: 'unknown', text: 'Status unknown' };
else if (coreDown.length && coreDown.length === core.length) overall = { level: 'down', text: 'Major outage' };
else if (coreDown.length) overall = { level: 'partial', text: `${coreDown.map((e) => e.label).join(', ')} not responding` };
else overall = { level: 'up', text: 'All systems operational' };
// A declared incident or maintenance outranks "all operational".
if (overall.level === 'up' || overall.level === 'unknown') {
  const incident = active.find((m) => m.phase === 'ongoing');
  const maint = active.find((m) => m.phase === 'in-progress');
  if (incident) overall = { level: 'partial', text: `Ongoing incident: ${incident.title || 'see below'}` };
  else if (maint) overall = { level: 'maintenance', text: `Maintenance in progress: ${maint.title || 'see below'}` };
  else if (minorDown.length && overall.level === 'up') overall = { level: 'minor', text: `Core services operational · ${minorDown.map((e) => e.label).join(', ')} not responding` };
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
const badgeColor = { up: 'brightgreen', down: 'red', partial: 'orange', minor: 'yellow', maintenance: 'blue', paused: 'lightgrey', unknown: 'lightgrey' };
const badgeText = { up: 'up', down: 'down', partial: 'partly down', paused: 'paused', unknown: 'no data' };
await mkdir(join(outDir, 'badges'), { recursive: true });
const badge = (label, status) => ({
  schemaVersion: 1, label, message: badgeText[status], color: badgeColor[status], cacheSeconds: 300,
});
for (const ep of endpoints) {
  await writeJson(join(outDir, 'badges', `${ep.id}.json`), badge(ep.label, ep.status));
}
// One badge per service across regions, e.g. badges/api.json for api-bgo + api-osl.
const services = Map.groupBy(endpoints, (ep) => ep.service);
for (const [service, eps] of services) {
  if (eps.length < 2 || endpoints.some((ep) => ep.id === service)) continue;
  const st = eps.map((e) => e.status);
  const status = st.every((x) => x === 'up') ? 'up'
    : st.every((x) => x === 'down') ? 'down'
    : st.includes('down') ? 'partial'
    : st.includes('up') ? 'up' : 'unknown';
  await writeJson(join(outDir, 'badges', `${service}.json`), badge(eps[0].name, status));
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
  endpoints: endpoints.map(({ id, service, name, region, impact, source, status, latest, uptime }) => ({
    id, service, name, region: region || null, impact, source, status,
    lastCheck: latest?.t || null,
    since: latest?.since || null,
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
