document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleExtension');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const shortcutBox = document.getElementById('shortcutBox');
  const shortcutDesc = document.getElementById('shortcutDesc');

  const isMac = (typeof navigator !== 'undefined') && (
    (navigator.platform && navigator.platform.toUpperCase().indexOf('MAC') >= 0) ||
    (navigator.userAgentData && navigator.userAgentData.platform === 'macOS') ||
    (navigator.userAgent && navigator.userAgent.indexOf('Mac') >= 0)
  );

  if (shortcutBox && shortcutDesc) {
    const keyLabel = isMac ? 'CMD ⌘ / CTRL' : 'CTRL';

    // Update shortcut box keyboard labels safely — no innerHTML
    const kbds = shortcutBox.querySelectorAll('kbd');
    if (kbds.length > 0) kbds[0].textContent = keyLabel;

    // Update description text safely using textContent on individual nodes
    const strongEls = shortcutDesc.querySelectorAll('strong');
    if (strongEls.length > 0) strongEls[0].textContent = keyLabel;
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ enabled: true }, (res) => {
      toggle.checked = res.enabled !== false;
      updateUI(toggle.checked);
    });

    toggle.addEventListener('change', () => {
      const isEnabled = toggle.checked;
      try {
        chrome.storage.local.set({ enabled: isEnabled }, () => {
          if (chrome.runtime.lastError) {
            console.warn('BC Smart Copier: Storage write failed —', chrome.runtime.lastError.message);
          }
          updateUI(isEnabled);
        });
      } catch (err) {
        console.error('BC Smart Copier: Storage set failed', err);
      }
    });
  }

  function updateUI(isEnabled) {
    if (isEnabled) {
      statusDot.classList.remove('disabled');
      statusText.textContent = 'Extension is active';
    } else {
      statusDot.classList.add('disabled');
      statusText.textContent = 'Extension disabled';
    }
  }
});
