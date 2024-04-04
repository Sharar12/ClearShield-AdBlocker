// ClearShield's deliberately conservative subset of the Adblock Plus filter syntax.
// Remote lists are treated as data only; this module never evaluates list content as code.

export const MAX_DYNAMIC_NETWORK_RULES = 24000;
export const MAX_COSMETIC_RULES = 6000;

const RESOURCE_TYPES = new Map([
  ['document', 'main_frame'],
  ['subdocument', 'sub_frame'],
  ['sub_frame', 'sub_frame'],
  ['script', 'script'],
  ['image', 'image'],
  ['stylesheet', 'stylesheet'],
  ['xmlhttprequest', 'xmlhttprequest'],
  ['xhr', 'xmlhttprequest'],
  ['font', 'font'],
  ['media', 'media'],
  ['object', 'object'],
  ['ping', 'ping'],
  ['websocket', 'websocket'],
  ['other', 'other'],
]);

const UNSUPPORTED_MODIFIERS = new Set([
  'csp', 'permissions', 'popup', 'popunder', 'redirect',
  'redirect-rule', 'rewrite', 'removeparam', 'header', 'method', 'to',
  'denyallow', 'ipaddress', 'elemhide', 'generichide', 'genericblock',
  'specifichide', 'urltransform', 'replace', 'jsonprune',
  'hls', 'mp4', 'webrtc', 'all', 'match-case',
]);

function isSafeDomain(value) {
  const v = String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  return v.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v) ? v : null;
}

