const $ = id => document.getElementById(id);
let state = null;
let toastTimer = null;

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function showToast(message, isError = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function formatDate(iso) {
  if (!iso) return 'not yet updated';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}

function renderFilterLists() {
  const root = $('filterListContainer');
  root.replaceChildren();
  for (const [index, list] of (state.filterLists || []).entries()) {
    const row = document.createElement('div');
    row.className = 'filter-list-row';

    const icon = document.createElement('div');
    icon.className = 'list-icon';
    icon.textContent = index === 0 ? '⊘' : index === 1 ? '◉' : '⌁';

    const copy = document.createElement('div');
    copy.className = 'list-copy';
    const name = document.createElement('strong');
    name.textContent = list.name;
    const description = document.createElement('p');
    description.textContent = list.description || list.url;
    copy.append(name, description);

    const status = document.createElement('span');
    status.className = 'list-state';
    status.textContent = list.enabled ? 'Enabled' : 'Optional';

    const label = document.createElement('label');
    label.className = 'switch-control';
    label.title = `${list.enabled ? 'Disable' : 'Enable'} ${list.name}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(list.enabled);
    input.dataset.listId = list.id;
    input.setAttribute('aria-label', `${list.enabled ? 'Disable' : 'Enable'} ${list.name}`);
    const track = document.createElement('span');
    track.className = 'switch-track';
    input.addEventListener('change', () => {
      list.enabled = input.checked;
      status.textContent = input.checked ? 'Enabled' : 'Optional';
    });
    label.append(input, track);
    row.append(icon, copy, status, label);
    root.append(row);
  }
}

function renderAllowlist() {
  const domains = state.siteExceptions || [];
  $('allowlistCount').textContent = domains.length ? `${domains.length} site${domains.length === 1 ? '' : 's'} paused` : 'No site exceptions';
  $('allowlistSummary').textContent = domains.length ? 'These domains currently bypass ClearShield filtering.' : 'Use “Pause on this site” in the popup to add a trusted website.';
  const chips = $('allowlistChips');
  chips.replaceChildren();
  if (!domains.length) {
    const empty = document.createElement('span');
    empty.className = 'empty-pill';
    empty.textContent = 'Your allowlist is empty';
    chips.append(empty);
    return;
  }
  for (const domain of domains) {
    const chip = document.createElement('span');
    chip.className = 'allowlist-chip';
    chip.textContent = domain;
    chips.append(chip);
  }
}

function render() {
  const enabled = state.globalEnabled;
  $('topStatus').textContent = enabled ? 'Protection active' : 'Protection paused';
  $('topStatusDot').parentElement.classList.toggle('offline', !enabled);
  $('overviewStatus').textContent = enabled ? 'Your browser, less noisy.' : 'Protection is paused.';
  $('overviewDescription').textContent = enabled
    ? 'ClearShield blocks requests matched by your enabled filter lists and hides supported ad elements directly on the page.'
    : 'Network and cosmetic filtering are currently disabled. Your filters and settings are saved.';
  const stats = state.filterStats || {};
  $('overviewNetwork').textContent = (100 + (stats.networkRuleCount || 0)).toLocaleString();
  $('overviewCosmetic').textContent = (stats.cosmeticRuleCount || 0).toLocaleString();
  $('overviewLists').textContent = (state.filterLists || []).filter(list => list.enabled).length;
  $('lastUpdated').textContent = `Last update: ${formatDate(state.lastUpdated)}`;
  $('customFilters').value = state.customFilters || '';
  renderFilterLists();
  renderAllowlist();
}

async function refresh() {
  const result = await send({ type: 'GET_STATE' });
  if (!result?.ok) throw new Error(result?.error || 'Unable to read settings.');
  state = result;
  render();
}

async function updateFilters() {
  const button = $('updateButton');
  button.disabled = true;
  button.textContent = 'Updating…';
  try {
    const result = await send({ type: 'UPDATE_FILTERS' });
    if (!result?.ok) throw new Error(result?.error || 'Filter-list update failed.');
    await refresh();
    showToast('Filter lists updated successfully.');
  } catch (error) {
    await refresh().catch(() => {});
    showToast(error.message || 'Filter-list update failed.', true);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Update filter lists <span>→</span>';
  }
}

$('updateButton').addEventListener('click', updateFilters);
$('saveListsButton').addEventListener('click', async () => {
  const button = $('saveListsButton');
  button.disabled = true;
  button.textContent = 'Saving & updating…';
  try {
    const filterLists = [...$('filterListContainer').querySelectorAll('input[data-list-id]')].map(input => ({ id: input.dataset.listId, enabled: input.checked }));
    const result = await send({ type: 'SAVE_FILTER_LISTS', filterLists });
    if (!result?.ok) throw new Error(result?.error || 'Could not update the selected lists.');
    await refresh();
    showToast('Filter list preferences saved.');
  } catch (error) {
    await refresh().catch(() => {});
    showToast(error.message || 'Could not update the selected lists.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Save & update';
  }
});

$('saveCustomButton').addEventListener('click', async () => {
  const button = $('saveCustomButton');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const result = await send({ type: 'SAVE_CUSTOM_FILTERS', text: $('customFilters').value });
    if (!result?.ok) throw new Error(result?.error || 'Could not save custom rules.');
    await refresh();
    showToast('Your custom rules are saved and active.');
  } catch (error) { showToast(error.message || 'Could not save custom rules.', true); }
  finally { button.disabled = false; button.innerHTML = 'Save my rules <span>→</span>'; }
});

$('clearAllowlistButton').addEventListener('click', async () => {
  const domains = state.siteExceptions || [];
  if (!domains.length) { showToast('Your allowlist is already empty.'); return; }
  try {
    const result = await send({ type: 'RESET_EXCEPTIONS' });
    if (!result?.ok) throw new Error(result?.error || 'Could not clear exceptions.');
    await refresh();
    showToast('All site exceptions removed.');
  } catch (error) { showToast(error.message || 'Could not clear exceptions.', true); }
});

// Keep the panel in sync if the popup changes global or site protection.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(key => ['globalEnabled','siteExceptions','filterStats','lastUpdated','filterLists','customFilters','lastError'].includes(key))) {
    refresh().catch(() => {});
  }
});

refresh().catch(error => showToast(error.message || 'Unable to initialize settings.', true));
