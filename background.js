/**
 * BC Smart Copier - Service Worker
 *
 * Only job: take a screenshot of the visible tab for an error report.
 * Content scripts cannot call chrome.tabs.captureVisibleTab themselves.
 * Requires the optional "<all_urls>" host permission, which the popup
 * requests when the screenshot option is switched on.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'capture-visible-tab' || !sender.tab) return false;

  chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
    .then((dataUrl) => sendResponse({ dataUrl }))
    .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
  return true; // keep the channel open for the async response
});
