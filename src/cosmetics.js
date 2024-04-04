// Small, safe CSS-only cosmetic engine. It intentionally supports standard CSS selectors only.
const BASIC_SELECTORS = [
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[id^="google_ads_iframe"]',
  '[id^="google_ads"]',
  '[class~="ad-banner"]',
  '[class~="ad-container"]',
  '[class~="advertisement"]',
  '[aria-label="Advertisement"]',
  '[aria-label="advertisement"]',
  '[data-ad-slot]',
  '[data-ad-format]',
  '[data-ad-client]',
  '[data-testid="ad-banner"]',
  '.adsbygoogle',
  '.ad-placement',
  '.sponsored-ad'
];

export function safeCosmeticSelector(selector) {
  return typeof selector === 'string' && selector.length > 0 && selector.length <= 700 &&
    !/[{}<>;\n\r]/.test(selector) && !/@|\burl\s*\(|expression\s*\(/i.test(selector) &&
    !/:-abp-|:has-text\(|:matches-css(?:-before|-after)?\(|:xpath\(|:style\(/i.test(selector);
}

function hostMatches(host, domain) {
  return !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));
}

function matchesScope(host, rule) {
  const includes = Array.isArray(rule.includeDomains) ? rule.includeDomains : [];
  const excludes = Array.isArray(rule.excludeDomains) ? rule.excludeDomains : [];
  if (excludes.some(domain => hostMatches(host, domain))) return false;
  return includes.length === 0 || includes.some(domain => hostMatches(host, domain));
}

export function buildCosmeticCss(hostname, state) {
  const host = String(hostname || '').toLowerCase();
  if (!host || !state || state.globalEnabled === false) return '';
  if ((state.siteExceptions || []).some(domain => hostMatches(host, domain))) return '';

  const excludedSelectors = new Set(
    (state.cosmeticExceptions || [])
      .filter(item => item.domain && hostMatches(host, item.domain))
      .map(item => item.selector)
  );
  const selectors = new Set(BASIC_SELECTORS);
  for (const rule of state.cosmeticRules || []) {
    if (!rule || !safeCosmeticSelector(rule.selector) || excludedSelectors.has(rule.selector)) continue;
    if (matchesScope(host, rule)) selectors.add(rule.selector);
  }

  // USER-origin extension CSS is inserted via chrome.scripting, so it is not
  // subject to a page's inline-style CSP. One selector per rule limits fallout.
  return [...selectors].filter(safeCosmeticSelector)
    .map(selector => `${selector}{display:none!important;visibility:hidden!important;}`)
    .join('\n');
}
