// Messages from all sources, normalised to one shape:
//
//   {
//     id, source: 'report' | 'file' | 'issue',
//     type: 'news' | 'info' | 'important' | 'event' | 'maintenance' | 'incident',
//     title, html, timestamp,            // timestamp = when published
//     start, end,                        // maintenance window / incident period
//     regions: [], services: [],
//     resolved: bool | null,             // incidents and maintenance
//     updates: [{ timestamp, html }],    // newest last
//     url,                               // where to read or edit it
//   }

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { Marked } from 'marked';
import { emojify } from 'node-emoji';
import { escapeHtml } from './util.mjs';

export const TYPES = ['news', 'info', 'important', 'event', 'maintenance', 'incident'];

// ---- rendering ------------------------------------------------------------

// Files in the repo: normal Markdown, where a single newline doesn't break the line.
const markedTrusted = new Marked({ gfm: true, breaks: false });
// Content written on GitHub: newlines break lines (like GitHub renders issues),
// and raw HTML is shown as text, not rendered.
const markedSafe = new Marked({
  gfm: true,
  breaks: true,
  renderer: { html: ({ text }) => escapeHtml(text) },
});

function linksOpenSafely(html) {
  return html
    // Only http(s), mailto and in-page links; drop javascript: and the like.
    .replace(/<a href="(?!https?:|mailto:|#)[^"]*"/gi, '<a')
    .replace(/<img src="(?!https?:)[^"]*"/gi, '<img')
    .replace(/<a href="(https?:[^"]+)"/g, '<a href="$1" rel="noopener noreferrer"');
}

/** Markdown (GitHub flavoured) with :emoji: shortcodes. */
export function renderMarkdown(md, { trusted = false } = {}) {
  const m = trusted ? markedTrusted : markedSafe;
  return linksOpenSafely(m.parse(emojify(String(md || '').trim())));
}

/** Plain text: escaped, URLs linked, :emoji: shortcodes, paragraphs kept. */
export function renderText(text) {
  return emojify(String(text || '').trim())
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p)
      .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" rel="noopener noreferrer">${u}</a>`)
      .replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// ---- dates ------------------------------------------------------------------

/**
 * Parse a date written by a person. "2026-12-09 12:00" or "2026-12-09" is
 * read as local time in `tz`; anything with Z or an offset is used as is.
 */
export function parseLocalTime(value, tz) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString();
  }
  const [, y, mo, d, hh = '0', mm = '0'] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +hh, +mm);
  // Find the zone's offset at that moment and correct for it.
  const offset = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  let t = asUtc - offset(asUtc);
  t = asUtc - offset(t); // second pass handles DST edges
  return new Date(t).toISOString();
}

// ---- files: messages/*.md and *.txt ----------------------------------------

/** Minimal front matter: `key: value` lines, `[a, b]` lists, quoted strings. */
export function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (/^(true|false)$/i.test(v)) v = v.toLowerCase() === 'true';
    else v = v.replace(/^["']|["']$/g, '');
    meta[kv[1].toLowerCase()] = v;
  }
  return { meta, body: m[2] };
}

const asList = (v) => (Array.isArray(v) ? v : v ? String(v).split(',').map((x) => x.trim()) : []).map((x) => x.toLowerCase());

export async function loadFileMessages(dir, { tz, repoUrl, repoPath = 'messages' }) {
  let names;
  try { names = await readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    const ext = extname(name).toLowerCase();
    if (!['.md', '.markdown', '.txt'].includes(ext) || name.startsWith('_') || /^readme/i.test(name)) continue;
    const { meta, body } = parseFrontMatter(await readFile(join(dir, name), 'utf8'));
    if (meta.draft === true) continue;
    // Date: front matter, else a YYYY-MM-DD prefix in the file name.
    const date = meta.date || basename(name).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    const type = TYPES.includes(meta.type) ? meta.type : 'news';
    out.push({
      id: `file:${name}`,
      source: 'file',
      type,
      title: meta.title ? emojify(String(meta.title)) : null,
      html: ext === '.txt' ? renderText(body) : renderMarkdown(body, { trusted: true }),
      timestamp: parseLocalTime(date, tz),
      start: parseLocalTime(meta.start, tz),
      end: parseLocalTime(meta.end, tz),
      regions: asList(meta.regions),
      services: asList(meta.services),
      resolved: meta.status ? /^(resolved|completed|done)$/i.test(meta.status) : null,
      updates: [],
      url: repoUrl ? `${repoUrl}/blob/main/${repoPath}/${encodeURIComponent(name)}` : null,
    });
  }
  return out;
}

