// The background service worker applies cosmetics through chrome.scripting.insertCSS
// with USER origin. This content script only signals the new top-level document;
// it does not inspect page content or collect browsing data.
chrome.runtime.sendMessage({ type: 'APPLY_COSMETICS' }).catch(() => {});
