// Downloads ABP-style filter lists and converts them into
// Manifest V3 declarativeNetRequest rulesets + a cosmetic (element hiding) map.
//
// Usage: node scripts/build-rules.mjs

import { mkdir, writeFile } from 'node:fs/promises';

const LISTS = [
  { id: 'easylist', url: 'https://easylist.to/easylist/easylist.txt' },
  { id: 'easyprivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
];

// Chrome guarantees at least 30k enabled static rules per extension; the shared
// global pool usually allows far more, but keep each list comfortably sized.
const MAX_RULES_PER_LIST = 30000;

const PRIORITY = { block: 1, allow: 2, important: 3 };

const TYPE_MAP = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  subdocument: 'sub_frame',
  ping: 'ping',
  media: 'media',
  font: 'font',
  websocket: 'websocket',
  other: 'other',
  document: 'main_frame',
};

// Options we understand but that don't change the DNR rule.
const IGNORED_OPTIONS = new Set(['all', '1p', 'first-party']);

function parseDomains(value) {
  const include = [];
  const exclude = [];
  for (let d of value.split('|')) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    const negated = d.startsWith('~');
    if (negated) d = d.slice(1);
    if (d.includes('*') || !/^[a-z0-9.-]+$/.test(d)) {
      if (negated) continue; // dropping an exclusion is safe enough
      return null; // wildcard/unicode include domains aren't representable
    }
    (negated ? exclude : include).push(d);
  }
  return { include, exclude };
}

function convertNetworkFilter(line) {
  let isAllow = false;
  if (line.startsWith('@@')) {
    isAllow = true;
    line = line.slice(2);
  }

  let pattern = line;
  let options = [];
  const dollar = line.lastIndexOf('$');
  if (dollar !== -1 && !/^\/.*\/$/.test(line)) {
    pattern = line.slice(0, dollar);
    options = line.slice(dollar + 1).split(',').map((o) => o.trim()).filter(Boolean);
  }

  // Regex filters are capped at ~1000 rules in DNR and often unsupported — skip.
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) return null;
  if (!/^[\x20-\x7e]*$/.test(pattern)) return null;
  if (pattern.startsWith('||*')) pattern = pattern.slice(2);
  if (/.\|./.test(pattern.replace(/^\|\|?/, ''))) return null;

  const condition = {};
  const resourceTypes = [];
  const excludedResourceTypes = [];
  let important = false;
  let documentAllow = false;

  for (const opt of options) {
    const negated = opt.startsWith('~');
    const name = (negated ? opt.slice(1) : opt).toLowerCase();

    if (name === 'third-party' || name === '3p') {
      condition.domainType = negated ? 'firstParty' : 'thirdParty';
    } else if (name.startsWith('domain=')) {
      const doms = parseDomains(opt.slice(opt.indexOf('=') + 1));
      if (!doms) return null;
      if (doms.include.length) condition.initiatorDomains = doms.include;
      if (doms.exclude.length) condition.excludedInitiatorDomains = doms.exclude;
    } else if (name === 'match-case') {
      condition.isUrlFilterCaseSensitive = true;
    } else if (name === 'important') {
      important = true;
    } else if (name === 'document' && isAllow && !negated) {
      documentAllow = true;
    } else if (TYPE_MAP[name]) {
      (negated ? excludedResourceTypes : resourceTypes).push(TYPE_MAP[name]);
    } else if (IGNORED_OPTIONS.has(name)) {
      // no-op
    } else {
      // popup, csp, redirect, removeparam, elemhide, generichide, badfilter, ...
      return null;
    }
  }

  // Very short generic patterns would match far too much.
  const bare = pattern.replace(/[|*^]/g, '');
  if (bare.length < 4 && !condition.initiatorDomains) return null;

  if (pattern && pattern !== '*') condition.urlFilter = pattern;
  if (!condition.urlFilter && !condition.initiatorDomains) return null;

  let action;
  let priority;
  if (documentAllow) {
    action = { type: 'allowAllRequests' };
    condition.resourceTypes = ['main_frame', 'sub_frame'];
    priority = PRIORITY.allow;
  } else {
    action = { type: isAllow ? 'allow' : 'block' };
    priority = isAllow ? PRIORITY.allow : important ? PRIORITY.important : PRIORITY.block;
    if (resourceTypes.length) condition.resourceTypes = [...new Set(resourceTypes)];
    if (excludedResourceTypes.length) condition.excludedResourceTypes = [...new Set(excludedResourceTypes)];
  }

  return { priority, action, condition };
}