// ---- report.nrec.no ----------------------------------------------------------

export function fromReport(items) {
  return (items || []).map((it) => ({
    id: `report:${it.id}`,
    source: 'report',
    type: TYPES.includes(it.type) ? it.type : 'info',
    title: null,
    html: renderText(it.message),
    timestamp: it.timestamp,
    start: null, end: null, regions: [], services: [],
    resolved: null,
    updates: [],
    url: null,
  }));
}

// ---- GitHub issues ----------------------------------------------------------

/**
 * Split an issue-form body ("### Heading\n\nvalue") into fields. Bodies not
 * written with a form come back as { description: body }.
 */
export function parseIssueForm(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const parts = text.split(/^###\s+(.+)$/m);
  if (parts.length < 3) return { description: text };
  const fields = {};
  if (parts[0].trim()) fields.description = parts[0].trim();
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i].trim().toLowerCase();
    const value = parts[i + 1].trim();
    if (value && value !== '_No response_') fields[key] = value;
  }
  return fields;
}

function checkedIds(value, options) {
  if (!value) return [];
  const lines = value.split('\n').filter((l) => /^- \[x\]/i.test(l) || !/^- \[ \]/.test(l));
  const text = lines.join('\n').toLowerCase();
  return options.filter((o) => text.includes(o.id.toLowerCase()) || text.includes(o.name.toLowerCase())).map((o) => o.id);
}

/** Turn a collected issue (see collect.mjs) into a message. */
export function fromIssue(issue, { tz, labels, regions, services }) {
  const type = Object.keys(labels).find((t) => issue.labels.includes(labels[t]));
  const f = parseIssueForm(issue.body);
  const description = f.description || f.summary || f.details || f.message || '';
  return {
    id: `issue:${issue.number}`,
    source: 'issue',
    type,
    title: emojify(issue.title),
    html: renderMarkdown(description),
    timestamp: issue.created_at,
    start: parseLocalTime(f.start || f['start time'], tz) || (type === 'incident' ? issue.created_at : null),
    end: parseLocalTime(f.end || f['end time'], tz) || (type === 'incident' && issue.state === 'closed' ? issue.closed_at : null),
    regions: checkedIds(f.regions || f['affected regions'], regions),
    services: checkedIds(f.services || f['affected services'], services),
    resolved: issue.state === 'closed',
    closedAt: issue.closed_at,
    updates: (issue.comments || []).map((c) => ({ timestamp: c.created_at, html: renderMarkdown(c.body) })),
    url: issue.html_url,
    number: issue.number,
  };
}

// ---- phase ------------------------------------------------------------------

/**
 * Where an incident or maintenance stands right now:
 *   incident:    'ongoing' | 'resolved'
 *   maintenance: 'scheduled' | 'in-progress' | 'completed'
 */
export function phaseOf(msg, now = new Date()) {
  const t = now.getTime();
  if (msg.type === 'incident') return msg.resolved === false || (msg.resolved === null && !msg.end) ? 'ongoing' : 'resolved';
  if (msg.type === 'maintenance') {
    if (msg.resolved) return 'completed';
    const start = msg.start ? Date.parse(msg.start) : null;
    const end = msg.end ? Date.parse(msg.end) : null;
    if (end && t >= end) return 'completed';
    if (start && t < start) return 'scheduled';
    if (start || msg.resolved === false) return 'in-progress';
    return null;
  }
  return null;
}
