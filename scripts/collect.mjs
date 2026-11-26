#!/usr/bin/env node
// Collects status data into a data directory:
//   checks.json  - outside-in availability checks of the public endpoints
//   news.json    - status messages from report.nrec.no
//
// Usage: node scripts/collect.mjs --data data [--only checks|news]
//
// Runs in GitHub Actions on a schedule. Each step is independent: if
// report.nrec.no is unreachable, the previous news.json is kept and the
// error is recorded, so the page still builds.

import { join } from 'node:path';
import { loadConfig, readJson, writeJson, parseArgs, dayKey } from './lib/util.mjs';
import { parseRss } from './lib/rss.mjs';

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

  const results = await Promise.all(config.endpoints.map(async (ep) => {
    let r = await probe(ep.url, timeoutMs);
    // Retry once before declaring an endpoint down, to avoid flapping on
    // a single dropped connection.
    for (let i = 0; i < retries && !r.ok; i++) r = await probe(ep.url, timeoutMs);
    return [ep.id, r];
  }));

  const endpoints = {};
  for (const [id, r] of results) {
    const e = prev.endpoints[id] || { recent: [], daily: {} };
    e.latest = { t, ...r };
    e.recent = [...(e.recent || []), [t, r.ok ? 1 : 0, r.ms, r.code]]
      .filter(([ts]) => Date.parse(ts) >= recentCutoff);
    const day = dayKey(now);
    const [up, total] = e.daily?.[day] || [0, 0];
    e.daily = { ...(e.daily || {}), [day]: [up + (r.ok ? 1 : 0), total + 1] };
    e.daily = Object.fromEntries(Object.entries(e.daily).filter(([d]) => d >= dailyCutoff));
    endpoints[id] = e;
    console.log(`check ${id.padEnd(10)} ${r.ok ? 'UP  ' : 'DOWN'} ${String(r.code).padStart(3)} ${r.ms} ms${r.error ? ' ' + r.error : ''}`);
  }
  await writeJson(path, { updated: t, endpoints }, false);
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

if (!only || only === 'checks') await collectChecks();
if (!only || only === 'news') await collectNews();
