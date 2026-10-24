// Copies the error report screenshot (taken by background.js) to the
// clipboard, then closes itself so the BC tab comes back to the front.
// Extension pages are a secure context, unlike http:// BC pages.

const CLOSE_DELAY = 700;

const statusEl = document.getElementById('status');
const copyButton = document.getElementById('copyButton');
const image = document.getElementById('shot');

let blob = null;

chrome.storage.session.get('screenshot', async ({ screenshot }) => {
  if (!screenshot) {
    statusEl.textContent = 'No screenshot found — click the error report button in Business Central again.';
    return;
  }
  image.src = screenshot;
  image.hidden = false;
  blob = await (await fetch(screenshot)).blob();
  copy(true);
});

copyButton.addEventListener('click', () => copy(false));

async function copy(automatic) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    statusEl.textContent = 'Screenshot copied — paste it next to the error report.';
    copyButton.hidden = true;
    if (automatic) setTimeout(() => window.close(), CLOSE_DELAY);
  } catch (err) {
    // Usually "document is not focused" — a click always works
    statusEl.textContent = 'Click the button to copy the screenshot.';
    copyButton.hidden = false;
  }
}
