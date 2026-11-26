// HTML template for the status page. Plain template literals, no framework:
// the output is a single static HTML file styled like nrec.no.

import { escapeHtml as h } from '../scripts/lib/util.mjs';

const STATUS = {
  up: { label: 'Operational', icon: 'fa-circle-check' },
  down: { label: 'Not responding', icon: 'fa-circle-xmark' },
  partial: { label: 'Partial outage', icon: 'fa-triangle-exclamation' },
  unknown: { label: 'No data', icon: 'fa-circle-question' },
};

const MESSAGE_TYPES = {
  important: { label: 'Important', icon: 'fa-triangle-exclamation' },
  event: { label: 'Event', icon: 'fa-calendar-days' },
  info: { label: 'Info', icon: 'fa-circle-info' },
};

const num = new Intl.NumberFormat('en-GB');

function fmt(tz, date, opts) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date(date));
}

/** Escape, then turn bare URLs into links and newlines into <br>. Emoji pass through. */
function richText(s) {
  return h(s)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" rel="noopener noreferrer">${u}</a>`)
    .replace(/\n/g, '<br>');
}

function uptimeClass(pct) {
  if (pct === null) return 'nodata';
  if (pct >= 99.9) return 'good';
  if (pct >= 95) return 'warning';
  return 'critical';
}

function uptimeText(pct) {
  if (pct === null) return '—';
  return `${pct >= 99.995 ? '100' : pct.toFixed(2)}%`;
}

function endpointCard(ep, tz) {
  const s = STATUS[ep.status];
  const bars = ep.days.map((d) => {
    const label = d.pct === null
      ? `${fmt(tz, d.date, { day: 'numeric', month: 'short' })}: no data`
      : `${fmt(tz, d.date, { day: 'numeric', month: 'short' })}: ${uptimeText(d.pct)} up (${d.checks} checks)`;
    return `<span class="bar bar-${uptimeClass(d.pct)}" data-tip="${h(label)}"></span>`;
  }).join('');
  const detail = ep.latest
    ? (ep.latest.ok
      ? `${num.format(ep.latest.ms)} ms`
      : h(ep.latest.error || `HTTP ${ep.latest.code}`))
    : '';
  return `
        <div class="col-md-6">
          <div class="card card_style endpoint endpoint-${ep.status}">
            <div class="endpoint-head">
              <div>
                <h3 class="endpoint-name"><a href="${h(ep.url.replace(/:\d+\/.*$/, '/'))}" rel="noopener noreferrer">${h(ep.name)}</a></h3>
                <div class="endpoint-desc">${h(ep.description)}</div>
              </div>
              <div class="status-chip status-${ep.status}">
                <i class="fas ${s.icon}" aria-hidden="true"></i> ${s.label}
              </div>
            </div>
            <div class="uptime" role="img" aria-label="${h(ep.name)} daily uptime, last ${ep.days.length} days: ${uptimeText(ep.uptime)}">
              ${bars}
            </div>
            <div class="endpoint-foot">
              <span>${ep.days.length} days ago</span>
              <span><strong>${uptimeText(ep.uptime)}</strong> uptime${detail ? ` · ${detail}` : ''}</span>
              <span>Today</span>
            </div>
          </div>
        </div>`;
}

function newsItem(item, tz) {
  const t = MESSAGE_TYPES[item.type] || MESSAGE_TYPES.info;
  const date = item.timestamp
    ? `<time datetime="${h(item.timestamp)}">${fmt(tz, item.timestamp, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</time>`
    : '';
  return `
          <li class="news-item news-${h(item.type)}">
            <div class="news-meta">
              <span class="news-type"><i class="fas ${t.icon}" aria-hidden="true"></i> ${t.label}</span>
              ${date}
            </div>
            <p class="news-text">${richText(item.message)}</p>
          </li>`;
}

