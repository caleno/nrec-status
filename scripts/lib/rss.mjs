// Tiny RSS 2.0 parser, enough for the feed report.nrec.no generates.
// The JSON endpoint (/api/v1/status) currently answers 500 because its
// response does not match its own OpenAPI spec, so we read the RSS feed.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s) {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : null;
}

export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const pub = tag(it, 'pubDate');
    items.push({
      id: tag(it, 'guid'),
      type: tag(it, 'category') || 'info',
      message: tag(it, 'description') || tag(it, 'title') || '',
      timestamp: pub ? new Date(pub).toISOString() : null,
    });
  }
  return items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}
