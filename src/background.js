import { compileFilterTexts } from './filter-engine.js';
import { buildCosmeticCss } from './cosmetics.js';

const DEFAULT_FILTER_LISTS = [
  {
    id: 'easylist',
    name: 'EasyList — ads',
    url: 'https://easylist.to/easylist/easylist.txt',
    enabled: true,
    description: 'General ad blocking rules.'
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy — trackers',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    enabled: true,
    description: 'Tracking scripts, pixels, and telemetry endpoints.'
  },
  {
    id: 'ublock-badware',
    name: 'uBlock filters — Badware',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
    enabled: false,
    description: 'Additional rules for known unwanted or harmful domains.'
  }
];

const PUBLIC_SUFFIX_2_LABEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au',
  'co.jp', 'com.br', 'com.bd', 'net.bd', 'org.bd', 'co.in', 'firm.in',
  'com.cn', 'com.sg', 'co.nz', 'co.za', 'com.mx', 'com.tr', 'com.tw'
]);

async function getState() {
  const stored = await chrome.storage.local.get([
    'globalEnabled', 'filterLists', 'siteExceptions', 'compiledRules',
    'listCompiledRules', 'listCosmeticRules', 'listCosmeticExceptions',
    'cosmeticRules', 'cosmeticExceptions', 'filterStats', 'lastUpdated',
    'lastError', 'customFilters'
  ]);
  return {
    globalEnabled: stored.globalEnabled !== false,
    filterLists: stored.filterLists || DEFAULT_FILTER_LISTS,
    siteExceptions: stored.siteExceptions || [],
    compiledRules: stored.compiledRules || [],
    listCompiledRules: stored.listCompiledRules || [],
    cosmeticRules: stored.cosmeticRules || [],
    listCosmeticRules: stored.listCosmeticRules || [],
    cosmeticExceptions: stored.cosmeticExceptions || [],
    listCosmeticExceptions: stored.listCosmeticExceptions || [],
    filterStats: stored.filterStats || { networkRuleCount: 0, cosmeticRuleCount: 0 },
    lastUpdated: stored.lastUpdated || null,
    lastError: stored.lastError || '',
    customFilters: stored.customFilters || ''
  };
}

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

function getBaseDomain(hostname) {
  const host = normalizeHost(hostname);
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  return PUBLIC_SUFFIX_2_LABEL.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

function hostMatches(hostname, domain) {
  const host = normalizeHost(hostname);
  const target = normalizeHost(domain);
  return !!host && !!target && (host === target || host.endsWith(`.${target}`));
}

function mergeCompiled(listRules, listCosmetics, listCosmeticExceptions, customText) {
  const custom = compileFilterTexts([], customText);
  const dynamicRules = [];
  const seen = new Set();
  const ruleSources = [...(listRules || []), ...custom.dynamicRules];
  for (const rule of ruleSources) {
    const copy = { priority: rule.priority, action: rule.action, condition: rule.condition };
    const key = JSON.stringify(copy);
    if (seen.has(key)) continue;
    seen.add(key);
    dynamicRules.push({ ...copy, id: 10000 + dynamicRules.length });
    if (dynamicRules.length >= 24000) break;
  }

  const cosmetics = [];
  const cosmeticKeys = new Set();
  for (const rule of [...(listCosmetics || []), ...custom.cosmeticRules]) {
    const key = JSON.stringify(rule);
    if (cosmeticKeys.has(key)) continue;
    cosmeticKeys.add(key);
    cosmetics.push(rule);
    if (cosmetics.length >= 6000) break;
  }

  const exceptions = [];
  const exceptionKeys = new Set();
  for (const item of [...(listCosmeticExceptions || []), ...custom.cosmeticExceptions]) {
    const key = `${item.domain}|${item.selector}`;
    if (exceptionKeys.has(key)) continue;
    exceptionKeys.add(key);
    exceptions.push(item);
  }
  return {
    dynamicRules,
    cosmeticRules: cosmetics,
    cosmeticExceptions: exceptions,
    stats: {
      networkRuleCount: dynamicRules.length,
      cosmeticRuleCount: cosmetics.length,
      customNetworkRuleCount: custom.networkRuleCount,
      sourceLines: custom.sourceLines
    }
  };
}

async function rebuildEngine() {
  const state = await getState();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const enabled = state.globalEnabled;
  const addRules = [];

  if (enabled) {
    for (const [index, domain] of state.siteExceptions.slice(0, 5000).entries()) {
      const normalized = normalizeHost(domain);
      if (!normalized || !/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(normalized)) continue;
      addRules.push({
        id: index + 1,
        priority: 10000,
        action: { type: 'allowAllRequests' },
        condition: { urlFilter: `||${normalized}^`, resourceTypes: ['main_frame'] }
      });
    }
    addRules.push(...state.compiledRules.slice(0, 24000));
  }

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? ['core'] : [],
    disableRulesetIds: enabled ? [] : ['core']
  });
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(rule => rule.id),
    addRules
  });
  return { dynamicRuleCount: addRules.length, globalEnabled: enabled };
}

