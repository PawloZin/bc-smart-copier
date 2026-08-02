/**
 * BC Smart Copier - Content Script
 * Captures Ctrl / Cmd + Left Click on cells in Microsoft Dynamics 365 Business Central
 * and copies clean text content to clipboard.
 */

(function () {
  'use strict';

  let toastTimeout = null;
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
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;

    // Block the event if a copy was performed within the last 500ms
    if (Date.now() - lastCopyTime < 500) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }

  function isShortcutMatch(e) {
    // Check for left mouse button click
    if (e.button !== 0) {
      return false;
    }

    // Require CTRL (or CMD on Mac), without SHIFT or ALT
    return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
  }

  function handleShortcutEvent(e) {
    if (!isShortcutMatch(e) || !isEnabled) {
      return;
    }

    // Synchronously block default BC / browser action
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Debounce: ignore repeated triggers within 250ms
    const now = Date.now();
    if (now - lastCopyTime > 250) {
      lastCopyTime = now;
      processCopy(e);
    }
  }

  function processCopy(e) {
    const rawTarget = e.target;
    if (!rawTarget) return;

    // 1. Identify target cell element
    const cellElement = findCellElement(rawTarget);

    // 2. Extract and sanitize cell value
    const extractedText = extractCleanValue(rawTarget, cellElement);

    if (!extractedText) {
      showToast('Cell is empty', 'No text found to copy.', true);
      return;
    }

    // 3. Copy value to clipboard
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
   * Creates or updates notification Toast element.
   * @param {string} title — Toast header label
   * @param {string} value — Main content text
   * @param {boolean} isError — When true, applies error styling (red icon & border)
   */
  function showToast(title, value, isError) {
    let toast = document.getElementById('bc-smart-copier-toast');

    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bc-smart-copier-toast';

      // Build DOM programmatically — avoids innerHTML and XSS risk
      const icon = document.createElement('div');
      icon.className = 'bc-toast-icon';

      const body = document.createElement('div');
      body.className = 'bc-toast-body';

      const titleEl = document.createElement('div');
      titleEl.className = 'bc-toast-title';

      const valueEl = document.createElement('div');
      valueEl.className = 'bc-toast-value';

      body.append(titleEl, valueEl);
      toast.append(icon, body);
      document.body.appendChild(toast);
    }

    const iconEl = toast.querySelector('.bc-toast-icon');
    const titleEl = toast.querySelector('.bc-toast-title');
    const valueEl = toast.querySelector('.bc-toast-value');

    // Update icon and styling based on error state
    if (iconEl) iconEl.textContent = isError ? '!' : '✓';
    if (titleEl) titleEl.textContent = title;
    if (valueEl) valueEl.textContent = value;

    // Toggle error class for red styling
    toast.classList.toggle('bc-toast-error', !!isError);
    toast.classList.add('bc-toast-show');

    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }

    toastTimeout = setTimeout(() => {
      toast.classList.remove('bc-toast-show');
    }, 2200);
  }
})();
