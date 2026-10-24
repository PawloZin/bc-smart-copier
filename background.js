/**
 * BC Smart Copier - Service Worker
 *
 * Error report screenshots. Content scripts cannot call
 * chrome.tabs.captureVisibleTab, and on http:// BC pages they cannot put an
 * image into the clipboard (no async Clipboard API outside secure contexts).
 * So the screenshot is taken here, kept in session storage (memory only,
 * cleared when the browser closes) and copied by a short-lived extension tab.
 * Capturing requires the optional "<all_urls>" host permission, which the
 * popup requests when the screenshot option is switched on.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender.tab) return false;

  if (message.type === 'capture-visible-tab') {
    captureToSession(sender.tab.windowId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true; // keep the channel open for the async response
  }

  if (message.type === 'copy-screenshot') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('screenshot/screenshot.html'),
      openerTabId: sender.tab.id,
      index: sender.tab.index + 1,
      active: true
    }).then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
    return true;
  }

  return false;
});

async function captureToSession(windowId) {
  const png = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  try {
    await chrome.storage.session.set({ screenshot: png });
  } catch (err) {
    // Over the session storage quota (very large screens) — JPEG is much smaller
    const jpeg = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });
    await chrome.storage.session.set({ screenshot: jpeg });
  }
}
