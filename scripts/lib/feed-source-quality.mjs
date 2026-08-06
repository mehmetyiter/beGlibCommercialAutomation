const feedMimeTypes = new Set([
  'application/atom+xml',
  'application/feed+json',
  'application/rss+xml',
  'text/atom+xml',
  'text/rss+xml',
]);

const genericDocumentMimeTypes = new Set([
  'application/json',
  'application/ld+json',
]);

export function isLikelySyndicationFeed({ url, label = '', type = '', rel = '' }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const path = parsed.pathname.toLowerCase();
  const feedQuery = normalizeText(parsed.searchParams.get('feed') ?? '');
  const mimeType = String(type).toLowerCase().split(';')[0].trim();
  const labelText = normalizeText(label);
  const relTokens = new Set(String(rel).toLowerCase().split(/\s+/).filter(Boolean));

  if (isTechnicalDocumentEndpoint(path)) {
    return false;
  }

  if (parsed.searchParams.has('ical') || /\.ics$/.test(path)) {
    return false;
  }

  if (genericDocumentMimeTypes.has(mimeType)) {
    return false;
  }

  if (feedMimeTypes.has(mimeType)) {
    return true;
  }

  if (relTokens.has('alternate') && /(?:rss|atom|json)feed/.test(mimeType)) {
    return true;
  }

  if (/^(?:comments )?(?:rss2?|atom|rdf)$/.test(feedQuery)) {
    return true;
  }

  if (/(^|\/)(feed|rss|atom)(\/|\.(?:xml|rss|atom|json)|$)/.test(path)) {
    return true;
  }

  if (/\.(?:rss|atom)$/.test(path) || /(?:^|\/)feed\.json$/.test(path)) {
    return true;
  }

  return /(^| )(rss|atom|feed)( |$)/.test(labelText);
}

export function isTechnicalDocumentEndpoint(pathname) {
  const path = String(pathname).toLowerCase();
  return (
    /(^|\/)wp-json(\/|$)/.test(path) ||
    /(^|\/)oembed(\/|$)/.test(path) ||
    /(^|\/)wp\/v\d+(\/|$)/.test(path) ||
    /(^|\/)(?:wlwmanifest|rsd|opensearch)(?:\.[a-z0-9]+)?$/.test(path) ||
    /(^|\/)sitemap(?:[-_.][^/]*)?\.xml$/.test(path)
  );
}

function normalizeText(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
