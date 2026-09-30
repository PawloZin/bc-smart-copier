// Must stay in sync with VALID_SHORTCUTS / DEFAULT_SHORTCUTS in content/content.js
const SHORTCUT_OPTIONS = ['shift', 'alt', 'ctrl', 'alt+shift', 'ctrl+shift', 'ctrl+alt'];
const DEFAULT_SHORTCUTS = { cell: 'shift', action: 'alt+shift' };

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleExtension');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const versionEl = document.getElementById('version');
  const shortcutBoxCell = document.getElementById('shortcutBoxCell');
  const shortcutBoxAction = document.getElementById('shortcutBoxAction');
  const selectCell = document.getElementById('shortcutCell');
  const selectAction = document.getElementById('shortcutAction');
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

  // Populate both selects with the same option list
  for (const select of [selectCell, selectAction]) {
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

  selectCell.addEventListener('change', onShortcutChange);
  selectAction.addEventListener('change', onShortcutChange);

  resetButton.addEventListener('click', () => {
    renderShortcuts(DEFAULT_SHORTCUTS);
    saveSettings({ shortcuts: { ...DEFAULT_SHORTCUTS } });
  });

  function onShortcutChange() {
    const next = { cell: selectCell.value, action: selectAction.value };
    const hasConflict = next.cell === next.action;

    conflictError.hidden = !hasConflict;
    updateShortcutPreview(next);

    // Keep the last valid configuration stored until the conflict is resolved
    if (!hasConflict) saveSettings({ shortcuts: next });
  }

  function renderShortcuts(shortcuts) {
    selectCell.value = shortcuts.cell;
    selectAction.value = shortcuts.action;
    conflictError.hidden = true;
    updateShortcutPreview(shortcuts);
  }

  function updateShortcutPreview(shortcuts) {
    renderKeys(shortcutBoxCell, shortcuts.cell);
    renderKeys(shortcutBoxAction, shortcuts.action);

    const usesCtrl = [shortcuts.cell, shortcuts.action].some((value) => value.split('+').includes('ctrl'));
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

  function normalizeShortcuts(value) {
    const cell = value && SHORTCUT_OPTIONS.includes(value.cell) ? value.cell : DEFAULT_SHORTCUTS.cell;
    const action = value && SHORTCUT_OPTIONS.includes(value.action) ? value.action : DEFAULT_SHORTCUTS.action;
    if (cell === action) return { ...DEFAULT_SHORTCUTS };
    return { cell, action };
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
