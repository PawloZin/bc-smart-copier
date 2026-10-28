/**
 * BC Smart Copier - Content Script
 * Captures modifier + Left Click on cells in Microsoft Dynamics 365 Business Central
 * and copies clean text content to clipboard.
 *
 * Default shortcuts (configurable in the popup):
 *   Shift + Left Click        → Copy cell value
 *   Alt + Shift + Left Click  → Copy action path (Page › Tab › Action)
 *   Alt (hold) + Left Click   → Copy whole table as TSV (Table Copier)
 *
 * On BC error dialogs and field validation errors it also shows
 * "Copy for AI agent" / "Copy for Jira" buttons (Error Report).
 *
 * The "ctrl" modifier matches both Ctrl and Cmd ⌘ (Mac).
 */

(function () {
  'use strict';

  const MAX_TOASTS = 5;
  const TOAST_DURATION = 4000; // 4 seconds visible duration
  const SUPPRESS_WINDOW = 1000; // max time to swallow the rest of a copy gesture

  // Must stay in sync with SHORTCUT_OPTIONS / DEFAULT_SHORTCUTS in popup/popup.js
  const VALID_SHORTCUTS = ['shift', 'alt', 'ctrl', 'alt+shift', 'ctrl+shift', 'ctrl+alt'];
  const SHORTCUT_ACTIONS = ['cell', 'action', 'table'];
  const DEFAULT_SHORTCUTS = { cell: 'shift', action: 'alt+shift', table: 'alt' };

  // Must stay in sync with DEFAULT_AGENT_INSTRUCTIONS / DEFAULT_ERROR_REPORT in popup/popup.js
  const DEFAULT_AGENT_INSTRUCTIONS =
    'Help investigate this Microsoft Dynamics 365 Business Central error.\n' +
    '1. Explain what the error means and its most likely cause, using the message, the technical details and the record data above.\n' +
    '2. Search the knowledge base (documentation, Confluence pages and Jira issues) for similar errors and how they were solved; cite the issue keys and pages you use.\n' +
    '3. Check the knowledge base thoroughly, including the application code it contains (tables, pages, codeunits, triggers, procedures, event subscribers), and trace where this error is raised and why; base the answer on what you find there.\n' +
    '4. Suggest how to confirm the cause and how to fix it (setup, data or code).\n' +
    'If something is missing, say what to check in Business Central.';
  const DEFAULT_ERROR_REPORT = {
    errorButtons: true,
    errorScreenshot: false,
    environments: 'STG = STG\nQA = QA\nclient = PROD',
    agentInstructions: DEFAULT_AGENT_INSTRUCTIONS
  };

  let isEnabled = true;
  let shortcuts = { ...DEFAULT_SHORTCUTS };
  const errorReport = { ...DEFAULT_ERROR_REPORT };
  let errorScanTimer = 0; // declared before the storage callbacks that schedule a scan

  // Retrieve initial extension state from chrome.storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ enabled: true, shortcuts: DEFAULT_SHORTCUTS, ...DEFAULT_ERROR_REPORT }, (res) => {
      isEnabled = res.enabled !== false;
      shortcuts = normalizeShortcuts(res.shortcuts);
      for (const key of Object.keys(DEFAULT_ERROR_REPORT)) errorReport[key] = res[key];
      scheduleErrorScan();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.enabled !== undefined) {
        isEnabled = changes.enabled.newValue !== false;
      }
      if (changes.shortcuts !== undefined) {
        shortcuts = normalizeShortcuts(changes.shortcuts.newValue);
      }
      for (const key of Object.keys(DEFAULT_ERROR_REPORT)) {
        if (changes[key] !== undefined) errorReport[key] = changes[key].newValue;
      }
      hideTableOverlay();
      scheduleErrorScan();
    });
  }

  /**
   * Resolves the stored shortcut map so every action gets a valid, unique
   * shortcut: the stored value, else the default, else the first free option.
   * Older configurations without a "table" entry are upgraded this way too.
   */
  function normalizeShortcuts(value) {
    const result = {};
    const used = new Set();
    for (const name of SHORTCUT_ACTIONS) {
      const candidates = [value && value[name], DEFAULT_SHORTCUTS[name], ...VALID_SHORTCUTS];
      const pick = candidates.find((c) => VALID_SHORTCUTS.includes(c) && !used.has(c));
      result[name] = pick;
      used.add(pick);
    }
    return result;
  }

  let lastCopyTime = 0;
  let suppressUntil = 0;

  // --- Event Interception Strategy ---
  // BC's SPA framework listens on multiple event types to handle navigation:
  //   pointerdown, mousedown, click (and sometimes mouseup).
  // Simply calling preventDefault/stopImmediatePropagation on pointerdown
  // does NOT stop mousedown or click from firing — these are separate event
  // types that the browser always dispatches in sequence:
  //   pointerdown → mousedown → pointerup → mouseup → click
  //
  // Strategy:
  //   1. Intercept pointerdown — perform copy, open a suppression window.
  //   2. Suppress the rest of that gesture (mousedown, pointerup, mouseup,
  //      click, dblclick, contextmenu) in capture phase until the next plain
  //      pointerdown or SUPPRESS_WINDOW elapses. Modifier keys are NOT checked
  //      here, so releasing the key before the mouse button is still safe.
  window.addEventListener('pointerdown', handleShortcutEvent, true);
  for (const type of ['mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
    window.addEventListener(type, suppressBcEventAfterCopy, true);
  }

  /**
   * Blocks the remaining mouse events of a copy gesture. Without this,
   * Business Central (or the browser — e.g. Alt+Click downloads a link,
   * Shift+Click opens it in a new window) still processes those events
   * even though we already intercepted pointerdown.
   */
  function suppressBcEventAfterCopy(e) {
    if (Date.now() >= suppressUntil) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  /**
   * Checks whether the event's modifier keys exactly match a shortcut
   * definition such as 'alt' or 'ctrl+shift'.
   */
  function matchesShortcut(e, shortcut) {
    const keys = shortcut.split('+');
    return (e.ctrlKey || e.metaKey) === keys.includes('ctrl') &&
           e.altKey === keys.includes('alt') &&
           e.shiftKey === keys.includes('shift');
  }

  /**
   * Returns which shortcut mode is active, or null if no shortcut applies.
   * 'cell'   → cell value shortcut (default Shift + Left Click)
   * 'action' → action path shortcut (default Alt + Shift + Left Click)
   * 'table'  → whole table shortcut (default Alt + Left Click) — only when
   *            the pointer is over a <table>, otherwise the click is left alone
   */
  function getShortcutMode(e) {
    if (e.button !== 0) return null;
    if (matchesShortcut(e, shortcuts.cell)) return 'cell';
    if (matchesShortcut(e, shortcuts.action)) return 'action';
    if (matchesShortcut(e, shortcuts.table) && findTable(e.target)) return 'table';
    return null;
  }

  function handleShortcutEvent(e) {
    const mode = isEnabled ? getShortcutMode(e) : null;
    if (!mode) {
      // A plain click starts a new gesture — stop swallowing events
      suppressUntil = 0;
      return;
    }

    // Synchronously block default BC / browser action
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    suppressUntil = Date.now() + SUPPRESS_WINDOW;

    // Debounce: ignore repeated triggers within 250ms
    const now = Date.now();
    if (now - lastCopyTime > 250) {
      lastCopyTime = now;
      if (mode === 'action') {
        processActionCopy(e);
      } else if (mode === 'table') {
        processTableCopy(e);
      } else {
        processCellCopy(e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CELL VALUE COPY  (default Shift + Click)
  // ---------------------------------------------------------------------------

  function processCellCopy(e) {
    const rawTarget = e.target;
    if (!rawTarget) return;

    const cellElement = findCellElement(rawTarget);
    const extractedText = extractCleanValue(rawTarget, cellElement);

    if (!extractedText) {
      showToast('Cell is empty', 'No text found to copy.', true);
      return;
    }

    copyToClipboard(extractedText).then((success) => {
      if (success) {
        highlightElement(cellElement);
        showToast('Copied to clipboard', extractedText, false);
      } else {
        showToast('Copy error', 'Failed to access clipboard.', true);
      }
    });
  }

  /**
   * Finds cell container in Business Central DOM structure
   */
  function findCellElement(target) {
    const cellSelectors = [
      // Field caption on card pages — sits in the same container as the value,
      // so it must be matched first or the caption click copies the value
      '.ms-nav-edit-control-caption',
      'td',
      '[role="gridcell"]',
      '[role="cell"]',
      '.ms-nav-grid-cell',
      '.ms-nav-grid-data-cell',
      '.control-value-cell',
      '.control-container',
      '.ms-nav-edit-control-container',
      '.field-container',
      '.ms-nav-band-cell',
      '.ms-cellstyle',
      '.stringcontrol-read',
      '[data-focusable="true"]'
    ];

    for (const selector of cellSelectors) {
      const parent = target.closest(selector);
      if (parent) return parent;
    }

    return target;
  }

  /**
   * Extracts clean text value from cell or input field
   */
  function extractCleanValue(target, cellElement) {
    const formControlSelector = 'input:not([type="hidden"]), textarea, select';
    let text = '';

    if (target.matches(formControlSelector)) {
      text = readFormControlValue(target);
    } else {
      const inputChild = cellElement.querySelector(formControlSelector);
      const inputValue = inputChild ? readFormControlValue(inputChild) : '';
      if (inputValue) {
        text = inputValue;
      } else {
        let readControl = target.closest('.stringcontrol-read, .ms-list-itemLink, a, span') || target;
        // Never read text from outside the resolved cell
        if (!cellElement.contains(readControl)) readControl = cellElement;
        text = readControl.innerText || cellElement.innerText || readControl.textContent || cellElement.textContent || '';
      }
    }

    return sanitizeText(text);
  }

  /**
   * Reads the user-visible value of a form control.
   * Checkboxes (BC Boolean fields) return "Yes" / "No" instead of the
   * meaningless "on" value. Other controls (including selects in edit mode)
   * return their raw value.
   */
  function readFormControlValue(el) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      const ariaHost = el.closest('[role="checkbox"][aria-checked]');
      const checked = ariaHost ? ariaHost.getAttribute('aria-checked') === 'true' : el.checked;
      return checked ? 'Yes' : 'No';
    }
    return el.value || '';
  }

  // ---------------------------------------------------------------------------
  // ACTION PATH COPY  (default Alt + Shift + Click)
  // ---------------------------------------------------------------------------

  function processActionCopy(e) {
    const target = e.target;
    if (!target) return;

    const actionLabel = extractActionLabel(target);

    if (!actionLabel) {
      showToast('Not an action', 'Click on an action button to copy its path.', true);
      return;
    }

    const pageName      = extractPageName(target);
    const activeTab     = extractActiveTab(target);
    const submenuChain  = extractSubmenuChain(target);
    const actionPath    = buildActionPath(pageName, activeTab, submenuChain, actionLabel);

    copyToClipboard(actionPath).then((success) => {
      if (success) {
        highlightElement(target.closest('button, [role="button"], li, .ms-nav-action-bar-item') || target);
        showToast('Action path copied', actionPath, false);
      } else {
        showToast('Copy error', 'Failed to access clipboard.', true);
      }
    });
  }

  /**
   * Extracts the label of an action button from the clicked element.
   * BC renders action buttons as <button>, <a>, <li> with various label
   * structures — tries multiple heuristics.
   */
  function extractActionLabel(target) {
    // Walk up to find the action button container
    const actionSelectors = [
      'button',
      '[role="button"]',
      '[role="menuitem"]',
      '.ms-nav-action-bar-item',
      '.ms-nav-action-button',
      '.ms-nav-actionbar-button',
      'li[data-id]',
      'a[role="button"]',
    ];

    let actionEl = null;
    for (const sel of actionSelectors) {
      const found = target.closest(sel);
      if (found) { actionEl = found; break; }
    }

    if (!actionEl) return '';

    // Prefer aria-label, then title, then visible text
    const ariaLabel = actionEl.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return sanitizeText(ariaLabel);

    const title = actionEl.getAttribute('title');
    if (title && title.trim()) return sanitizeText(title);

    // Look for a dedicated label/caption element inside the button
    const captionEl = actionEl.querySelector(
      '.ms-nav-action-bar-item-caption, .ms-nav-caption, [class*="caption"], [class*="label"], span:not([class])'
    );
    if (captionEl) {
      const txt = sanitizeText(captionEl.innerText || captionEl.textContent || '');
      if (txt) return txt;
    }

    return sanitizeText(actionEl.innerText || actionEl.textContent || '');
  }

  /**
   * Extracts the current BC page name.
   *
   * BC keeps previously opened pages in the DOM (stacked .spa-view elements),
   * so every lookup is scoped to the page the click belongs to — or to the
   * top-most shown page when the click happened in a detached popup menu.
   *
   * Tries in order:
   * 1. Visible page header title (.synopsis-trigger / caption) — gives exact display caption (e.g., "Sales Orders", "Customer Card")
   * 2. Active form attributes: aria-label (for List pages) or controlname (for Card pages)
   * 3. Role=heading or h1 fallbacks
   */
  function extractPageName(target) {
    const scope = findPageScope(target);

    // 1. Visible page header title (most accurate display caption for both Card & List pages)
    const titleEl = scope.querySelector(
      '.synopsis-trigger, [id$="_subtitle"] span, .menu-bar__page-title [role="heading"]'
    );
    if (titleEl) {
      let text = sanitizeText(titleEl.innerText || titleEl.textContent || '');
      text = text.replace(/:\s*$/, '').trim();
      if (text) return text;
    }

    // 2. Form element attributes
    const form = target.closest('form[controlname]') ||
                 scope.querySelector('form[controlname]');
    if (form) {
      const pageType = form.getAttribute('data-page-type');
      const ariaLabel = sanitizeText(form.getAttribute('aria-label') || '');
      const controlName = sanitizeText(form.getAttribute('controlname') || '');

      // On List pages (data-page-type="1" or controlName ending in "List"), aria-label is the display caption ("Sales Orders")
      if ((pageType === '1' || /List$/i.test(controlName)) && ariaLabel) {
        return ariaLabel;
      }
      if (controlName) {
        return /List$/i.test(controlName) ? controlName.replace(/\s+List$/i, '') : controlName;
      }
      if (ariaLabel) return ariaLabel;
    }

    // 3. Fallback: role=heading elements
    const headingSelectors = ['[role="heading"][aria-level="1"]', 'h1'];
    for (const sel of headingSelectors) {
      const el = scope.querySelector(sel);
      if (el) {
        let text = sanitizeText(el.innerText || el.textContent || '');
        text = text.replace(/:\s*$/, '').trim();
        if (text) return text;
      }
    }

    return '';
  }

  /**
   * Returns the BC page view (.spa-view) that owns the clicked element.
   * Popup menus are rendered in a portal outside the view, so for them the
   * top-most shown view is used (BC marks every lower view "spa-not-top-most").
   */
  function findPageScope(target) {
    const ownView = target.closest('.spa-view');
    if (ownView) return ownView;

    const shownViews = document.querySelectorAll('.spa-view.shown:not(.spa-not-top-most)');
    if (shownViews.length > 0) return shownViews[shownViews.length - 1];

    return document;
  }

  /**
   * Extracts the active action-bar tab label near the clicked element.
   *
   * In BC's menu bar, primary tab buttons (Home, Request Approval, …) have:
   *   - data-top-level-action="true"
   *   - aria-haspopup="true"    (they open a dropdown of actions)
   *   - aria-expanded="true"   when their dropdown is currently shown
   */
  function extractActiveTab(target) {
    const bcTabSelector = '[data-top-level-action="true"][aria-haspopup="true"][aria-expanded="true"]';

    const inPopup = !!target.closest('[role="menu"]');

    if (inPopup) {
      const allExpandedTabs = Array.from(document.querySelectorAll(bcTabSelector));

      if (allExpandedTabs.length > 0) {
        // Filter out "Home" or primary tabs when clicking in a popup flyout,
        // because secondary popup tabs (Actions, Related, Reports, Automate) open the [role="menu"] portal.
        const popupTabs = allExpandedTabs.filter(tab => {
          const label = sanitizeText(tab.getAttribute('aria-label') || tab.innerText || tab.textContent || '');
          return label.toLowerCase() !== 'home';
        });

        const chosenEl = popupTabs.length > 0 ? popupTabs[popupTabs.length - 1] : allExpandedTabs[allExpandedTabs.length - 1];
        return sanitizeText(chosenEl.getAttribute('aria-label') || chosenEl.innerText || chosenEl.textContent || '');
      }

      return '';
    }

    // Non-popup (direct action click in secondary action bar):
    const form = target.closest('form[controlname]');
    if (form) {
      const el = form.querySelector(bcTabSelector);
      if (el) {
        return sanitizeText(el.getAttribute('aria-label') || el.innerText || el.textContent || '');
      }
    }

    const el = document.querySelector(bcTabSelector);
    if (el) {
      return sanitizeText(el.getAttribute('aria-label') || el.innerText || el.textContent || '');
    }

    return '';
  }

  /**
   * Extracts the chain of open submenu group labels between the active tab
   * and the clicked action item.
   *
   * When the user clicks an item nested inside a popup flyout menu
   * (e.g. Related ▸ Sales ▸ Prepayment Percentages), BC sets
   * aria-expanded="true" on each intermediate submenu trigger button.
   * Those buttons have role="menuitem" + aria-haspopup="true" but do NOT
   * carry data-top-level-action="true" (that attribute is exclusive to the
   * primary action-bar tabs like Home, Related, etc.).
   *
   * Returns an ordered array of group labels, e.g. ["Sales"].
   * Returns [] when the clicked item is directly in the secondary bar
   * (e.g. Contact directly under the Home tab — no popup involved).
   */
  function extractSubmenuChain(target) {
    // Only relevant when the click target is inside a [role="menu"] popup
    if (!target.closest('[role="menu"]')) return [];

    const chain = [];

    // Collect all currently expanded submenu group buttons (not action-bar tabs)
    const expandedGroups = document.querySelectorAll(
      '[role="menuitem"][aria-haspopup="true"][aria-expanded="true"]:not([data-top-level-action="true"])'
    );

    for (const el of expandedGroups) {
      const label = sanitizeText(el.getAttribute('aria-label') || el.innerText || el.textContent || '');
      if (label) chain.push(label);
    }

    return chain;
  }

  /**
   * Assembles the final action path string.
   *
   * Examples:
   *   Direct action (no submenu):
   *     open page [Customer Card] go to [Home] tab and click {Contact}
   *
   *   Nested submenu action:
   *     open page [Sales Orders] and go to [Related] tab -> [Documents] and click {Prepayment Invoices}
   */
  function buildActionPath(pageName, activeTab, submenuChain, actionLabel) {
    const parts = [];

    if (pageName) parts.push(`open page [${pageName}]`);

    if (activeTab) {
      let tabPart = `go to [${activeTab}] tab`;
      // Append submenu chain labels separated by " -> "
      for (const group of submenuChain) {
        tabPart += ` -> [${group}]`;
      }
      parts.push(tabPart);
    } else if (submenuChain.length > 0) {
      // No top-level tab found but submenu chain exists
      const chainPart = submenuChain.map(g => `[${g}]`).join(' -> ');
      parts.push(chainPart);
    }

    if (actionLabel) parts.push(`click {${actionLabel}}`);

    return parts.join(' and ');
  }

  // ---------------------------------------------------------------------------
  // TABLE COPIER  (default hold Alt, hover a table, click)
  // ---------------------------------------------------------------------------
  // Generic: works on any HTML <table>, including tables added after page
  // load, because the table is resolved from the event target on demand.
  // Nothing is scanned up front and copied contents are never stored or logged.

  let lastPointerTarget = null;
  let overlayTable = null;      // table currently highlighted
  let copiedTable = null;       // table just copied — not re-highlighted until the gesture ends
  let overlayEl = null;
  let overlayFrame = 0;

  window.addEventListener('pointermove', onTablePointerMove, { capture: true, passive: true });
  window.addEventListener('keydown', onTableModifierChange, { capture: true, passive: true });
  window.addEventListener('keyup', onTableModifierChange, { capture: true, passive: true });
  window.addEventListener('blur', resetTableMode);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetTableMode();
  });
  document.addEventListener('mouseout', (e) => {
    // Pointer left the document (or this frame)
    if (!e.relatedTarget) {
      lastPointerTarget = null;
      hideTableOverlay();
    }
  }, true);

  function onTablePointerMove(e) {
    lastPointerTarget = e.target;
    updateTableHighlight(e);
  }

  function onTableModifierChange(e) {
    updateTableHighlight(e);
  }

  function resetTableMode() {
    lastPointerTarget = null;
    copiedTable = null;
    hideTableOverlay();
  }

  /**
   * Shows the overlay over the table under the pointer while the configured
   * Table Copier modifiers are held; hides it otherwise. `e` is any event
   * that carries modifier flags (pointer or keyboard).
   */
  function updateTableHighlight(e) {
    const active = isEnabled && matchesShortcut(e, shortcuts.table);
    const table = active ? findTable(lastPointerTarget) : null;

    if (!active) copiedTable = null;
    if (table !== copiedTable) copiedTable = null;

    if (!table || table === copiedTable) {
      hideTableOverlay();
      return;
    }
    if (table !== overlayTable) showTableOverlay(table);
  }

  function findTable(target) {
    return target && target.closest ? target.closest('table') : null;
  }

  function showTableOverlay(table) {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'bc-smart-copier-table-overlay';
      overlayEl.setAttribute('aria-hidden', 'true');
    }
    if (!overlayEl.isConnected) document.documentElement.appendChild(overlayEl);

    if (!overlayTable) {
      window.addEventListener('scroll', scheduleOverlayUpdate, { capture: true, passive: true });
      window.addEventListener('resize', scheduleOverlayUpdate, { passive: true });
    }
    overlayTable = table;
    positionTableOverlay();
  }

  function hideTableOverlay() {
    if (!overlayTable) return;
    overlayTable = null;
    window.removeEventListener('scroll', scheduleOverlayUpdate, { capture: true });
    window.removeEventListener('resize', scheduleOverlayUpdate);
    if (overlayFrame) cancelAnimationFrame(overlayFrame);
    overlayFrame = 0;
    if (overlayEl) overlayEl.remove();
  }

  function scheduleOverlayUpdate() {
    if (overlayFrame) return;
    overlayFrame = requestAnimationFrame(() => {
      overlayFrame = 0;
      positionTableOverlay();
    });
  }

  /**
   * Places the overlay over the visible part of the table: its bounding box
   * clipped by scrolling ancestors and by the viewport.
   */
  function positionTableOverlay() {
    if (!overlayTable || !overlayEl) return;
    if (!overlayTable.isConnected) {
      hideTableOverlay();
      return;
    }

    const rect = overlayTable.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    let right = rect.right;
    let bottom = rect.bottom;

    for (let el = overlayTable.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const clip = el.getBoundingClientRect();
      left = Math.max(left, clip.left);
      top = Math.max(top, clip.top);
      right = Math.min(right, clip.right);
      bottom = Math.min(bottom, clip.bottom);
    }

    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, document.documentElement.clientWidth || window.innerWidth);
    bottom = Math.min(bottom, document.documentElement.clientHeight || window.innerHeight);

    if (right <= left || bottom <= top) {
      overlayEl.style.display = 'none';
      return;
    }
    overlayEl.style.display = 'block';
    overlayEl.style.left = left + 'px';
    overlayEl.style.top = top + 'px';
    overlayEl.style.width = (right - left) + 'px';
    overlayEl.style.height = (bottom - top) + 'px';
  }

  function processTableCopy(e) {
    const table = findTable(e.target);
    if (!table) return;

    const grid = readTableGrid(table);
    hideTableOverlay();
    copiedTable = table;

    if (!grid.some((row) => row.some((value) => value !== ''))) {
      showToast('Table is empty', 'No visible cells found to copy.', true);
      return;
    }

    const tsv = grid.map((row) => row.map(toTsvField).join('\t')).join('\r\n');
    const columns = Math.max(...grid.map((row) => row.length));

    copyToClipboard(tsv).then((success) => {
      if (success) {
        showToast('Table copied', `${grid.length} ${grid.length === 1 ? 'row' : 'rows'} × ${columns} ${columns === 1 ? 'column' : 'columns'}`, false);
      } else {
        showToast('Copy error', 'Failed to access clipboard.', true);
      }
    });
  }

  /**
   * Reads the visible rows and cells (th / td) of a table into a 2D array.
   * colspan / rowspan cells occupy their whole area (text in the first slot,
   * empty strings elsewhere) so columns stay aligned in a spreadsheet.
   * Rows and cells that are not rendered (display: none) are skipped.
   */
  function readTableGrid(table) {
    const grid = [];
    const pending = []; // pending[col] = rows still covered by a rowspan above

    for (const row of table.rows) {
      if (row.getClientRects().length === 0) continue;

      const values = [];
      let col = 0;
      const skipCovered = () => {
        while (pending[col] > 0) {
          values[col] = '';
          pending[col]--;
          col++;
        }
      };

      for (const cell of row.cells) {
        if (cell.getClientRects().length === 0) continue;
        skipCovered();

        const colSpan = Math.max(1, cell.colSpan || 1);
        const rowSpan = Math.max(1, cell.rowSpan || 1);
        for (let i = 0; i < colSpan; i++) {
          values[col + i] = i === 0 ? normalizeTableCell(cell.innerText || cell.textContent || '') : '';
          if (rowSpan > 1) pending[col + i] = rowSpan - 1;
        }
        col += colSpan;
      }
      skipCovered();

      for (let i = 0; i < values.length; i++) if (values[i] === undefined) values[i] = '';
      grid.push(values);
    }

    // Pad rows so every line has the same number of columns
    const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
    for (const row of grid) while (row.length < width) row.push('');
    return grid;
  }

  function normalizeTableCell(text) {
    return text
      .replace(/\u00A0/g, ' ')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /**
   * Quotes a field containing double quotes so spreadsheet paste does not
   * treat it as a quoted value and swallow the quote characters.
   */
  function toTsvField(value) {
    return value.includes('"') ? '"' + value.replace(/"/g, '""') + '"' : value;
  }

  // ---------------------------------------------------------------------------
  // ERROR REPORT  ("Copy for AI agent" / "Copy for Jira" on BC errors)
  // ---------------------------------------------------------------------------
  // Error dialogs get the buttons below the message; every error (dialog or
  // field validation) also gets a floating panel at the bottom of the page. A click copies the environment (from the page
  // address), the page, the error message, BC's technical details and the
  // record the user was working on: all fields of the page plus the current
  // row of every grid. Optionally a screenshot is taken and copied on a second
  // click. Everything is read on demand and only goes to the clipboard.

  // Must stay in sync with content/page-hook.js
  const ARM_EVENT = 'bc-smart-copier:arm-copy-capture';
  const CAPTURE_EVENT = 'bc-smart-copier:copy-captured';
  const DETAILS_TIMEOUT = 2500;
  const ERROR_BUTTONS = [
    { kind: 'agent', label: 'Copy for AI agent' },
    { kind: 'jira', label: 'Copy for Jira' }
  ];

  let errorPanel = null;
  let errorPanelRoot = null;
  let dismissedError = '';
  let pendingShot = null; // { root, kind } — screenshot waiting for the second click
  let reportBusy = false;

  new MutationObserver(scheduleErrorScan).observe(document.documentElement, { childList: true, subtree: true });

  function scheduleErrorScan() {
    if (errorScanTimer) return;
    errorScanTimer = setTimeout(scanForErrors, 250);
  }

  function scanForErrors() {
    errorScanTimer = 0;
    const active = isEnabled && errorReport.errorButtons !== false;
    if (pendingShot && !pendingShot.root.isConnected) pendingShot = null;

    for (const dialog of document.querySelectorAll('form.error-dialog')) {
      const bar = dialog.querySelector('.bc-sc-error-actions');
      if (!active) {
        if (bar) bar.remove();
      } else if (!bar) {
        const place = dialog.querySelector('.dialog-content-alignbox') || dialog.querySelector('.dialog-content') || dialog;
        place.appendChild(buildErrorActions(() => dialog));
      }
    }

    updateErrorPanel(active ? findErrorDialog() || findValidationError() : null);
  }

  /** Top-most BC error dialog in this frame */
  function findErrorDialog() {
    const dialogs = Array.from(document.querySelectorAll('form.error-dialog'))
      .filter((dialog) => dialog.getClientRects().length > 0);
    return dialogs[dialogs.length - 1] || null;
  }

  /**
   * Field validation error (red field with an error icon) in this frame —
   * the field container is the error root. Empty mandatory fields carry the
   * same marker class but a "required" icon instead of the error icon, so
   * they are skipped.
   */
  function findValidationError() {
    for (const marker of document.querySelectorAll('.ms-nav-has-validation-error')) {
      if (!marker.querySelector('.ms-nav-validationicon-error')) continue;
      if (marker.getClientRects().length === 0) continue;
      return marker.closest('.ms-nav-edit-control-container, td') || marker;
    }
    return null;
  }

  /**
   * Floating panel at the bottom of the page for the current error — an
   * error dialog (which also has the buttons inside) or a field validation
   * error. Hidden with × until a different error appears.
   */
  function updateErrorPanel(root) {
    const info = root ? readErrorInfo(root) : null;
    if (!info || info.message === dismissedError) {
      hideErrorPanel();
      return;
    }

    if (!errorPanel) {
      errorPanel = document.createElement('div');
      errorPanel.id = 'bc-smart-copier-error-panel';
      errorPanel.className = 'bc-sc-error-ui';

      const header = document.createElement('div');
      header.className = 'bc-sc-error-panel-header';
      const title = document.createElement('span');
      title.textContent = 'Business Central error';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'bc-sc-error-panel-close';
      close.title = 'Hide';
      close.textContent = '×';
      close.addEventListener('click', () => {
        dismissedError = errorPanel.querySelector('.bc-sc-error-panel-message').textContent;
        hideErrorPanel();
      });
      header.append(title, close);

      const message = document.createElement('div');
      message.className = 'bc-sc-error-panel-message';

      errorPanel.append(header, message, buildErrorActions(() => errorPanelRoot));
    }

    errorPanelRoot = root;
    const messageEl = errorPanel.querySelector('.bc-sc-error-panel-message');
    const text = info.message;
    if (messageEl.textContent !== text) messageEl.textContent = text;
    messageEl.title = info.field ? `${info.field}: ${text}` : text;
    if (!errorPanel.isConnected) (document.body || document.documentElement).appendChild(errorPanel);

    // Toasts share the bottom center — keep them above the panel
    const space = errorPanel.offsetHeight + 16 + 'px';
    if (document.documentElement.style.getPropertyValue('--bc-sc-panel-space') !== space) {
      document.documentElement.style.setProperty('--bc-sc-panel-space', space);
    }
  }

  function hideErrorPanel() {
    if (errorPanel) errorPanel.remove();
    errorPanelRoot = null;
    document.documentElement.style.removeProperty('--bc-sc-panel-space');
  }

  function buildErrorActions(getRoot) {
    const bar = document.createElement('div');
    bar.className = 'bc-sc-error-actions bc-sc-error-ui';
    // Keep BC from treating clicks on the buttons as clicks in its dialog
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'keydown']) {
      bar.addEventListener(type, (e) => e.stopPropagation());
    }

    for (const { kind, label } of ERROR_BUTTONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bc-sc-error-button';
      button.dataset.kind = kind;
      button.dataset.label = label;
      button.textContent = label;
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const root = getRoot();
        if (root) onErrorButton(kind, root);
      });
      bar.appendChild(button);
    }
    return bar;
  }

  /** Re-labels the buttons: the one with a screenshot waiting says so */
  function refreshErrorButtons() {
    for (const button of document.querySelectorAll('.bc-sc-error-button')) {
      const bar = button.closest('.bc-sc-error-actions');
      const root = bar && bar.parentElement === errorPanel ? errorPanelRoot : button.closest('form.error-dialog');
      const waiting = pendingShot && pendingShot.root === root && pendingShot.kind === button.dataset.kind;
      button.textContent = waiting ? 'Copy screenshot' : button.dataset.label;
      button.classList.toggle('bc-sc-error-button-shot', !!waiting);
      button.disabled = reportBusy;
    }
  }

  async function onErrorButton(kind, root) {
    if (reportBusy) return;

    if (pendingShot && pendingShot.root === root && pendingShot.kind === kind) {
      pendingShot = null;
      refreshErrorButtons();
      const error = await copyScreenshot();
      if (error) showToast('Copy error', error, true);
      return;
    }

    reportBusy = true;
    pendingShot = null;
    refreshErrorButtons();
    try {
      // Before the details menu opens, so it does not end up in the picture
      const shot = errorReport.errorScreenshot ? await captureScreenshot() : null;
      const report = await collectErrorReport(root);

      const copied = kind === 'jira'
        ? await copyRichToClipboard(buildJiraText(report), buildJiraHtml(report))
        : await copyToClipboard(buildAgentText(report));
      if (!copied) {
        showToast('Copy error', 'Failed to access clipboard.', true);
        return;
      }

      const title = kind === 'jira' ? 'Copied for Jira' : 'Copied for AI agent';
      const note = report.details ? 'With technical details.' : 'Technical details were not available.';
      if (shot && shot.ok) {
        pendingShot = { root, kind };
        showToast(title, `${note} Click "Copy screenshot" for the screenshot.`, false);
      } else {
        showToast(title, note, false);
        if (shot && shot.error) showToast('Screenshot not taken', shot.error, true);
      }
    } catch (err) {
      showToast('Copy error', 'Could not read the error.', true);
    } finally {
      reportBusy = false;
      refreshErrorButtons();
    }
  }

  async function collectErrorReport(root) {
    const info = readErrorInfo(root);
    const view = findRecordView(root);
    const pageName = readReportPageName(view);
    const report = {
      ...readPageContext(),
      page: pageName,
      record: readRecordCaption(view, pageName),
      field: info.field,
      message: info.message,
      sections: readRecordSections(view, pageName),
      details: ''
    };
    report.details = sanitizeDetails(await fetchErrorDetails(root));
    return report;
  }

  /** Error message (and the field name for validation errors) */
  function readErrorInfo(root) {
    if (root.matches('form.error-dialog')) {
      const el = root.querySelector('.error-dialog-caption') ||
                 root.querySelector('.ms-nav-logical-dialog') ||
                 root.querySelector('.dialog-content');
      return { field: '', message: sanitizeText(el ? el.getAttribute('title') || el.textContent : '') };
    }

    const tooltip = root.querySelector('.ms-cui-tooltip-description');
    const icon = root.querySelector('[class*="validationicon-error"][aria-label]');
    const message = sanitizeText(
      (tooltip && tooltip.textContent) || (icon && icon.getAttribute('aria-label')) || ''
    );
    let field = '';
    const caption = root.querySelector('.ms-nav-edit-control-caption');
    if (caption) {
      field = sanitizeText(caption.textContent).replace(/:\s*$/, '');
    } else if (root.matches('td')) {
      field = gridColumnName(root.closest('table'), root.cellIndex);
    }
    return { field, message };
  }

  /**
   * The page the user was working on: the error's own page for validation
   * errors, otherwise the top-most shown view below the error dialog.
   */
  function findRecordView(root) {
    const own = root.closest('.spa-view');
    if (own && !own.querySelector('form.error-dialog')) return own;

    const views = Array.from(document.querySelectorAll('.spa-view.shown'))
      .filter((view) => !view.querySelector('form.error-dialog'));
    return views[views.length - 1] || document;
  }

  /** Page caption from the page form, e.g. "Customer Ledger Entries" */
  function readReportPageName(view) {
    const form = view.querySelector('form[controlname]');
    const name = form ? sanitizeText(form.getAttribute('aria-label') || form.getAttribute('controlname') || '') : '';
    return name || extractPageName(view === document ? document.body : view);
  }

  /** Record title BC shows in the page header, e.g. "10000 ∙ Adatum Corporation" */
  function readRecordCaption(view, pageName) {
    const el = view.querySelector('.synopsis-trigger');
    const text = el ? sanitizeText(el.textContent).replace(/:\s*$/, '') : '';
    return text && text !== pageName ? text : '';
  }

  /**
   * All fields of the page (caption → value) and the current row of every
   * grid on it (column → value). Hidden fields and columns, FactBoxes and
   * our own UI are skipped.
   */
  function readRecordSections(view, pageName) {
    const sections = [];
    const skip = '.ms-nav-layout-factbox-pane-container, form.error-dialog, .bc-sc-error-ui';

    const fields = [];
    for (const container of view.querySelectorAll('.ms-nav-edit-control-container')) {
      if (container.closest(skip) || container.closest('table, .ms-nav-hidden')) continue;
      const caption = container.querySelector('.ms-nav-edit-control-caption');
      if (!caption || caption.classList.contains('ms-nav-hidden')) continue;
      const name = sanitizeText(caption.textContent).replace(/:\s*$/, '');
      if (name) fields.push([name, readFieldValue(container)]);
    }
    if (fields.length) sections.push({ title: pageName || 'Fields', rows: fields });

    for (const table of view.querySelectorAll('table')) {
      if (table.closest(skip)) continue;
      const row = table.querySelector('tbody tr.real-current') || table.querySelector('tbody tr[aria-selected="true"]');
      if (!row) continue;

      const rows = [];
      for (const cell of row.cells) {
        if (cell.classList.contains('ms-nav-hidden')) continue; // column hidden by the user
        const name = gridColumnName(table, cell.cellIndex);
        if (name) rows.push([name, readGridCellValue(cell)]);
      }
      if (!rows.length) continue;

      const caption = table.caption ? sanitizeText(table.caption.textContent) : '';
      sections.push({ title: `${caption || pageName || 'Lines'} (current row)`, rows });
    }
    return sections;
  }

  function readFieldValue(container) {
    const edit = container.querySelector('.edit-container') || container;
    const control = edit.querySelector('input:not([type="hidden"]), textarea, select');
    if (control) return sanitizeText(readFormControlValue(control));

    // Read-only value: drop the hidden validation tooltip and icons
    const clone = edit.cloneNode(true);
    for (const el of clone.querySelectorAll('.ms-nav-hidden, .ms-nav-notificationiconcontainer, [aria-hidden="true"]')) {
      el.remove();
    }
    return normalizeTableCell(clone.textContent || '');
  }

  function readGridCellValue(cell) {
    const control = cell.querySelector('input:not([type="hidden"]), textarea, select');
    if (control) return sanitizeText(readFormControlValue(control));
    return normalizeTableCell(cell.innerText || cell.textContent || '');
  }

  /** Column caption of a grid: BC puts it into the header cell's abbr */
  function gridColumnName(table, index) {
    const head = table && table.tHead;
    if (!head) return '';
    for (const row of head.rows) {
      const th = row.cells[index];
      if (!th) continue;
      const name = sanitizeText(th.getAttribute('abbr') || th.innerText || th.textContent || '');
      if (name) return name;
    }
    return '';
  }

  /**
   * Page address details. BC runs in an iframe; the top page address holds
   * the page id and is used when it is readable (same origin).
   */
  function readPageContext() {
    const urls = [];
    try {
      if (window.top !== window) urls.push(new URL(window.top.location.href));
    } catch (err) {
      // Cross-origin parent — only this frame's address is available
    }
    urls.push(new URL(location.href));

    const param = (name) => {
      for (const url of urls) {
        const value = url.searchParams.get(name);
        if (value) return value;
      }
      return '';
    };

    const main = urls[0];
    return {
      environment: detectEnvironment(main.host + main.pathname),
      host: main.host,
      company: param('company'),
      pageId: param('page'),
      url: main.href,
      time: formatLocalTime(new Date())
    };
  }

  /**
   * Environment label from "fragment = label" rules (one per line, first
   * match wins, case-insensitive), matched against host and path only.
   */
  function detectEnvironment(address) {
    const haystack = address.toLowerCase();
    for (const line of String(errorReport.environments || '').split(/\r?\n/)) {
      const rule = line.trim();
      if (!rule || rule.startsWith('#')) continue;
      const eq = rule.indexOf('=');
      const fragment = (eq < 0 ? rule : rule.slice(0, eq)).trim();
      const label = (eq < 0 ? rule : rule.slice(eq + 1)).trim();
      if (fragment && haystack.includes(fragment.toLowerCase())) return label || fragment;
    }
    return '';
  }

  function formatLocalTime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
           `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /**
   * Clicks BC's own "Share details" → "Copy error details" and takes the text
   * it writes to the clipboard (via content/page-hook.js). Returns '' when
   * the error has no details menu or nothing arrives in time.
   */
  async function fetchErrorDetails(root) {
    const button = root.querySelector('button[aria-haspopup="menu"]');
    if (!button || !button.id) return '';

    const captured = waitForCapturedCopy(DETAILS_TIMEOUT);
    if (button.getAttribute('aria-expanded') !== 'true') button.click();

    // The menu opens in a portal; "Copy error details" is its first item
    // (labels depend on the user's language, the order does not)
    const item = await waitFor(() => {
      const menu = document.querySelector(`[role="menu"][aria-labelledby="${CSS.escape(button.id)}"]`);
      return menu && menu.querySelector('[role="menuitem"]');
    }, 1000);
    if (item) item.click();
    const text = item ? await captured : '';

    if (button.isConnected && button.getAttribute('aria-expanded') === 'true') button.click();
    return text;
  }

  function waitForCapturedCopy(timeout) {
    return new Promise((resolve) => {
      const finish = (text) => {
        clearTimeout(timer);
        document.removeEventListener(CAPTURE_EVENT, onCaptured);
        resolve(text);
      };
      const onCaptured = (e) => finish(typeof e.detail === 'string' ? e.detail : '');
      const timer = setTimeout(() => finish(''), timeout);
      document.addEventListener(CAPTURE_EVENT, onCaptured);
      document.dispatchEvent(new CustomEvent(ARM_EVENT));
    });
  }

  function waitFor(check, timeout) {
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = () => {
        const result = check();
        if (result || Date.now() - started >= timeout) resolve(result || null);
        else setTimeout(poll, 50);
      };
      poll();
    });
  }

  function sanitizeDetails(text) {
    return String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();
  }

  // --- Report formats ---------------------------------------------------------

  function reportHeaderLines(report) {
    const lines = [`Environment: ${report.environment || `unknown (${report.host})`}`];
    if (report.company) lines.push(`Company: ${report.company}`);
    if (report.page || report.pageId) {
      lines.push(`Page: ${report.page || '?'}${report.pageId ? ` (page ${report.pageId})` : ''}`);
    }
    if (report.record) lines.push(`Record: ${report.record}`);
    if (report.field) lines.push(`Field: ${report.field}`);
    lines.push(`Time: ${report.time}`);
    lines.push(`URL: ${report.url}`);
    return lines;
  }

  function reportSummary(report) {
    const env = report.environment ? `[${report.environment}] ` : '';
    const message = report.message.length > 120 ? report.message.slice(0, 119) + '…' : report.message;
    return `${env}${report.page ? report.page + ': ' : ''}${message}`;
  }

  /** Markdown for an AI agent: context, data and what to do with it */
  function buildAgentText(report) {
    const cell = (value) => (value || '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
    const out = ['# Business Central error', '', ...reportHeaderLines(report), '',
      '## Error message', '', report.message || '(no message)', ''];

    for (const section of report.sections) {
      out.push(`## ${section.title}`, '', '| Field | Value |', '| --- | --- |');
      for (const [name, value] of section.rows) out.push(`| ${cell(name)} | ${cell(value)} |`);
      out.push('');
    }

    if (report.details) {
      const fence = '`'.repeat(Math.max(3, ...(report.details.match(/`+/g) || []).map((m) => m.length + 1)));
      out.push('## Technical details', '', fence + 'text', report.details, fence, '');
    }

    // Editable in the popup; an emptied field falls back to the default
    const instructions = String(errorReport.agentInstructions || '').trim() || DEFAULT_AGENT_INSTRUCTIONS;
    out.push('## Task', '', instructions);
    return out.join('\n');
  }

  /** Jira wiki markup — the plain-text half of the Jira copy */
  function buildJiraText(report) {
    const escape = (value) => (value || '').replace(/([[\]{}|*_^+~!])/g, '\\$1').replace(/\s*\n\s*/g, ' ');
    const out = [`Summary: ${reportSummary(report)}`, '', ...reportHeaderLines(report), '',
      'h3. Error message', `{quote}${escape(report.message)}{quote}`, '',
      'h3. Steps to reproduce', '# ', ''];

    for (const section of report.sections) {
      out.push(`h3. ${escape(section.title)}`, '||Field||Value||');
      for (const [name, value] of section.rows) out.push(`|${escape(name) || ' '}|${escape(value) || ' '}|`);
      out.push('');
    }

    if (report.details) {
      out.push('h3. Technical details', '{noformat}', report.details.replace(/\{noformat\}/gi, '{ noformat }'), '{noformat}');
    }
    return out.join('\n');
  }

  /** The same report as HTML — what Jira's rich text editor uses on paste */
  function buildJiraHtml(report) {
    const esc = (value) => String(value || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const html = [`<p>Summary: ${esc(reportSummary(report))}</p>`,
      `<p>${reportHeaderLines(report).map(esc).join('<br>')}</p>`,
      '<h3>Error message</h3>', `<blockquote>${esc(report.message)}</blockquote>`,
      '<h3>Steps to reproduce</h3>', '<ol><li></li></ol>'];

    for (const section of report.sections) {
      html.push(`<h3>${esc(section.title)}</h3>`, '<table><tr><th>Field</th><th>Value</th></tr>');
      for (const [name, value] of section.rows) html.push(`<tr><td>${esc(name)}</td><td>${esc(value)}</td></tr>`);
      html.push('</table>');
    }

    if (report.details) html.push('<h3>Technical details</h3>', `<pre>${esc(report.details)}</pre>`);
    return html.join('');
  }

  // --- Screenshot ---------------------------------------------------------------

  /**
   * Screenshot of the visible tab, taken and kept by the service worker.
   * Our own buttons, panel and toasts are hidden while it is taken.
   * Returns { ok } or { error }.
   */
  async function captureScreenshot() {
    const root = document.documentElement;
    root.classList.add('bc-sc-capturing');
    try {
      // Let the browser paint the page without our UI (rAF would stall in background tabs)
      await new Promise((resolve) => setTimeout(resolve, 120));
      const response = await chrome.runtime.sendMessage({ type: 'capture-visible-tab' });
      if (response && response.ok) return { ok: true };
      const reason = (response && response.error) || '';
      return {
        error: /permission|activeTab|all_urls/i.test(reason)
          ? 'Allow screenshots in the extension popup (Error reports).'
          : reason || 'The browser did not return a screenshot.'
      };
    } catch (err) {
      return { error: 'Reload the page after updating the extension.' };
    } finally {
      root.classList.remove('bc-sc-capturing');
    }
  }

  /**
   * Images cannot be put into the clipboard from http:// BC pages, so a short
   * extension tab copies the stored screenshot and closes itself.
   * Returns an error message or ''.
   */
  async function copyScreenshot() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'copy-screenshot' });
      return response && response.ok ? '' : ((response && response.error) || 'Failed to copy the screenshot.');
    } catch (err) {
      return 'Reload the page after updating the extension.';
    }
  }

  /**
   * Text + HTML in one clipboard entry. On http:// BC pages there is no async
   * Clipboard API, so the data is set in a 'copy' event instead. Plain text
   * only when both fail.
   */
  async function copyRichToClipboard(text, html) {
    try {
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        })]);
        return true;
      }
    } catch (err) {
      console.warn('BC Smart Copier: Rich copy failed, trying copy event...', err);
    }

    if (copyWithCopyEvent({ 'text/plain': text, 'text/html': html })) return true;
    return copyToClipboard(text);
  }

  function copyWithCopyEvent(data) {
    let written = false;
    const onCopy = (e) => {
      if (!e.clipboardData) return;
      for (const [type, value] of Object.entries(data)) e.clipboardData.setData(type, value);
      written = true;
      e.preventDefault();
      e.stopImmediatePropagation(); // BC's own copy handlers must not overwrite it
    };
    window.addEventListener('copy', onCopy, true);
    try {
      return document.execCommand('copy') && written;
    } catch (err) {
      return false;
    } finally {
      window.removeEventListener('copy', onCopy, true);
    }
  }

  // ---------------------------------------------------------------------------
  // SHARED UTILITIES
  // ---------------------------------------------------------------------------

  /**
   * Normalizes cell text (replaces non-breaking spaces, trims extra whitespace)
   */
  function sanitizeText(rawText) {
    if (!rawText) return '';

    return rawText
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  /**
   * Safe text copy to clipboard with fallback
   */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('BC Smart Copier: Clipboard API failed, trying fallback...', err);
    }

    // Fallback for older contexts or restricted iframes
    try {
      if (!document.body) return false;
      const previousFocus = document.activeElement;
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus({ preventScroll: true });
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      // Give focus back so BC does not lose its current field / row
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus({ preventScroll: true });
      }
      return successful;
    } catch (err) {
      console.error('BC Smart Copier: Fallback copy failed', err);
      return false;
    }
  }

  /**
   * Cell highlight effect
   */
  function highlightElement(el) {
    if (!el || !el.classList) return;

    // Restart the timer on repeated copies so an older timeout cannot cut it short
    if (el._bcHighlightTimer) clearTimeout(el._bcHighlightTimer);
    el.classList.add('bc-smart-copier-cell-highlight');
    el._bcHighlightTimer = setTimeout(() => {
      el.classList.remove('bc-smart-copier-cell-highlight');
      el._bcHighlightTimer = null;
    }, 800);
  }

  /**
   * Creates and displays a stacked notification Toast element.
   * Top-insertion prepends new toasts to the top of the container.
   * Container is capped at 5 visible toasts; older toasts are removed immediately.
   * Each toast auto-expires after 4 seconds.
   *
   * @param {string} title — Toast header label
   * @param {string} value — Main content text
   * @param {boolean} isError — When true, applies error styling (red icon & border)
   */
  function showToast(title, value, isError) {
    let container = document.getElementById('bc-smart-copier-toast-container');

    if (!container) {
      container = document.createElement('div');
      container.id = 'bc-smart-copier-toast-container';
      (document.body || document.documentElement).appendChild(container);
    }

    // Build toast item DOM programmatically (XSS-safe)
    const toast = document.createElement('div');
    toast.className = 'bc-toast-item' + (isError ? ' bc-toast-error' : '');

    const icon = document.createElement('div');
    icon.className = 'bc-toast-icon';
    icon.textContent = isError ? '!' : '✓';

    const body = document.createElement('div');
    body.className = 'bc-toast-body';

    const titleEl = document.createElement('div');
    titleEl.className = 'bc-toast-title';
    titleEl.textContent = title;

    const valueEl = document.createElement('div');
    valueEl.className = 'bc-toast-value';
    valueEl.textContent = value;

    body.append(titleEl, valueEl);
    toast.append(icon, body);

    // Prepend to container (top-insertion stacking)
    container.prepend(toast);

    // Cap at MAX_TOASTS (5): remove oldest at bottom
    while (container.children.length > MAX_TOASTS) {
      const oldest = container.lastElementChild;
      if (oldest) {
        if (oldest._removeTimer) clearTimeout(oldest._removeTimer);
        oldest.remove();
      }
    }

    // Force browser reflow to guarantee smooth CSS transition animation
    void toast.offsetHeight;
    toast.classList.add('bc-toast-show');

    // Auto-expire after 4 seconds
    toast._removeTimer = setTimeout(() => {
      toast.classList.remove('bc-toast-show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 250); // wait for fade-out transition
    }, TOAST_DURATION);
  }
})();
