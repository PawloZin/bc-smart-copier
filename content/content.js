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

  let isEnabled = true;
  let shortcuts = { ...DEFAULT_SHORTCUTS };

  // Retrieve initial extension state from chrome.storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ enabled: true, shortcuts: DEFAULT_SHORTCUTS }, (res) => {
      isEnabled = res.enabled !== false;
      shortcuts = normalizeShortcuts(res.shortcuts);
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.enabled !== undefined) {
        isEnabled = changes.enabled.newValue !== false;
      }
      if (changes.shortcuts !== undefined) {
        shortcuts = normalizeShortcuts(changes.shortcuts.newValue);
      }
      hideTableOverlay();
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
