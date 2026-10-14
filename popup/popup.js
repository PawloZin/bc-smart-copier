// Must stay in sync with VALID_SHORTCUTS / SHORTCUT_ACTIONS / DEFAULT_SHORTCUTS in content/content.js
const SHORTCUT_OPTIONS = ['shift', 'alt', 'ctrl', 'alt+shift', 'ctrl+shift', 'ctrl+alt'];
const SHORTCUT_ACTIONS = ['cell', 'action', 'table'];
const DEFAULT_SHORTCUTS = { cell: 'shift', action: 'alt+shift', table: 'alt' };

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleExtension');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const versionEl = document.getElementById('version');
  // One select + one key preview per configurable action
  const shortcutControls = {
    cell: { select: document.getElementById('shortcutCell'), box: document.getElementById('shortcutBoxCell') },
    action: { select: document.getElementById('shortcutAction'), box: document.getElementById('shortcutBoxAction') },
    table: { select: document.getElementById('shortcutTable'), box: document.getElementById('shortcutBoxTable') }
  };
  const ctrlWarning = document.getElementById('ctrlWarning');
  const conflictError = document.getElementById('conflictError');
  const resetButton = document.getElementById('resetShortcuts');

  const isMac = (typeof navigator !== 'undefined') && (
    (navigator.userAgentData && navigator.userAgentData.platform === 'macOS') ||
    (navigator.platform && navigator.platform.toUpperCase().indexOf('MAC') >= 0) ||
    (navigator.userAgent && navigator.userAgent.indexOf('Mac') >= 0)
  );

  const KEY_LABELS = isMac
    ? { ctrl: '⌘ CMD', alt: '⌥ OPTION', shift: '⇧ SHIFT' }
    : { ctrl: 'CTRL', alt: 'ALT', shift: 'SHIFT' };

  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  if (versionEl && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // Populate every select with the same option list
  for (const name of SHORTCUT_ACTIONS) {
    const select = shortcutControls[name].select;
    select.addEventListener('change', onShortcutChange);
    for (const value of SHORTCUT_OPTIONS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.split('+').map((key) => KEY_LABELS[key]).join(' + ');
      select.appendChild(option);
    }
  }

  renderShortcuts(DEFAULT_SHORTCUTS);

  if (hasStorage) {
    chrome.storage.local.get({ enabled: true, shortcuts: DEFAULT_SHORTCUTS }, (res) => {
      toggle.checked = res.enabled !== false;
      updateUI(toggle.checked);
      renderShortcuts(normalizeShortcuts(res.shortcuts));
    });

    toggle.addEventListener('change', () => {
      const isEnabled = toggle.checked;
      saveSettings({ enabled: isEnabled }, () => updateUI(isEnabled));
    });
  }

  resetButton.addEventListener('click', () => {
    renderShortcuts(DEFAULT_SHORTCUTS);
    saveSettings({ shortcuts: { ...DEFAULT_SHORTCUTS } });
  });

  function onShortcutChange() {
    const next = {};
    for (const name of SHORTCUT_ACTIONS) next[name] = shortcutControls[name].select.value;
    const hasConflict = new Set(Object.values(next)).size < SHORTCUT_ACTIONS.length;

    conflictError.hidden = !hasConflict;
    updateShortcutPreview(next);

    // Keep the last valid configuration stored until the conflict is resolved
    if (!hasConflict) saveSettings({ shortcuts: next });
  }

  function renderShortcuts(shortcuts) {
    for (const name of SHORTCUT_ACTIONS) shortcutControls[name].select.value = shortcuts[name];
    conflictError.hidden = true;
    updateShortcutPreview(shortcuts);
  }

  function updateShortcutPreview(shortcuts) {
    for (const name of SHORTCUT_ACTIONS) renderKeys(shortcutControls[name].box, shortcuts[name]);

    const usesCtrl = Object.values(shortcuts).some((value) => value.split('+').includes('ctrl'));
    ctrlWarning.hidden = !usesCtrl;
    ctrlWarning.textContent = `${isMac ? '⌘ CMD' : 'CTRL'} + Click collides with multi-row selection in ` +
      'Business Central — while this shortcut is active, you cannot select several rows with it.';
  }

  // Builds <kbd> key hints safely — no innerHTML
  function renderKeys(container, shortcut) {
    container.replaceChildren();
    const keys = [...shortcut.split('+').map((key) => KEY_LABELS[key]), 'Click'];
    keys.forEach((label, index) => {
      if (index > 0) container.append(' + ');
      const kbd = document.createElement('kbd');
      kbd.textContent = label;
      container.append(kbd);
    });
  }

  // Same resolution as normalizeShortcuts in content/content.js
  function normalizeShortcuts(value) {
    const result = {};
    const used = new Set();
    for (const name of SHORTCUT_ACTIONS) {
      const candidates = [value && value[name], DEFAULT_SHORTCUTS[name], ...SHORTCUT_OPTIONS];
      const pick = candidates.find((c) => SHORTCUT_OPTIONS.includes(c) && !used.has(c));
      result[name] = pick;
      used.add(pick);
    }
    return result;
  }

  function saveSettings(values, onSaved) {
    if (!hasStorage) return;
    try {
      chrome.storage.local.set(values, () => {
        if (chrome.runtime.lastError) {
          console.warn('BC Smart Copier: Storage write failed —', chrome.runtime.lastError.message);
        }
        if (onSaved) onSaved();
      });
    } catch (err) {
      console.error('BC Smart Copier: Storage set failed', err);
    }
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
