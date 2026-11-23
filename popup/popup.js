// Must stay in sync with VALID_SHORTCUTS / SHORTCUT_ACTIONS / DEFAULT_SHORTCUTS in content/content.js
const SHORTCUT_OPTIONS = ['shift', 'alt', 'ctrl', 'alt+shift', 'ctrl+shift', 'ctrl+alt'];
const SHORTCUT_ACTIONS = ['cell', 'action', 'table'];
const DEFAULT_SHORTCUTS = { cell: 'shift', action: 'alt+shift', table: 'alt' };
// Must stay in sync with DEFAULT_AGENT_INSTRUCTIONS / DEFAULT_ERROR_REPORT in content/content.js
const DEFAULT_AGENT_INSTRUCTIONS =
  'Help investigate this Microsoft Dynamics 365 Business Central error.\n' +
  '1. Explain what the error means and its most likely cause, using the message, the technical details and the record data above.\n' +
  '2. Search the knowledge base (documentation, Confluence pages and Jira issues) for similar errors and how they were solved; cite the issue keys and pages you use.\n' +
  '3. Check the knowledge base thoroughly, including the application code it contains (tables, pages, codeunits, triggers, procedures, event subscribers), and trace where this error is raised and why; base the answer on what you find there.\n' +
  '4. Suggest how to confirm the cause and how to fix it (setup, data or code).\n' +
  'If something is missing, say what to check in Business Central.';
const DEFAULT_NAV_AGENT_INSTRUCTIONS =
  'Help investigate this Microsoft Dynamics NAV 2016 error.\n' +
  '1. Explain what the error means and its most likely cause, using the message and the record data above.\n' +
  '2. Search the knowledge base (documentation, Confluence pages and Jira issues) for similar errors and how they were solved; cite the issue keys and pages you use.\n' +
  '3. Check the knowledge base thoroughly, including the C/AL application code it contains (tables, pages, codeunits, triggers, functions, events), and trace where this error is raised and why; base the answer on what you find there.\n' +
  '4. Suggest how to confirm the cause and how to fix it (setup, data or code).\n' +
  'If something is missing, say what to check in Dynamics NAV.';
const DEFAULT_ENVIRONMENTS = 'STG = STG\nQA = QA\nclient = PROD';
const DEFAULT_ERROR_REPORT = {
  errorButtons: true,
  errorScreenshot: false,
  environments: DEFAULT_ENVIRONMENTS,
  agentInstructions: DEFAULT_AGENT_INSTRUCTIONS,
  navErrorButtons: true,
  navEnvironments: DEFAULT_ENVIRONMENTS,
  navAgentInstructions: DEFAULT_NAV_AGENT_INSTRUCTIONS
};
// Error report setup per system — the same fields, stored under its own keys
const ERROR_SYSTEMS = {
  bc: { buttons: 'errorButtons', environments: 'environments', instructions: 'agentInstructions',
        defaultInstructions: DEFAULT_AGENT_INSTRUCTIONS },
  nav: { buttons: 'navErrorButtons', environments: 'navEnvironments', instructions: 'navAgentInstructions',
         defaultInstructions: DEFAULT_NAV_AGENT_INSTRUCTIONS }
};
const SCREENSHOT_PERMISSION = { origins: ['<all_urls>'] };

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
  const appendDoubleTap = document.getElementById('appendDoubleTap');
  const appendHelp = document.getElementById('appendHelp');
  const errorButtons = document.getElementById('errorButtons');
  const errorScreenshot = document.getElementById('errorScreenshot');
  const screenshotWarning = document.getElementById('screenshotWarning');
  const environments = document.getElementById('environments');
  const agentInstructions = document.getElementById('agentInstructions');
  const resetInstructions = document.getElementById('resetInstructions');
  const systemButtons = document.querySelectorAll('.system-switch button');

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
    chrome.storage.local.get({ enabled: true, shortcuts: DEFAULT_SHORTCUTS, appendDoubleTap: true }, (res) => {
      toggle.checked = res.enabled !== false;
      updateUI(toggle.checked);
      renderShortcuts(normalizeShortcuts(res.shortcuts));
      appendDoubleTap.checked = res.appendDoubleTap !== false;
      appendHelp.hidden = !appendDoubleTap.checked;
    });

    appendDoubleTap.addEventListener('change', () => {
      appendHelp.hidden = !appendDoubleTap.checked;
      saveSettings({ appendDoubleTap: appendDoubleTap.checked });
    });

    toggle.addEventListener('change', () => {
      const isEnabled = toggle.checked;
      saveSettings({ enabled: isEnabled }, () => updateUI(isEnabled));
    });

    let errorSettings = { ...DEFAULT_ERROR_REPORT };
    let system = 'bc';

    chrome.storage.local.get({ ...DEFAULT_ERROR_REPORT, errorSetupSystem: 'bc' }, (res) => {
      errorSettings = res;
      errorScreenshot.checked = res.errorScreenshot === true;
      if (errorScreenshot.checked) checkScreenshotPermission();
      showSystem(ERROR_SYSTEMS[res.errorSetupSystem] ? res.errorSetupSystem : 'bc');
    });

    for (const button of systemButtons) {
      button.addEventListener('click', () => {
        showSystem(button.dataset.system);
        saveSettings({ errorSetupSystem: system });
      });
    }

    errorButtons.addEventListener('change', () => saveErrorSetting('buttons', errorButtons.checked));
    errorScreenshot.addEventListener('change', onScreenshotChange);

    saveTextOnInput(environments, 'environments');
    saveTextOnInput(agentInstructions, 'instructions');

    resetInstructions.addEventListener('click', () => {
      agentInstructions.value = ERROR_SYSTEMS[system].defaultInstructions;
      saveErrorSetting('instructions', agentInstructions.value);
    });

    // Fills the error report fields with the setup of one system
    function showSystem(name) {
      system = name;
      const keys = ERROR_SYSTEMS[system];
      for (const button of systemButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.system === system));
      }
      errorButtons.checked = errorSettings[keys.buttons] !== false;
      environments.value = errorSettings[keys.environments];
      agentInstructions.value = errorSettings[keys.instructions] || keys.defaultInstructions;
    }

    function saveErrorSetting(field, value) {
      const key = ERROR_SYSTEMS[system][field];
      errorSettings[key] = value;
      saveSettings({ [key]: value });
    }

    // Text settings are saved shortly after typing stops, for the system
    // shown when typing started
    function saveTextOnInput(textField, field) {
      let timer = 0;
      textField.addEventListener('input', () => {
        clearTimeout(timer);
        const key = ERROR_SYSTEMS[system][field];
        errorSettings[key] = textField.value;
        timer = setTimeout(() => saveSettings({ [key]: textField.value }), 300);
      });
    }
  }

  // The option is saved before asking: the permission prompt may close the
  // popup, and the next opening then shows whether access was granted
  function onScreenshotChange() {
    const wanted = errorScreenshot.checked;
    screenshotWarning.hidden = true;
    saveSettings({ errorScreenshot: wanted });
    if (!chrome.permissions) return;
    if (!wanted) {
      chrome.permissions.remove(SCREENSHOT_PERMISSION, () => void chrome.runtime.lastError);
      return;
    }
    chrome.permissions.request(SCREENSHOT_PERMISSION, (granted) => {
      if (granted) return;
      errorScreenshot.checked = false;
      saveSettings({ errorScreenshot: false });
    });
  }

  function checkScreenshotPermission() {
    if (!chrome.permissions) return;
    chrome.permissions.contains(SCREENSHOT_PERMISSION, (granted) => {
      screenshotWarning.hidden = granted;
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