// Selectors using procedural/extended syntax can't be expressed as plain CSS.
const EXTENDED_SELECTOR = /:(-abp-|has-text|contains|xpath|style|remove|matches-css|upward|nth-ancestor|min-text-length|watch-attr|matches-path|others|if|if-not|properties)/;

function addCosmetic(cosmetic, line) {
  const exception = line.includes('#@#');
  const sep = exception ? '#@#' : '##';
  const idx = line.indexOf(sep);
  const domainPart = line.slice(0, idx);
  const selector = line.slice(idx + sep.length).trim();
  if (!selector || EXTENDED_SELECTOR.test(selector) || selector.startsWith('+js(')) return;

  const domains = domainPart
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d && !d.startsWith('~') && !d.includes('*'));

  if (!domainPart) {
    if (!exception) cosmetic.generic.add(selector);
    return;
  }
  if (!domains.length) return;

  const bucket = exception ? cosmetic.exceptions : cosmetic.specific;
  for (const d of domains) {
    (bucket[d] ??= new Set()).add(selector);
  }
}

// Collapse rules whose urlFilter is just "||host^" and whose other fields match
// into a single rule with a requestDomains list. This shrinks the lists a lot.
const DOMAIN_ONLY = /^\|\|([a-z0-9.-]+\.[a-z0-9-]+)\^?$/;
const DOMAINS_PER_RULE = 1000;

function mergeDomainRules(rules) {
  const groups = new Map();
  const rest = [];
  for (const rule of rules) {
    const match = rule.condition.urlFilter?.match(DOMAIN_ONLY);
    if (!match || rule.condition.isUrlFilterCaseSensitive) {
      rest.push(rule);
      continue;
    }
    const { urlFilter, ...otherCondition } = rule.condition;
    const key = JSON.stringify({ ...rule, condition: otherCondition });
    if (!groups.has(key)) groups.set(key, { template: { ...rule, condition: otherCondition }, domains: new Set() });
    groups.get(key).domains.add(match[1]);
  }

  const merged = [];
  for (const { template, domains } of groups.values()) {
    const list = [...domains];
    for (let i = 0; i < list.length; i += DOMAINS_PER_RULE) {
      merged.push({ ...template, condition: { ...template.condition, requestDomains: list.slice(i, i + DOMAINS_PER_RULE) } });
    }
  }
  return [...merged, ...rest];
}

async function convertList({ id, url }, cosmetic) {
  process.stdout.write(`Fetching ${id}... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();

  const seen = new Set();
  let rules = [];
  let skipped = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;

    if (/#[@?$%]?#|#@\$?#/.test(line)) {
      if (line.includes('##') || line.includes('#@#')) addCosmetic(cosmetic, line);
      continue;
    }

    const rule = convertNetworkFilter(line);
    if (!rule) {
      skipped++;
      continue;
    }
    const key = JSON.stringify(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }

  rules = mergeDomainRules(rules);

  if (rules.length > MAX_RULES_PER_LIST) {
    // Keep allow rules first so exceptions are never dropped in favour of blocks.
    rules.sort((a, b) => b.priority - a.priority);
    console.warn(`\n  ${id}: truncating ${rules.length} -> ${MAX_RULES_PER_LIST} rules`);
    rules.length = MAX_RULES_PER_LIST;
  }

  // Allow rules first, so the popup can tell blocks apart by id (id >= firstBlockId).
  const isAllow = (r) => r.action.type !== 'block';
  rules = [...rules.filter(isAllow), ...rules.filter((r) => !isAllow(r))];
  rules.forEach((r, i) => (r.id = i + 1));
  await writeFile(`rules/${id}.json`, JSON.stringify(rules.map(({ id, ...r }) => ({ id, ...r }))));
  console.log(`${rules.length} rules (${skipped} unsupported filters skipped)`);
  return { rules: rules.length, firstBlockId: rules.findIndex((r) => !isAllow(r)) + 1 };
}

const cosmetic = { generic: new Set(), specific: {}, exceptions: {} };

await mkdir('rules', { recursive: true });
const stats = {};
for (const list of LISTS) stats[list.id] = await convertList(list, cosmetic);

const toArrays = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, [...v]]));
await writeFile(
  'rules/cosmetic.json',
  JSON.stringify({
    generic: [...cosmetic.generic],
    specific: toArrays(cosmetic.specific),
    exceptions: toArrays(cosmetic.exceptions),
  })
);
await writeFile(
  'rules/stats.json',
  JSON.stringify({ builtAt: new Date().toISOString(), ...stats, cosmeticGeneric: cosmetic.generic.size }, null, 2)
);

console.log(
  `Cosmetic: ${cosmetic.generic.size} generic selectors, ${Object.keys(cosmetic.specific).length} site-specific domains`
);
