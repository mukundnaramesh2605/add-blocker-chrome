import { CUSTOM_BLOCK_RULE_ID, getState, hostFromUrl, isAllowlisted } from './shared.js';

const $ = (id) => document.getElementById(id);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const host = hostFromUrl(tab?.url);
const stats = await fetch('../rules/stats.json').then((r) => r.json()).catch(() => null);

// Counts matched block rules on this tab (Chrome keeps matches for ~5 minutes).
async function blockedOnTab() {
  if (!tab || !stats) return 0;
  const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
  return rulesMatchedInfo.filter(({ rule }) =>
    rule.rulesetId === '_dynamic' ? rule.ruleId === CUSTOM_BLOCK_RULE_ID : rule.ruleId >= stats[rule.rulesetId]?.firstBlockId
  ).length;
}

async function render() {
  const state = await getState();
  const allowed = isAllowlisted(host, state.allowlist);

  $('global').checked = state.enabled;
  $('global-status').textContent = state.enabled ? 'On everywhere' : 'Paused everywhere';

  if (!host) {
    $('site-row').classList.add('disabled');
    $('site').disabled = true;
    $('site-name').textContent = 'This page';
    $('site-status').textContent = "Can't run on browser pages";
  } else {
    $('site-row').classList.toggle('disabled', !state.enabled);
    $('site').disabled = !state.enabled;
    $('site').checked = !allowed;
    $('site-name').textContent = host;
    $('site-status').textContent = allowed ? 'Allowed (not blocking)' : 'Blocking ads';
  }

  $('count').textContent = state.enabled && host && !allowed ? (await blockedOnTab()).toLocaleString() : '–';

  document.body.classList.toggle('off', !state.enabled || allowed);
}

$('global').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
  await render();
  if (tab) chrome.tabs.reload(tab.id);
});

$('site').addEventListener('change', async (e) => {
  const { allowlist } = await getState();
  const next = e.target.checked
    ? allowlist.filter((d) => !(host === d || host.endsWith(`.${d}`)))
    : [...new Set([...allowlist, host])];
  await chrome.storage.local.set({ allowlist: next });
  await render();
  chrome.tabs.reload(tab.id);
});

$('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

if (stats) $('rule-info').textContent = `${(stats.easylist.rules + stats.easyprivacy.rules).toLocaleString()} rules`;

render();
