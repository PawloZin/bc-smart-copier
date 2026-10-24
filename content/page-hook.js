/**
 * BC Smart Copier - Page Hook (runs in the page's MAIN world)
 *
 * Business Central's "Copy error details" menu item puts the technical
 * details (AL call stack, correlation ID …) straight into the clipboard —
 * they never appear in the DOM. When the content script clicks that item for
 * an error report it first arms this hook; the next clipboard write of the
 * page is then handed to the content script instead of the clipboard.
 *
 * Unarmed, every call passes through untouched. Nothing is stored or logged.
 */

(function () {
  'use strict';

  // Must stay in sync with ARM_EVENT / CAPTURE_EVENT in content/content.js
  const ARM_EVENT = 'bc-smart-copier:arm-copy-capture';
  const CAPTURE_EVENT = 'bc-smart-copier:copy-captured';
  const ARM_WINDOW = 3000;

  let armedUntil = 0;

  document.addEventListener(ARM_EVENT, () => {
    armedUntil = Date.now() + ARM_WINDOW;
  });

  function isArmed() {
    return Date.now() < armedUntil;
  }

  function capture(text) {
    armedUntil = 0;
    document.dispatchEvent(new CustomEvent(CAPTURE_EVENT, { detail: String(text || '') }));
  }

  const clipboard = navigator.clipboard;
  if (clipboard) {
    const originalWriteText = clipboard.writeText;
    if (originalWriteText) {
      clipboard.writeText = function (text) {
        if (!isArmed()) return originalWriteText.apply(this, arguments);
        capture(text);
        return Promise.resolve();
      };
    }

    const originalWrite = clipboard.write;
    if (originalWrite) {
      clipboard.write = function (items) {
        const item = isArmed() && items && items[0];
        if (!item || !item.types || !item.types.includes('text/plain')) {
          return originalWrite.apply(this, arguments);
        }
        return item.getType('text/plain').then((blob) => blob.text()).then(capture);
      };
    }
  }

  // Older pattern: a 'copy' handler fills clipboardData during execCommand('copy')
  if (typeof DataTransfer !== 'undefined') {
    const originalSetData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (format, data) {
      if (isArmed() && /^text(\/plain)?$/i.test(format)) capture(data);
      return originalSetData.apply(this, arguments);
    };
  }

  // Oldest pattern: execCommand('copy') on a selected hidden textarea
  const originalExecCommand = document.execCommand;
  document.execCommand = function (command) {
    if (isArmed() && String(command).toLowerCase() === 'copy') {
      const active = document.activeElement;
      const text = active && typeof active.value === 'string' && /^(TEXTAREA|INPUT)$/.test(active.tagName)
        ? active.value.slice(active.selectionStart || 0, active.selectionEnd || active.value.length)
        : String(window.getSelection() || '');
      const result = originalExecCommand.apply(this, arguments);
      if (isArmed() && text) capture(text);
      return result;
    }
    return originalExecCommand.apply(this, arguments);
  };
})();
