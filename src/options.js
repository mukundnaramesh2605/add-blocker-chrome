import { getState, normalizeHost } from './shared.js';

const $ = (id) => document.getElementById(id);

function parseHosts(text) {
  const hosts = [];
  const invalid = [];
  for (const line of text.split(/[\s,]+/)) {
    if (!line) continue;
    const host = normalizeHost(line);
    host ? hosts.push(host) : invalid.push(line);
  }
  return { hosts: [...new Set(hosts)], invalid };
}

const state = await getState();
$('allowlist').value = state.allowlist.join('\n');
$('blocked').value = state.customBlocked.join('\n');

$('save').addEventListener('click', async () => {
  const allow = parseHosts($('allowlist').value);
  const block = parseHosts($('blocked').value);
  await chrome.storage.local.set({ allowlist: allow.hosts, customBlocked: block.hosts });

  $('allowlist').value = allow.hosts.join('\n');
  $('blocked').value = block.hosts.join('\n');
  const invalid = [...allow.invalid, ...block.invalid];
  $('saved').textContent = invalid.length ? `Saved. Ignored invalid entries: ${invalid.join(', ')}` : 'Saved.';
  setTimeout(() => ($('saved').textContent = ''), 4000);
});

fetch('../rules/stats.json')
  .then((r) => r.json())
  .then((s) => {
    $('stats').textContent =
      `EasyList: ${s.easylist.rules.toLocaleString()} rules · EasyPrivacy: ${s.easyprivacy.rules.toLocaleString()} rules · ` +
      `${s.cosmeticGeneric.toLocaleString()} element-hiding selectors · built ${new Date(s.builtAt).toLocaleDateString()}`;
  })
  .catch(() => ($('stats').textContent = 'Filter lists not built yet.'));
