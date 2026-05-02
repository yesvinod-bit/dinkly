const LEGACY_PRIVATE_HOST_PREFIX = 'ais-dev-';
const LEGACY_PUBLIC_HOST_PREFIX = 'ais-pre-';

function remapLegacyHost(hostname: string) {
  if (!hostname.startsWith(LEGACY_PRIVATE_HOST_PREFIX)) {
    return hostname;
  }

  return `${LEGACY_PUBLIC_HOST_PREFIX}${hostname.slice(LEGACY_PRIVATE_HOST_PREFIX.length)}`;
}

export function getPublicAppOrigin(origin: string) {
  try {
    const url = new URL(origin);
    url.hostname = remapLegacyHost(url.hostname);
    return url.origin;
  } catch {
    return origin;
  }
}

export function getPublicAppUrl(href: string) {
  try {
    const url = new URL(href);
    url.hostname = remapLegacyHost(url.hostname);
    return url.toString();
  } catch {
    return href;
  }
}

export function buildInviteUrl(origin: string, code: string) {
  const url = new URL(getPublicAppOrigin(origin));
  url.searchParams.set('invite', code);
  return url.toString();
}

export function buildSpectatorUrl(origin: string, tournamentId: string) {
  const url = new URL(getPublicAppOrigin(origin));
  url.searchParams.set('view', tournamentId);
  return url.toString();
}

export function buildJoinUrl(origin: string, tournamentId: string) {
  const url = new URL(getPublicAppOrigin(origin));
  url.searchParams.set('join', tournamentId);
  return url.toString();
}