function sparkline(tile) {
  const vals = tile.series.map(([, v]) => v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 240, H = 48, pad = 5;
  const x = (i) => (i / (vals.length - 1 || 1)) * W;
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const lx = x(vals.length - 1), ly = y(vals.at(-1));
  return `
              <div class="spark" data-series='${h(JSON.stringify(tile.series))}'>
                <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
                  <path class="spark-line" d="${d}" vector-effect="non-scaling-stroke"/>
                  <line class="spark-cursor" x1="0" x2="0" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>
                </svg>
                <span class="spark-dot spark-end" style="left:${((lx / W) * 100).toFixed(2)}%;top:${((ly / H) * 100).toFixed(2)}%"></span>
                <span class="spark-dot spark-hover"></span>
              </div>`;
}

function usageTile(tile, tz) {
  const ago = tile.series.length > 30 ? tile.series.at(-31) : tile.series[0];
  const delta = tile.value - ago[1];
  const days = tile.series.length > 30 ? 30 : tile.series.length - 1;
  const breakdown = tile.breakdown
    ? `<div class="tile-breakdown">${tile.breakdown.map((b) => `${h(b.name)} <strong>${num.format(b.value)}</strong>`).join(' · ')}</div>`
    : '';
  const rows = [...tile.series].reverse().map(([d, v]) =>
    `<tr><td>${fmt(tz, d, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${num.format(v)}</td></tr>`).join('');
  return `
          <div class="col-md-4">
            <div class="card card_style tile">
              <div class="tile-head">
                <div class="tile-label">${h(tile.label)}</div>
                <div class="tile-value">${num.format(tile.value)}</div>
                <div class="tile-delta">${delta >= 0 ? '+' : '−'}${num.format(Math.abs(delta))} in the last ${days} days</div>
                ${breakdown}
              </div>
              ${sparkline(tile)}
              <details class="tile-table">
                <summary>Show as table</summary>
                <div class="table-wrap"><table class="table table-sm"><thead><tr><th>Date</th><th>${h(tile.label)}</th></tr></thead><tbody>${rows}</tbody></table></div>
              </details>
            </div>
          </div>`;
}

export function renderPage({ config, now, checksUpdated, endpoints, overall, news, usage }) {
  const tz = config.timezone;
  const items = news.items || [];
  const latest = items.slice(0, config.news.showLatest);
  const older = items.slice(config.news.showLatest);
  const ov = STATUS[overall.level];
  const checkedAt = checksUpdated
    ? `Last checked <time class="js-ago" datetime="${h(checksUpdated)}">${fmt(tz, checksUpdated, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>`
    : 'No checks have run yet';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${h(config.title)}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Current status, news and maintenance for NREC, the Norwegian Research and Education Cloud">
  <meta property="og:title" content="${h(config.title)}">
  <meta property="og:description" content="${h(overall.text)}">
  <meta property="og:image" content="https://nrec.no/assets/img/nrec-horizontal_dark.svg">
  <link rel="icon" href="assets/img/favicon.ico">
  <link rel="alternate" type="application/rss+xml" title="NREC status messages" href="${h(config.news.rssUrl)}">
  <link rel="stylesheet" href="assets/vendor/bootstrap/bootstrap.min.css">
  <link rel="stylesheet" href="assets/css/nrec.css">
  <link rel="stylesheet" href="assets/css/status.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css"
    integrity="sha512-2SwdPD6INVrV/lHTZbO2nodKhrnDdJK9/kg2XD1r9uGqPo1cUbujc+IYdlYdEErWNu69gVcYgdxlmVmzTWnetw=="
    crossorigin="anonymous" referrerpolicy="no-referrer">
</head>

<body data-checks-updated="${h(checksUpdated || '')}" data-stale-minutes="${config.checks.staleAfterMinutes}">
  <nav class="navbar navbar-expand-lg navbar-dark fixed-top bg-primary">
    <div class="container">
      <a class="navbar-brand" href="https://nrec.no/">
        <img src="assets/img/nrec-vertical_light.svg" alt="NREC">
      </a>
      <button class="navbar-toggler" type="button" aria-controls="nav" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse text-center" id="nav">
        <ul class="navbar-nav me-auto">
          <li class="nav-item mx-2"><a class="nav-link" href="#services">Services</a></li>
          <li class="nav-item mx-2"><a class="nav-link" href="#news">News &amp; issues</a></li>
          ${usage ? '<li class="nav-item mx-2"><a class="nav-link" href="#usage">Usage</a></li>' : ''}
        </ul>
        <ul class="navbar-nav ms-auto">
          <li class="nav-item mx-2"><a class="nav-link" href="https://nrec.no/">nrec.no</a></li>
          <li class="nav-item mx-2"><a class="nav-link" href="https://docs.nrec.no/" rel="noopener noreferrer">Documentation <i class="fas fa-external-link-alt fa-xs"></i></a></li>
          <li class="nav-item mx-2"><a class="btn btn-outline-light" href="https://dashboard.nrec.no" rel="noopener noreferrer">Sign in</a></li>
        </ul>
      </div>
    </div>
  </nav>

  <header class="bg-primary status-hero">
    <div class="container content-layer">
      <h1 class="text-white">NREC Status</h1>
      <div class="overall overall-${overall.level}">
        <i class="fas ${ov.icon}" aria-hidden="true"></i>
        <span>${h(overall.text)}</span>
      </div>
      <p class="hero-meta">${checkedAt} · updates every 15 minutes</p>
      <div class="stale-warning" hidden>
        <i class="fas fa-clock" aria-hidden="true"></i>
        The automatic checks have not updated for a while, so this page may be out of date.
      </div>
    </div>
  </header>

  <main>
    <section id="services" class="container">
      <div class="section">
        <h2>Services</h2>
        <p class="text-muted">Checked from outside NREC every 15 minutes. Bars show daily uptime for the last ${endpoints[0]?.days.length ?? 0} days.</p>
        <div class="row g-4">${endpoints.map((ep) => endpointCard(ep, tz)).join('')}
        </div>
        <div class="legend">
          <span><span class="bar bar-good"></span> 99.9% or more</span>
          <span><span class="bar bar-warning"></span> 95–99.9%</span>
          <span><span class="bar bar-critical"></span> under 95%</span>
          <span><span class="bar bar-nodata"></span> no data</span>
        </div>
      </div>
    </section>

    <section id="news" class="section bg-light">
      <div class="container">
        <h2>News &amp; issues</h2>
        <p class="text-muted">
          Announcements, maintenance and incidents.
          <a href="${h(config.news.rssUrl)}"><i class="fas fa-rss" aria-hidden="true"></i> Subscribe via RSS</a>
        </p>
        ${news.lastError ? `<div class="notice"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Could not fetch new messages at ${fmt(tz, news.lastError.t, { hour: '2-digit', minute: '2-digit' })}. Showing the last saved copy.</div>` : ''}
        ${items.length ? `<ul class="news-list">${latest.map((i) => newsItem(i, tz)).join('')}
        </ul>` : '<p>No messages.</p>'}
        ${older.length ? `<details class="news-older">
          <summary>Older messages (${older.length})</summary>
          <ul class="news-list">${older.map((i) => newsItem(i, tz)).join('')}
          </ul>
        </details>` : ''}
      </div>
    </section>
${usage ? `
    <section id="usage" class="container">
      <div class="section">
        <h2>Usage</h2>
        <p class="text-muted">
          Size of the NREC cloud${usage.updated ? `, updated ${fmt(tz, usage.updated, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.
          ${usage.source === 'mock' ? '<span class="sample-badge">Sample data</span>' : ''}
        </p>
        <div class="row g-4">${usage.tiles.map((t) => usageTile(t, tz)).join('')}
        </div>
      </div>
    </section>
` : ''}
  </main>

  <footer class="footer_custom">
    <div class="container">
      <div class="small d-flex flex-column flex-md-row justify-content-between align-items-center">
        <div class="mt-4 mt-md-0">
          <a class="btn btn-lg icon_some_small text-white" href="mailto:support@nrec.no" aria-label="Email support"><i class="fas fa-envelope"></i></a>
          <a class="btn btn-lg icon_some_small text-white" href="https://uhps.slack.com" rel="noopener noreferrer" aria-label="Slack"><i class="fab fa-slack-hash"></i></a>
        </div>
        <ul class="footer-menu list-unstyled d-flex flex-row flex-wrap gap-3 justify-content-center justify-content-md-end mb-0">
          <li><a href="status.json">status.json</a></li>
          <li><a href="${h(config.news.rssUrl)}">RSS</a></li>
          <li><a href="https://docs.nrec.no/terms-of-service.html" rel="noopener noreferrer">Terms of Use</a></li>
        </ul>
      </div>
      <div class="copyright text-center">
        <hr class="my-3 footer-divider">
        <p class="small mb-0">&copy; ${now.getUTCFullYear()} NREC · Page built ${fmt(tz, now, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}</p>
      </div>
    </div>
  </footer>

  <div class="tip" role="tooltip" hidden></div>
  <script src="assets/js/status.js" defer></script>
</body>
</html>
`;
}
