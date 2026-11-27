// UptimeRobot as a source for service status, using monitor-specific API
// keys (one per monitor). Those keys only allow getMonitors on their own
// monitor, which is a v2 ("legacy") API method:
//   https://uptimerobot.com/api/legacy/
//
// The keys come from one secret, UPTIMEROBOT_MONITOR_KEYS, one per line:
//   api-bgo=m123456789-abcdef...
//   api-osl=m987654321-fedcba...
// The name before "=" is matched against endpoint ids in config/site.json.
//
// Only the fields shown on the page are kept: the data branch is public,
// and a monitor's full record can include settings such as HTTP headers.

const API = 'https://api.uptimerobot.com/v2/getMonitors';

// getMonitors status codes
const STATES = { 0: 'paused', 1: 'unknown', 2: 'up', 8: 'up', 9: 'down' };
// 8 = "seems down": not yet confirmed, UptimeRobot doesn't alert on it either.

/** Normalise a key name: "API_BGO " -> "api-bgo". */
export const keyName = (s) => String(s).trim().toLowerCase().replace(/[\s_]+/g, '-');

/** Parse the secret into [[name, key], ...]. Ignores blank lines and # comments. */
export function parseKeys(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [keyName(l.slice(0, i)), l.slice(i + 1).trim()];
    })
    .filter(([n, k]) => n && k);
}

/** UTC day ranges for the last `days` days, oldest first; today ends now. */
function dayRanges(days, now) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const nowS = Math.floor(now.getTime() / 1000);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = today - i * 86400;
    out.push({ date: new Date(start * 1000).toISOString().slice(0, 10), start, end: i === 0 ? nowS : start + 86400 });
  }
  return out;
}

/**
 * Fetch one monitor with its key. Returns a record for checks.json, or
 * throws an Error whose message never contains the key.
 */
export async function fetchMonitor(apiKey, { days = 90, now = new Date(), timeoutMs = 15000 } = {}) {
  const ranges = dayRanges(days, now);
  const body = new URLSearchParams({
    api_key: apiKey,
    format: 'json',
    custom_uptime_ratios: '1-7-30-90',
    custom_uptime_ranges: ranges.map((r) => `${r.start}_${r.end}`).join('-'),
    response_times: '1',
    response_times_limit: '1',
    logs: '1',
    logs_limit: '10',
  });
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) throw new Error('rate limited by UptimeRobot (HTTP 429)');
  if (!res.ok) throw new Error(`UptimeRobot HTTP ${res.status}`);
  const json = await res.json();
  if (json.stat !== 'ok') {
    // The error object echoes the key back as passed_value: never log it.
    throw new Error(`UptimeRobot: ${json.error?.type || 'error'}${json.error?.message ? ` (${json.error.message})` : ''}`);
  }
  const m = json.monitors?.[0];
  if (!m) throw new Error('UptimeRobot: no monitor returned for this key');

  const state = STATES[m.status] || 'unknown';
  const created = m.create_datetime ? m.create_datetime * 1000 : 0;
  const rangePcts = String(m.custom_uptime_ranges || '').split('-').map(Number);
  const dailyPct = {};
  ranges.forEach((r, i) => {
    // Skip days before the monitor existed; UptimeRobot reports them as 100%.
    if (Number.isFinite(rangePcts[i]) && r.end * 1000 > created) dailyPct[r.date] = rangePcts[i];
  });
  const [d1, d7, d30, d90] = String(m.custom_uptime_ratio || '').split('-').map(Number);
  const logs = (m.logs || []).filter((l) => l.type === 1 || l.type === 2).sort((a, b) => b.datetime - a.datetime);
  const lastChange = logs[0];
  const lastDown = logs.find((l) => l.type === 1);
  const ms = m.response_times?.[0]?.value ?? (m.average_response_time ? Math.round(Number(m.average_response_time)) : null);
  let host = null;
  try { host = new URL(m.url).host; } catch { /* not a URL (e.g. ping monitor) */ }

  return {
    source: 'uptimerobot',
    monitor: { id: m.id, name: m.friendly_name, host, interval: m.interval },
    latest: {
      t: now.toISOString(),
      ok: state === 'up',
      state,
      ms,
      since: lastChange ? new Date(lastChange.datetime * 1000).toISOString() : null,
      error: state === 'down' ? (lastDown?.reason?.detail || 'Down') : undefined,
    },
    uptime: { d1, d7, d30, d90 },
    dailyPct,
  };
}
