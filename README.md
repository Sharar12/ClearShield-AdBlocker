# ClearShield — Ad & Tracker Blocker

**A privacy-first Manifest V3 extension for Chromium browsers.** The first release is an installable foundation: network request blocking, supported cosmetic filters, automatic list updates, per-site pauses, and custom rules. It is built to run locally and does not contain analytics, an account system, or an advertising component.

## Features

- **Network filtering:** a small built-in starter ruleset is active immediately, even before list downloads finish.
- **Filter-list updates:** EasyList and EasyPrivacy are enabled by default; an optional uBlock Origin badware list is available in Settings.
- **Cosmetic filtering:** supported `##` selector rules hide matching elements. Generic rules and domain-scoped rules are handled separately.
- **Site exceptions:** pause network and cosmetic filtering for the current site's base domain from the popup.
- **Custom rules:** add common network rules such as `||ads.example.com^`, allow rules such as `@@||trusted.example.com^`, and cosmetic rules such as `news.example##.sponsored-card`.
- **Global switch:** pause or resume all ClearShield filtering without deleting your preferences.
- **Automatic updates:** enabled lists are refreshed when requested and approximately every 24 hours.
- **No telemetry:** ClearShield does not send visited URLs, blocked requests, or usage events to a ClearShield server.

## Install locally

1. Clone or download this repository.
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
   - Opera: `opera://extensions`
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository directory (the folder containing `manifest.json`).
5. Pin ClearShield to the toolbar. Open its popup or click **Settings** to update lists and configure filters.

When changing extension source code, use **Reload** on the browser's extensions page. After updating lists, refresh an affected website to apply the new network rules and cosmetic selectors consistently.

## Permissions explained

- `declarativeNetRequest`: let the browser enforce request rules without routing browsing traffic through a proxy.
- `storage` and `unlimitedStorage`: keep sizeable downloaded filter data and preferences locally without running into the standard local-storage quota.
- `alarms`: schedule daily filter-list refreshes.
- `scripting`: apply and remove cosmetic CSS through the browser extension API rather than page-owned style tags.
- Host access to websites: needed for content-script cosmetic filtering across pages and for fetching the selected public filter lists.

The extension does not upload browsing history. Enabling a public list does contact that list's host when the list is updated, so those requests are visible to your browser/network provider as ordinary HTTPS requests.

## Supported filter syntax (current MVP)

Supported network syntax includes common URL filters (`||domain^`, `|https://...|`), allow rules (`@@`), resource-type options (`script`, `image`, `stylesheet`, `xmlhttprequest`/`xhr`, `subdocument`, `font`, `media`, `object`, `ping`, `websocket`, `document`), first/third-party options, `domain=` include/exclude scopes, `match-case`, and `important`. Cosmetic syntax includes `domain##selector`, `~domain##selector`, and `##selector`. Cosmetic exceptions (`#@#`) are parsed for host-scoped selector exceptions.

Procedural cosmetic filters and modifier-driven behaviors such as redirects, CSP, query-parameter removal, scriptlets, and other advanced filter syntax are intentionally skipped instead of being interpreted approximately. A bounded number of network/cosmetic rules are installed to stay within Chromium's Declarative Net Request rule quotas. Not every upstream filter rule is supported by this parser.

## Known limits

- No ad blocker can promise to block every ad. Ads served from the same domain as the content, server-side ad insertion, and frequently changing first-party ad systems may remain.
- Cosmetic rules depend on the selector syntax supported by the browser. Some sites also render content in closed shadow roots or isolated players.
- An enabled remote list is trusted configuration data. ClearShield accepts selectors and filter patterns only; it never evaluates downloaded JavaScript.
- Filter lists can occasionally break site features. Use the per-site pause or disable a list if something stops working.
- The MVP has no per-request blocked counter. The displayed totals are the number of installed/available rules, not the number of ads removed.

## Sources and attribution

Default list endpoints:

- EasyList: <https://easylist.to/easylist/easylist.txt>
- EasyPrivacy: <https://easylist.to/easylist/easyprivacy.txt>
- uBlock Origin badware filters: <https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt>

Filter-list content remains subject to the source project's own license and contribution terms. ClearShield's parser and UI are original project code; the MIT license in this repository applies to that code, not to third-party list data.

## Development

Requires Node.js 18+ to run the lightweight parser tests:

```bash
npm test
```

The extension itself needs no build step or package install; it uses the browser's built-in extension APIs and local JavaScript files.

<!-- [2024-04-04] feat: initialize Chromium Manifest V3 extension structure -->

<!-- [2024-04-04] feat: implement declarativeNetRequest block rules for ad domains -->