export function isSafeCosmeticSelector(selector) {
  const s = String(selector || '').trim();
  if (!s || s.length > 700) return false;
  // Exclude procedural/non-CSS filters and syntax that could smuggle declarations
  // into the injected stylesheet. Each accepted selector is inserted separately.
  if (/[{}<>;\n\r]/.test(s) || /@|\burl\s*\(|expression\s*\(/i.test(s)) return false;
  if (/:-abp-|:has-text\(|:matches-css(?:-before|-after)?\(|:xpath\(|:style\(/i.test(s)) return false;
  return true;
}

function parseCosmeticLine(line, cosmeticRules, cosmeticExceptions) {
  const exceptionIndex = line.indexOf('#@#');
  if (exceptionIndex >= 0) {
    const domainPart = line.slice(0, exceptionIndex).trim();
    const selector = line.slice(exceptionIndex + 3).trim();
    if (!isSafeCosmeticSelector(selector)) return;
    const domains = domainPart.split(',').map(s => s.trim()).filter(Boolean);
    if (domains.length && domains.every(d => d.startsWith('~') || isSafeDomain(d))) {
      for (const domain of domains) {
        if (!domain.startsWith('~')) cosmeticExceptions.push({ domain: isSafeDomain(domain), selector });
      }
    }
    return;
  }

  const index = line.indexOf('##');
  if (index < 0) return;
  const domainPart = line.slice(0, index).trim();
  const selector = line.slice(index + 2).trim();
  if (!isSafeCosmeticSelector(selector)) return;

  let includeDomains = [];
  let excludeDomains = [];
  if (domainPart) {
    const domains = domainPart.split(',').map(s => s.trim()).filter(Boolean);
    if (!domains.length) return;
    for (const entry of domains) {
      const excluded = entry.startsWith('~');
      const domain = isSafeDomain(excluded ? entry.slice(1) : entry);
      if (!domain) continue;
      (excluded ? excludeDomains : includeDomains).push(domain);
    }
    if (!includeDomains.length && !excludeDomains.length) return;
  }
  cosmeticRules.push({ selector, includeDomains, excludeDomains });
}

function parseNetworkLine(raw) {
  let line = raw.trim();
  if (!line || line.startsWith('!') || line.startsWith('[')) return null;
  if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) return null;

  const exception = line.startsWith('@@');
  if (exception) line = line.slice(2);

  let pattern = line;
  let optionText = '';
  const dollar = line.lastIndexOf('$');
  if (dollar > -1) {
    // A '$' can be literal in a URL filter, but list syntaxes normally use the
    // final '$' for modifiers. Only split when the suffix resembles options.
    const suffix = line.slice(dollar + 1);
    if (/^[a-zA-Z~][a-zA-Z0-9_~,*|=.-]*(?:,[a-zA-Z0-9_~,*|=.-]+)*$/.test(suffix)) {
      pattern = line.slice(0, dollar);
      optionText = suffix;
    }
  }
  pattern = pattern.trim();
  if (!pattern || pattern.length > 1800 || pattern.startsWith('/') || pattern.endsWith('/')) return null;
  if (/[\n\r{}<>]/.test(pattern)) return null;

  const options = optionText ? optionText.split(',') : [];
  const positiveTypes = new Set();
  const negativeTypes = new Set();
  const includeDomains = [];
  const excludeDomains = [];
  let domainType;
  let caseSensitive = false;
  let important = false;
  let badfilter = false;

  for (const rawOption of options) {
    const option = rawOption.trim();
    if (!option) continue;
    const negated = option.startsWith('~');
    const body = negated ? option.slice(1) : option;
    const equals = body.indexOf('=');
    const name = (equals >= 0 ? body.slice(0, equals) : body).toLowerCase();
    const value = equals >= 0 ? body.slice(equals + 1) : '';

    if (name === 'domain') {
      for (const domainEntry of value.split('|')) {
        const entry = domainEntry.trim();
        if (!entry) continue;
        const excluded = entry.startsWith('~');
        const domain = isSafeDomain(excluded ? entry.slice(1) : entry);
        if (domain) (excluded ? excludeDomains : includeDomains).push(domain);
      }
      continue;
    }
    if (name === 'third-party' || name === '3p') {
      domainType = negated ? 'firstParty' : 'thirdParty';
      continue;
    }
    if (name === 'first-party' || name === '1p') {
      domainType = negated ? 'thirdParty' : 'firstParty';
      continue;
    }
    if (name === 'match-case') {
      caseSensitive = !negated;
      continue;
    }
    if (name === 'important') {
      important = !negated;
      continue;
    }
    if (name === 'badfilter') {
      badfilter = !negated;
      continue;
    }
    if (UNSUPPORTED_MODIFIERS.has(name) || name === 'collapse') return null;

    const type = RESOURCE_TYPES.get(name);
    if (type) {
      (negated ? negativeTypes : positiveTypes).add(type);
      continue;
    }

    // Unknown modifiers can change semantics materially, so fail closed by
    // skipping that filter instead of silently changing its meaning.
    return null;
  }

  const condition = { urlFilter: pattern };
  if (positiveTypes.size) condition.resourceTypes = [...positiveTypes];
  if (negativeTypes.size) condition.excludedResourceTypes = [...negativeTypes];
  if (includeDomains.length) condition.initiatorDomains = [...new Set(includeDomains)];
  if (excludeDomains.length) condition.excludedInitiatorDomains = [...new Set(excludeDomains)];
  if (domainType) condition.domainType = domainType;
  if (caseSensitive) condition.isUrlFilterCaseSensitive = true;

  return {
    priority: important ? (exception ? 4 : 3) : exception ? 2 : 1,
    action: { type: exception ? 'allow' : 'block' },
    condition,
    ...(badfilter ? { badfilter: true } : {}),
  };
}

export function compileFilterTexts(filterTexts, customText = '') {
  const rawCosmetics = [];
  const cosmeticExceptions = [];
  const networkEntries = [];
  const seenNetwork = new Set();
  const badfilterKeys = new Set();
  const seenCosmetic = new Set();
  let sourceLines = 0;
  let ignoredNetwork = 0;
  let networkRulesTruncated = false;

  const allTexts = [...filterTexts, customText].filter(Boolean);
  for (const text of allTexts) {
    const lines = String(text).split(/\r?\n/);
    for (const rawLine of lines) {
      sourceLines++;
      const line = rawLine.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;

      if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) {
        const before = rawCosmetics.length;
        parseCosmeticLine(line, rawCosmetics, cosmeticExceptions);
        if (rawCosmetics.length > before && rawCosmetics.length > MAX_COSMETIC_RULES * 2) {
          // Keep parsing network rules but avoid unbounded memory for cosmetic spam.
          rawCosmetics.splice(MAX_COSMETIC_RULES * 2);
        }
        continue;
      }

      const parsed = parseNetworkLine(line);
      if (!parsed) {
        ignoredNetwork++;
        continue;
      }
      const badfilter = Boolean(parsed.badfilter);
      const networkRule = { ...parsed };
      delete networkRule.badfilter;
      const key = JSON.stringify(networkRule);
      if (badfilter) {
        badfilterKeys.add(key);
        continue;
      }
      if (seenNetwork.has(key)) continue;
      seenNetwork.add(key);
      if (networkEntries.length < MAX_DYNAMIC_NETWORK_RULES) networkEntries.push({ key, rule: networkRule });
      else networkRulesTruncated = true;
    }
  }

  // Keep cosmetic exceptions scoped by host; the page script applies them locally.
  const exceptionKeys = new Set();
  const finalExceptions = [];
  for (const exception of cosmeticExceptions) {
    const key = `${exception.domain}|${exception.selector}`;
    if (!exceptionKeys.has(key)) {
      exceptionKeys.add(key);
      finalExceptions.push(exception);
    }
  }

  const finalCosmetics = [];
  for (const rule of rawCosmetics) {
    const key = JSON.stringify(rule);
    if (seenCosmetic.has(key)) continue;
    seenCosmetic.add(key);
    finalCosmetics.push(rule);
    if (finalCosmetics.length >= MAX_COSMETIC_RULES) break;
  }

  const networkRules = networkEntries.filter(entry => !badfilterKeys.has(entry.key)).slice(0, MAX_DYNAMIC_NETWORK_RULES).map(entry => entry.rule);
  const dynamicRules = networkRules.map((rule, index) => ({ ...rule, id: 10000 + index }));
  return {
    dynamicRules,
    cosmeticRules: finalCosmetics,
    cosmeticExceptions: finalExceptions,
    sourceLines,
    networkRuleCount: dynamicRules.length,
    cosmeticRuleCount: finalCosmetics.length,
    ignoredNetwork,
    truncated: sourceLines > 0 && (networkRulesTruncated || networkEntries.length >= MAX_DYNAMIC_NETWORK_RULES || rawCosmetics.length > MAX_COSMETIC_RULES),
  };
}
