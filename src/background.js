import { ALLOWLIST_RULE_ID, CUSTOM_BLOCK_RULE_ID, RULESET_IDS, getState, hostFromUrl, isAllowlisted } from './shared.js';

const ALLOWLIST_PRIORITY = 100; // beats every static rule (max 3)
const CUSTOM_BLOCK_PRIORITY = 4;

// ---------- Network rules ----------

async function applyState() {
  const { enabled, allowlist, customBlocked } = await getState();

  const enabledNow = await chrome.declarativeNetRequest.getEnabledRulesets();
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled
      ? { enableRulesetIds: RULESET_IDS.filter((id) => !enabledNow.includes(id)) }
      : { disableRulesetIds: enabledNow }
  );

  const addRules = [];
  if (enabled) {
    if (customBlocked.length) {
      addRules.push({
        id: CUSTOM_BLOCK_RULE_ID,
        priority: CUSTOM_BLOCK_PRIORITY,
        action: { type: 'block' },
        condition: { requestDomains: customBlocked },
      });
    }
    if (allowlist.length) {
      // allowAllRequests on the top frame also exempts every request the page makes.
      addRules.push({
        id: ALLOWLIST_RULE_ID,
        priority: ALLOWLIST_PRIORITY,
        action: { type: 'allowAllRequests' },
        condition: { requestDomains: allowlist, resourceTypes: ['main_frame'] },
      });
    }
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules,
  });

  await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#c0392b' : '#7f8c8d' });
  await chrome.action.setTitle({ title: enabled ? 'Private Ad Blocker' : 'Private Ad Blocker (paused)' });
}

// Chrome keeps a per-tab count of blocked requests and shows it on the icon.
chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });

chrome.runtime.onInstalled.addListener(applyState);
chrome.runtime.onStartup.addListener(applyState);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') applyState();
});

// ---------- Cosmetic filtering ----------

let cosmeticPromise;
function loadCosmetic() {
  cosmeticPromise ??= fetch(chrome.runtime.getURL('rules/cosmetic.json'))
    .then((r) => r.json())
    .then((data) => ({
      ...data,
      // One rule per selector: an invalid selector then only drops itself,
      // instead of invalidating a whole comma-joined group.
      genericCss: data.generic.map((s) => `${s}{display:none!important}`).join('\n'),
    }));
  return cosmeticPromise;
}

// Returns the site-specific and excepted selectors for host and all parent domains.
function lookup(map, host) {
  const out = [];
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const selectors = map[parts.slice(i).join('.')];
    if (selectors) out.push(...selectors);
  }
  return out;
}

async function cssForHost(host) {
  const cosmetic = await loadCosmetic();
  const specific = lookup(cosmetic.specific, host);
  const exceptions = new Set(lookup(cosmetic.exceptions, host));

  const generic = exceptions.size
    ? cosmetic.generic.filter((s) => !exceptions.has(s)).map((s) => `${s}{display:none!important}`).join('\n')
    : cosmetic.genericCss;
  const site = specific
    .filter((s) => !exceptions.has(s))
    .map((s) => `${s}{display:none!important}`)
    .join('\n');

  return `${generic}\n${site}`;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'cosmetic' && sender.tab?.id !== undefined) {
    handleCosmetic(msg, sender).finally(() => sendResponse({}));
    return true;
  }
});

async function handleCosmetic(msg, sender) {
  const { enabled, allowlist } = await getState();
  const topHost = hostFromUrl(sender.tab.url);
  const frameHost = hostFromUrl(msg.url) || topHost; // about:blank frames inherit the page
  if (!enabled || !frameHost || isAllowlisted(topHost, allowlist)) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
      css: await cssForHost(frameHost),
      origin: 'USER', // user-origin !important beats the page's own !important rules
    });
  } catch {
    // Frame navigated away or is not injectable (e.g. chrome web store).
  }
}
