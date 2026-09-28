# Private Ad Blocker

A Manifest V3 Chrome extension that blocks ads and trackers using EasyList and EasyPrivacy. There's no telemetry and no remote servers. All filtering happens inside Chrome.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the shield icon. It shows how many requests were blocked on the current tab.

## Features

- **Network blocking** with `declarativeNetRequest` rules converted from EasyList (ads) and EasyPrivacy (trackers).
- **Element hiding**: about 13k generic plus site-specific EasyList selectors, injected as user-origin CSS so pages can't override them.
- **Popup** with a global on/off switch, a per-site toggle and a count of requests blocked on the current page.
- **Settings page** with an allowlist and extra domains to block.

## Updating filter lists

```bash
npm run build   # downloads the lists and regenerates rules/
```

Then click the reload icon for the extension on `chrome://extensions`.

## How the conversion works

`scripts/build-rules.mjs` translates Adblock Plus syntax into DNR rules:

- `||host^` filters with the same options are merged into one rule with a `requestDomains` list. This takes about 105k filters down to roughly 13k rules, well under Chrome's guaranteed 30k static-rule limit.
- The options `third-party`, `domain=`, resource types, `match-case`, `important` and `@@…$document` are supported.
- Regex filters and advanced options (`redirect`, `removeparam`, `csp`, scriptlets, procedural cosmetics) are skipped. MV3 can't express most of them.

Priorities: block = 1, exception = 2, `$important` = 3, your custom blocks = 4, your allowlist = 100.
