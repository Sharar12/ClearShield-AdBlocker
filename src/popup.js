const $ = id => document.getElementById(id);
let activeTab = null;
let currentHostname = '';
let currentState = null;

function hostFromTab(tab) {
  try {
    const url = new URL(tab?.url || '');
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname : '';
  } catch { return ''; }
}

function baseDomain(hostname) {
  const multiSuffix = new Set(['co.uk','org.uk','ac.uk','gov.uk','com.au','net.au','org.au','co.jp','com.br','com.bd','net.bd','org.bd','co.in','com.cn','com.sg','co.nz','co.za','com.mx','com.tr','com.tw']);
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return hostname.toLowerCase();
  const suffix = labels.slice(-2).join('.');
  return multiSuffix.has(suffix) ? labels.slice(-3).join('.') : suffix;
}

function isPaused(host, exceptions = []) {
  return exceptions.some(domain => host === domain || host.endsWith(`.${domain}`));
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function refresh() {
  currentState = await send({ type: 'GET_STATE', hostname: currentHostname });
  if (!currentState?.ok) throw new Error(currentState?.error || 'Could not read ClearShield status.');

  const enabled = currentState.globalEnabled;
  $('globalStatus').textContent = enabled ? 'Protection is on' : 'Protection is paused';
  $('globalDescription').textContent = enabled ? 'Blocking ads and common trackers.' : 'Network and cosmetic filtering are disabled.';
  $('globalToggle').setAttribute('aria-checked', String(enabled));
  $('statusDot').classList.toggle('off', !enabled);
  $('shieldGlyph').textContent = enabled ? '✓' : '–';

  const paused = currentHostname && isPaused(currentHostname, currentState.siteExceptions || []);
  $('siteHost').textContent = currentHostname || 'Browser settings page';
  $('siteStatus').textContent = !currentHostname ? 'Open a website to manage protection' : paused ? 'Protection paused for this domain' : enabled ? 'Protection enabled on this site' : 'Global protection is paused';
  $('siteToggle').textContent = paused ? 'Resume on this site' : 'Pause on this site';
  $('siteToggle').setAttribute('aria-pressed', String(Boolean(paused)));
  $('siteToggle').disabled = !currentHostname || currentHostname === 'localhost' || !currentHostname.includes('.');

  const stats = currentState.filterStats || {};
  $('networkCount').textContent = (100 + (stats.networkRuleCount || 0)).toLocaleString();
  $('cosmeticCount').textContent = (stats.cosmeticRuleCount || 0).toLocaleString();
  $('listCount').textContent = (currentState.filterLists || []).filter(list => list.enabled).length;
  $('errorText').hidden = !currentState.lastError;
  $('errorText').textContent = currentState.lastError ? `Filter update note: ${currentState.lastError}` : '';
}

$('globalToggle').addEventListener('click', async () => {
  $('globalToggle').disabled = true;
  try {
    await send({ type: 'SET_GLOBAL', enabled: !currentState.globalEnabled });
    await refresh();
  } catch (error) { $('siteMessage').textContent = error.message || 'Unable to change protection.'; }
  finally { $('globalToggle').disabled = false; }
});

$('siteToggle').addEventListener('click', async () => {
  $('siteToggle').disabled = true;
  $('siteMessage').textContent = '';
  try {
    const result = await send({ type: 'TOGGLE_SITE', hostname: currentHostname });
    if (!result?.ok) throw new Error(result?.error || 'Unable to update this site.');
    $('siteMessage').textContent = result.paused ? `Protection paused for ${result.domain}.` : `Protection resumed for ${result.domain}.`;
    await refresh();
  } catch (error) { $('siteMessage').textContent = error.message || 'Unable to update this site.'; }
  finally { $('siteToggle').disabled = false; }
});

$('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());

(async () => {
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentHostname = hostFromTab(activeTab);
    await refresh();
  } catch (error) {
    $('globalStatus').textContent = 'Could not load status';
    $('globalDescription').textContent = 'Try reopening the popup.';
    $('errorText').hidden = false;
    $('errorText').textContent = error.message || String(error);
  }
})();
