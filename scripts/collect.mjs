#!/usr/bin/env node
// Collects status data into a data directory:
//   checks.json  - service status: UptimeRobot monitors (UPTIMEROBOT_MONITOR_KEYS)
//                  with our own outside-in checks as the fallback
//   news.json    - status messages from report.nrec.no
//   issues.json  - GitHub issues labelled incident / maintenance / news
//
// Usage: node scripts/collect.mjs --data data [--only checks|news|issues]
//
// Runs in GitHub Actions on a schedule. Each step is independent: if
// report.nrec.no is unreachable, the previous news.json is kept and the
// error is recorded, so the page still builds.

import { join } from 'node:path';
import { loadConfig, readJson, writeJson, parseArgs, dayKey } from './lib/util.mjs';
import { parseRss } from './lib/rss.mjs';
import { parseKeys, keyName, fetchMonitor } from './lib/uptimerobot.mjs';

const args = parseArgs();
const dataDir = args.data || 'data';
const only = args.only;
const config = await loadConfig();

async function probe(url, timeoutMs) {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'nrec-status-check/1.0' },
    });
    // Drain the body so the connection is released.
    await res.arrayBuffer().catch(() => {});
    const ms = Math.round(performance.now() - start);
    return { ok: res.status < 400, code: res.status, ms };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    const error = err.name === 'TimeoutError' ? `timeout after ${timeoutMs} ms` : (err.cause?.code || err.message);
    return { ok: false, code: 0, ms, error };
  }
}

async function collectChecks() {
  const path = join(dataDir, 'checks.json');
  const prev = await readJson(path, { endpoints: {} });
  const now = new Date();
  const t = now.toISOString();
  const { timeoutMs, retries, keepRecentDays, keepDailyDays } = config.checks;
  const recentCutoff = now.getTime() - keepRecentDays * 864e5;
  const dailyCutoff = dayKey(now.getTime() - keepDailyDays * 864e5);

  // 1. UptimeRobot, one call per monitor key. The free plan allows 10
  //    requests a minute, so space the calls out when there are many.
  const keys = parseKeys(process.env.UPTIMEROBOT_MONITOR_KEYS);
  const fromUr = new Map();
  if (keys.length) console.log(`uptimerobot: ${keys.length} monitor keys: ${keys.map(([n]) => n).join(', ')}`);
  for (const [i, [name, key]] of keys.entries()) {
    if (i && keys.length > 8) await new Promise((r) => setTimeout(r, 6500));
    try {
      fromUr.set(name, await fetchMonitor(key, { days: keepDailyDays, now }));
    } catch (err) {
      console.warn(`uptimerobot: ${name}: ${err.message}`);
    }
  }

  // 2. Our own checks, for endpoints UptimeRobot didn't cover this run.
  const configured = new Set(config.endpoints.map((ep) => ep.id));
  const toProbe = config.endpoints.filter((ep) => !fromUr.has(keyName(ep.uptimerobot || ep.id)) && ep.url);
  const probed = new Map(await Promise.all(toProbe.map(async (ep) => {
    let r = await probe(ep.url, timeoutMs);
    // Retry once before declaring an endpoint down, to avoid flapping on
    // a single dropped connection.
    for (let i = 0; i < retries && !r.ok; i++) r = await probe(ep.url, timeoutMs);
    return [ep.id, r];
  })));

  const endpoints = {};
  const ids = [...config.endpoints.map((ep) => [ep.id, keyName(ep.uptimerobot || ep.id)]),
    // Monitor keys that match no endpoint in the config still get shown.
    ...[...fromUr.keys()].filter((n) => !config.endpoints.some((ep) => keyName(ep.uptimerobot || ep.id) === n)).map((n) => [n, n])];
  for (const [id, urName] of ids) {
    const e = { recent: [], daily: {}, ...prev.endpoints[id] };
    const ur = fromUr.get(urName);
    const r = probed.get(id);
    if (ur) {
      Object.assign(e, ur);
      if (!configured.has(id)) e.auto = true;
      log(id, 'uptimerobot', ur.latest.state, ur.latest.ms, ur.latest.error);
    } else if (r) {
      e.source = 'probe';
      e.latest = { t, state: r.ok ? 'up' : 'down', ...r };
      e.recent = [...e.recent, [t, r.ok ? 1 : 0, r.ms, r.code]].filter(([ts]) => Date.parse(ts) >= recentCutoff);
      const day = dayKey(now);
      const [up, total] = e.daily[day] || [0, 0];
      e.daily = { ...e.daily, [day]: [up + (r.ok ? 1 : 0), total + 1] };
      log(id, 'probe', r.ok ? 'up' : 'down', r.ms, r.error || (r.ok ? '' : `HTTP ${r.code}`));
    } else if (!prev.endpoints[id]) {
      continue; // no key, no URL, no history: nothing to show yet
    }
    e.daily = Object.fromEntries(Object.entries(e.daily || {}).filter(([d]) => d >= dailyCutoff));
    if (e.dailyPct) e.dailyPct = Object.fromEntries(Object.entries(e.dailyPct).filter(([d]) => d >= dailyCutoff));
    endpoints[id] = e;
  }
  await writeJson(path, { updated: t, endpoints }, false);
}

