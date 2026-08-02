/**
 * BC Smart Copier - Content Script
 * Captures Ctrl / Cmd + Left Click on cells in Microsoft Dynamics 365 Business Central
 * and copies clean text content to clipboard.
 *
 * Shortcuts:
 *   Ctrl / Cmd + Left Click          → Copy cell value
 *   Ctrl / Cmd + Shift + Left Click  → Copy action path (Page › Tab › Action)
 */

(function () {
  'use strict';

  const MAX_TOASTS = 5;
  const TOAST_DURATION = 4000; // 4 seconds visible duration
  let isEnabled = true;

  // Retrieve initial extension state from chrome.storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ enabled: true }, (res) => {
      isEnabled = res.enabled !== false;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.enabled !== undefined) {
        isEnabled = changes.enabled.newValue !== false;
      }
    });
  }

  let lastCopyTime = 0;

  // --- Event Interception Strategy ---
  // BC's SPA framework listens on multiple event types to handle navigation:
  //   pointerdown, mousedown, click (and sometimes mouseup).
  // Simply calling preventDefault/stopImmediatePropagation on pointerdown
  // does NOT stop mousedown or click from firing — these are separate event
  // types that the browser always dispatches in sequence:
  //   pointerdown → mousedown → pointerup → mouseup → click
  //
  // Strategy:
  //   1. Intercept pointerdown — perform copy, record timestamp.
  //   2. Suppress mousedown, mouseup, click in capture phase for 500ms after
  //      a copy — this prevents BC from handling any of them.
  window.addEventListener('pointerdown', handleShortcutEvent, true);
  window.addEventListener('mousedown',   suppressBcEventAfterCopy, true);
  window.addEventListener('mouseup',     suppressBcEventAfterCopy, true);
  window.addEventListener('click',       suppressBcEventAfterCopy, true);

  /**
   * Blocks mousedown / mouseup / click events that arrive after a copy
   * gesture. Without this, Business Central still processes those events
   * (e.g. opens a report request page or navigates to a linked record)
   * even though we already intercepted pointerdown.
   */
  function suppressBcEventAfterCopy(e) {
    if (!isEnabled) return;
    if (e.button !== 0) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

    // Block the event if a copy was performed within the last 500ms
    if (Date.now() - lastCopyTime < 500) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }

  /**
   * Returns which shortcut mode is active, or null if no shortcut applies.
   * 'cell'   → Ctrl/Cmd + Left Click (no Shift)
   * 'action' → Ctrl/Cmd + Shift + Left Click
   */
  function getShortcutMode(e) {
    if (e.button !== 0) return null;
    if (!(e.ctrlKey || e.metaKey)) return null;
    if (e.altKey) return null;

    return e.shiftKey ? 'action' : 'cell';
  }

  function handleShortcutEvent(e) {
    const mode = getShortcutMode(e);
    if (!mode || !isEnabled) return;

    // Synchronously block default BC / browser action
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Debounce: ignore repeated triggers within 250ms
    const now = Date.now();
    if (now - lastCopyTime > 250) {
      lastCopyTime = now;
      if (mode === 'action') {
        processActionCopy(e);
      } else {
        processCellCopy(e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CELL VALUE COPY  (Ctrl / Cmd + Click)
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
    let text = '';

    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      text = target.value;
    } else {
      const inputChild = cellElement.querySelector('input, textarea, select');
      if (inputChild && inputChild.value) {
        text = inputChild.value;
      } else {
        const readControl = target.closest('.stringcontrol-read, .ms-list-itemLink, a, span') || target;
        text = readControl.innerText || cellElement.innerText || readControl.textContent || cellElement.textContent || '';
      }
    }

    return sanitizeText(text);
  }

  // ---------------------------------------------------------------------------
  // ACTION PATH COPY  (Ctrl / Cmd + Shift + Click)
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
   * Tries in order:
   * 1. Visible page header title (.synopsis-trigger / caption) — gives exact display caption (e.g., "Sales Orders", "Customer Card")
   * 2. Active form attributes: aria-label (for List pages) or controlname (for Card pages)
   * 3. Role=heading or h1 fallbacks
   */
  function extractPageName(target) {
    // 1. Visible page header title (most accurate display caption for both Card & List pages)
    const titleEl = document.querySelector(
      '.synopsis-trigger .content--RL_ctU0B98IcxQ8B, .synopsis-trigger, [id$="_subtitle"] span, .menu-bar__page-title [role="heading"]'
    );
    if (titleEl) {
      let text = sanitizeText(titleEl.innerText || titleEl.textContent || '');
      text = text.replace(/:\s*$/, '').trim();
      if (text) return text;
    }

    // 2. Form element attributes
    const form = target.closest('form[controlname]') ||
                 document.querySelector('.spa-view.shown form[controlname], .spa-view.shown > form[controlname]') ||
                 document.querySelector('form[controlname]');
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
      const el = document.querySelector(sel);
      if (el) {
        let text = sanitizeText(el.innerText || el.textContent || '');
        text = text.replace(/:\s*$/, '').trim();
        if (text) return text;
      }
    }

    return '';
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
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
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

    el.classList.add('bc-smart-copier-cell-highlight');
    setTimeout(() => {
      el.classList.remove('bc-smart-copier-cell-highlight');
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
    // Remove legacy single-toast element if present
    const legacyToast = document.getElementById('bc-smart-copier-toast');
    if (legacyToast) legacyToast.remove();

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