async function updateFilters() {
  const state = await getState();
  const enabledLists = state.filterLists.filter(item => item.enabled);
  try {
    const texts = [];
    for (const list of enabledLists) {
      const response = await fetch(list.url, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
        headers: { 'Accept': 'text/plain,*/*;q=0.8' }
      });
      if (!response.ok) throw new Error(`${list.name}: HTTP ${response.status}`);
      const text = await response.text();
      if (!text || text.length < 100 || /<!doctype html|<html/i.test(text.slice(0, 500))) {
        throw new Error(`${list.name}: the server did not return a filter list.`);
      }
      texts.push(text);
    }

    const listCompilation = compileFilterTexts(texts);
    const merged = mergeCompiled(
      listCompilation.dynamicRules,
      listCompilation.cosmeticRules,
      listCompilation.cosmeticExceptions,
      state.customFilters
    );
    const now = new Date().toISOString();
    await chrome.storage.local.set({
      listCompiledRules: listCompilation.dynamicRules,
      listCosmeticRules: listCompilation.cosmeticRules,
      listCosmeticExceptions: listCompilation.cosmeticExceptions,
      compiledRules: merged.dynamicRules,
      cosmeticRules: merged.cosmeticRules,
      cosmeticExceptions: merged.cosmeticExceptions,
      filterStats: {
        ...merged.stats,
        listNetworkRuleCount: listCompilation.networkRuleCount,
        sourceLines: listCompilation.sourceLines,
        ignoredNetwork: listCompilation.ignoredNetwork,
        truncated: listCompilation.truncated,
        enabledListCount: enabledLists.length
      },
      lastUpdated: now,
      lastError: ''
    });
    await rebuildEngine();
    return { ok: true, lastUpdated: now, filterStats: merged.stats };
  } catch (error) {
    const message = String(error?.message || error || 'Unknown filter update error');
    await chrome.storage.local.set({ lastError: message });
    // Keep the previously installed rules intact if a list download fails.
    return { ok: false, error: message };
  }
}

async function applyCosmeticsToTab(tabId, hostname, state, previousState = null) {
  if (typeof tabId !== 'number' || !hostname) return;
  const target = { tabId };
  if (previousState) {
    const oldCss = buildCosmeticCss(hostname, previousState);
    if (oldCss) {
      try { await chrome.scripting.removeCSS({ target, css: oldCss, origin: 'USER' }); }
      catch { /* CSS may not have been inserted in this document. */ }
    }
  }
  const css = buildCosmeticCss(hostname, state);
  if (!css) return;
  try { await chrome.scripting.insertCSS({ target, css, origin: 'USER' }); }
  catch { /* The tab may be navigating or may not permit extension CSS. */ }
}

function hostnameFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : '';
  } catch { return ''; }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const relevant = ['globalEnabled', 'siteExceptions', 'cosmeticRules', 'cosmeticExceptions'];
  if (!relevant.some(key => key in changes)) return;
  (async () => {
    const current = await getState();
    const previous = { ...current };
    for (const key of relevant) {
      if (key in changes) {
        previous[key] = changes[key].oldValue;
      }
    }
    if (previous.globalEnabled === undefined) previous.globalEnabled = true;
    previous.siteExceptions ||= [];
    previous.cosmeticRules ||= [];
    previous.cosmeticExceptions ||= [];
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(tab => {
      const hostname = hostnameFromUrl(tab.url);
      return hostname ? applyCosmeticsToTab(tab.id, hostname, current, previous) : Promise.resolve();
    }));
  })().catch(() => {});
});

