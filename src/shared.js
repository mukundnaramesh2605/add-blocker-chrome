export const RULESET_IDS = ['easylist', 'easyprivacy'];
export const CUSTOM_BLOCK_RULE_ID = 1;
export const ALLOWLIST_RULE_ID = 2;

export const DEFAULT_STATE = {
  enabled: true,
  allowlist: [], // hostnames where blocking is paused
  customBlocked: [], // extra hostnames to block everywhere
};

export async function getState() {
  const stored = await chrome.storage.local.get(DEFAULT_STATE);
  return { ...DEFAULT_STATE, ...stored };
}

export function normalizeHost(input) {
  let host = String(input || '').trim().toLowerCase();
  if (!host) return '';
  try {
    if (host.includes('/')) host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
  } catch {
    return '';
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host) ? host : '';
}

export function hostFromUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? normalizeHost(u.hostname) : '';
  } catch {
    return '';
  }
}

// True if host equals an allowlisted domain or is a subdomain of one.
export function isAllowlisted(host, allowlist) {
  return !!host && allowlist.some((d) => host === d || host.endsWith(`.${d}`));
}
