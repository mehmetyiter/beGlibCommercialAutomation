const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const reservedYouTubePaths = new Set([
  'channel',
  'embed',
  'feed',
  'live',
  'playlist',
  'results',
  'shorts',
  'user',
  'watch',
]);

export function youtubeChannelIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (!youtubeHosts.has(url.hostname.toLowerCase())) {
      return undefined;
    }

    const match = url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function candidateKnownYouTubeChannelIds(candidate) {
  return candidateKnownYouTubeChannelLocators(candidate)
    .filter((locator) => locator.filter === 'id')
    .map((locator) => locator.value);
}

export function youtubeChannelLocatorFromUrl(value) {
  try {
    const url = new URL(value);
    if (!youtubeHosts.has(url.hostname.toLowerCase())) {
      return undefined;
    }

    const pathParts = url.pathname.split('/').filter(Boolean);
    const [first = '', second = ''] = pathParts;
    const channelId = youtubeChannelIdFromUrl(value);
    if (channelId) {
      return { filter: 'id', value: channelId };
    }

    if (first.startsWith('@') && first.length > 1) {
      return { filter: 'forHandle', value: first, sourceUrl: url.toString() };
    }

    if (first.toLowerCase() === 'user' && second) {
      return { filter: 'forUsername', value: second, sourceUrl: url.toString() };
    }

    if (first.toLowerCase() === 'c' && second) {
      return {
        filter: 'forHandle',
        fallbackFilter: 'forUsername',
        value: second,
        sourceUrl: url.toString(),
      };
    }

    if (pathParts.length === 1 && first && !reservedYouTubePaths.has(first.toLowerCase())) {
      return {
        filter: 'forHandle',
        fallbackFilter: 'forUsername',
        value: first,
        sourceUrl: url.toString(),
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export function candidateKnownYouTubeChannelLocators(candidate) {
  const urls = [
    ...(candidate.sourceUrls ?? []),
    ...(candidate.channels ?? []).map((channel) => channel.url),
  ];

  const locators = urls.map(youtubeChannelLocatorFromUrl).filter(Boolean);
  return Array.from(
    new Map(locators.map((locator) => [`${locator.filter}|${locator.value.toLowerCase()}`, locator])).values(),
  );
}

export function candidateQuarantinedYouTubeChannelLocators(dossier) {
  const locators = (dossier.quarantinedChannels ?? [])
    .filter((channel) => channel.platform === 'youtube')
    .map((channel) => {
      const locator = youtubeChannelLocatorFromUrl(channel.url);
      if (!locator || locator.filter === 'id') {
        return undefined;
      }

      return {
        ...locator,
        sourceUrl: channel.url,
        source: channel.source,
        sourceLabel: channel.label,
        identityEvidence: channel.identityEvidence ?? [],
      };
    })
    .filter(Boolean);

  const uniqueLocators = new Map();
  for (const locator of locators) {
    const key = `${locator.filter}|${locator.value.toLowerCase()}`;
    if (!uniqueLocators.has(key)) {
      uniqueLocators.set(key, locator);
    }
  }

  return Array.from(uniqueLocators.values());
}

export function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