function log(id, source, state, ms, extra) {
  console.log(`check ${id.padEnd(12)} ${source.padEnd(11)} ${state.toUpperCase().padEnd(7)} ${ms ?? '-'} ms${extra ? ' ' + extra : ''}`);
}

async function collectNews() {
  const path = join(dataDir, 'news.json');
  const prev = await readJson(path, { items: [] });
  const t = new Date().toISOString();
  try {
    const res = await fetch(config.news.rssUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseRss(await res.text());
    await writeJson(path, { updated: t, source: config.news.rssUrl, items });
    console.log(`news: ${items.length} messages`);
  } catch (err) {
    // Keep the last good copy; record the failure so the page can say so.
    await writeJson(path, { ...prev, lastError: { t, message: err.cause?.code || err.message } });
    console.warn(`news: fetch failed (${err.message}), kept ${prev.items.length} previous messages`);
  }
}

// ---- GitHub issues ----------------------------------------------------------
// Issues labelled incident / maintenance / news become messages. Only issues
// and comments written by people with write access (or listed in
// issues.trustedUsers) are published; others are skipped, so anyone can
// open an issue without being able to post to the status page.

async function gh(path) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'nrec-status',
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitHub API ${path}: HTTP ${res.status}`);
  return res.json();
}

async function collectIssues() {
  const path = join(dataDir, 'issues.json');
  const prev = await readJson(path, { items: [] });
  const repo = process.env.GITHUB_REPOSITORY || config.repo;
  const { labels, trustedAssociations, trustedUsers, maxAgeDays } = config.issues;
  const wanted = new Set(Object.values(labels));
  const trusted = (u, assoc) => trustedAssociations.includes(assoc) || trustedUsers.includes(u);
  const since = new Date(Date.now() - maxAgeDays * 864e5);
  const t = new Date().toISOString();
  try {
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await gh(`/repos/${repo}/issues?state=all&per_page=100&page=${page}&sort=created&direction=desc`);
      all.push(...batch);
      if (batch.length < 100 || Date.parse(batch.at(-1).created_at) < since) break;
    }
    const items = [];
    for (const is of all) {
      if (is.pull_request || Date.parse(is.created_at) < since) continue;
      const names = is.labels.map((l) => (typeof l === 'string' ? l : l.name));
      if (!names.some((n) => wanted.has(n))) continue;
      if (!trusted(is.user.login, is.author_association)) {
        console.warn(`issues: skipping #${is.number}, author ${is.user.login} (${is.author_association}) is not trusted`);
        continue;
      }
      const comments = is.comments ? await gh(`/repos/${repo}/issues/${is.number}/comments?per_page=100`) : [];
      items.push({
        number: is.number,
        title: is.title,
        body: is.body || '',
        labels: names,
        state: is.state,
        created_at: is.created_at,
        updated_at: is.updated_at,
        closed_at: is.closed_at,
        html_url: is.html_url,
        author: is.user.login,
        comments: comments
          .filter((c) => trusted(c.user.login, c.author_association))
          .map((c) => ({ body: c.body || '', created_at: c.created_at, author: c.user.login })),
      });
    }
    await writeJson(path, { updated: t, repo, items });
    console.log(`issues: ${items.length} published from ${repo}`);
  } catch (err) {
    await writeJson(path, { ...prev, lastError: { t, message: err.message } });
    console.warn(`issues: fetch failed (${err.message}), kept ${prev.items.length} previous`);
  }
}

if (!only || only === 'checks') await collectChecks();
if (!only || only === 'news') await collectNews();
if (!only || only === 'issues') await collectIssues();