async function initialize() {
  const existing = await chrome.storage.local.get(['filterLists', 'globalEnabled', 'siteExceptions', 'customFilters']);
  const values = {};
  if (!existing.filterLists) values.filterLists = DEFAULT_FILTER_LISTS;
  if (existing.globalEnabled === undefined) values.globalEnabled = true;
  if (!existing.siteExceptions) values.siteExceptions = [];
  if (existing.customFilters === undefined) values.customFilters = '';
  if (Object.keys(values).length) await chrome.storage.local.set(values);
  await rebuildEngine();
  chrome.alarms.create('clearshield-filter-update', { periodInMinutes: 24 * 60 });
}

chrome.runtime.onInstalled.addListener(() => {
  initialize().then(() => updateFilters()).catch(error => {
    chrome.storage.local.set({ lastError: String(error?.message || error) });
  });
});

chrome.runtime.onStartup.addListener(() => {
  initialize().catch(error => chrome.storage.local.set({ lastError: String(error?.message || error) }));
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'clearshield-filter-update') updateFilters();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'APPLY_COSMETICS': {
        const hostname = hostnameFromUrl(sender?.url || sender?.tab?.url);
        if (typeof sender?.tab?.id !== 'number' || !hostname) return { ok: false, error: 'No website tab is available.' };
        const state = await getState();
        await applyCosmeticsToTab(sender.tab.id, hostname, state);
        return { ok: true };
      }
      case 'GET_STATE': {
        const state = await getState();
        const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
        return {
          ok: true,
          globalEnabled: state.globalEnabled,
          filterLists: state.filterLists,
          siteExceptions: state.siteExceptions,
          filterStats: state.filterStats,
          lastUpdated: state.lastUpdated,
          lastError: state.lastError,
          customFilters: state.customFilters,
          installedDynamicRuleCount: dynamicRules.length,
          pausedHost: message.hostname ? state.siteExceptions.find(domain => hostMatches(message.hostname, domain)) || null : null
        };
      }
      case 'SET_GLOBAL': {
        await chrome.storage.local.set({ globalEnabled: Boolean(message.enabled) });
        await rebuildEngine();
        return { ok: true, globalEnabled: Boolean(message.enabled) };
      }
      case 'TOGGLE_SITE': {
        const domain = getBaseDomain(message.hostname || '');
        if (!domain || !domain.includes('.') || domain === 'localhost') return { ok: false, error: 'This page does not have a normal website domain.' };
        const state = await getState();
        const existing = state.siteExceptions;
        const paused = existing.some(item => hostMatches(domain, item));
        if (!paused && existing.length >= 5000) return { ok: false, error: 'The site-exception limit has been reached.' };
        const next = paused ? existing.filter(item => !hostMatches(domain, item)) : [...existing.filter(item => !hostMatches(item, domain)), domain];
        await chrome.storage.local.set({ siteExceptions: next });
        await rebuildEngine();
        return { ok: true, paused: !paused, domain };
      }
      case 'UPDATE_FILTERS':
        return await updateFilters();
      case 'SAVE_FILTER_LISTS': {
        if (!Array.isArray(message.filterLists)) return { ok: false, error: 'Invalid filter list settings.' };
        const current = (await getState()).filterLists;
        const enabledById = new Map(message.filterLists.map(item => [item.id, Boolean(item.enabled)]));
        const next = current.map(item => ({ ...item, enabled: enabledById.has(item.id) ? enabledById.get(item.id) : item.enabled }));
        await chrome.storage.local.set({ filterLists: next });
        return await updateFilters();
      }
      case 'SAVE_CUSTOM_FILTERS': {
        const customFilters = String(message.text || '').slice(0, 1000000);
        const state = await getState();
        const merged = mergeCompiled(
          state.listCompiledRules || state.compiledRules,
          state.listCosmeticRules || state.cosmeticRules,
          state.listCosmeticExceptions || state.cosmeticExceptions,
          customFilters
        );
        await chrome.storage.local.set({
          customFilters,
          compiledRules: merged.dynamicRules,
          cosmeticRules: merged.cosmeticRules,
          cosmeticExceptions: merged.cosmeticExceptions,
          filterStats: { ...state.filterStats, ...merged.stats, customNetworkRuleCount: merged.stats.customNetworkRuleCount },
          lastError: ''
        });
        await rebuildEngine();
        return { ok: true, filterStats: merged.stats };
      }
      case 'RESET_EXCEPTIONS': {
        await chrome.storage.local.set({ siteExceptions: [] });
        await rebuildEngine();
        return { ok: true };
      }
      default:
        return { ok: false, error: 'Unknown command.' };
    }
  })().then(sendResponse).catch(error => {
    sendResponse({ ok: false, error: String(error?.message || error || 'Unexpected error') });
  });
  return true;
});
