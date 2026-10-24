# Changelog

All notable changes to the **BC Smart Copier** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.0] - 2026-10-24

### Added
- **Error reports**: When Business Central shows an error dialog or a field validation error, the extension adds **Copy for AI agent** and **Copy for Jira** buttons (in the dialog, or in a small panel for validation errors). The copy contains:
  - the environment, detected from the page address with editable `fragment = name` rules (default `STG = STG`, `QA = QA`, `client = PROD`; first match wins), plus company, page, record, field, time and URL;
  - the error message and BC's technical details (AL call stack etc.), taken from BC's own *Copy error details* menu item in any UI language;
  - the record: all fields of the page and the current (focused) row of every grid, with column names. Hidden fields and columns and FactBoxes are skipped.
- *Copy for AI agent* produces Markdown with a short task for the agent (explain the cause, search the knowledge base and Jira issues for similar cases, propose a fix). *Copy for Jira* produces Jira wiki markup plus HTML, with `Summary:`, `Environment:` lines and a *Steps to reproduce* placeholder.
- **Optional screenshot**: With *Screenshot (second click)* switched on, the visible tab is captured (without the extension's own buttons) and the clicked button turns into **Copy screenshot**. Enabling it asks for the optional `<all_urls>` host permission; switching it off releases the permission.
- Error report settings in the popup: show buttons, screenshot, environment rules.
- Test fixtures: *Customer Ledger Entries* with an error dialog, *Merge Duplicate* with a field validation error.

---

## [1.4.1] - 2026-10-24

### Fixed
- **Field caption copied the value**: Clicking a field caption on a card page (e.g. *Omit Default Descr. in Jnl.*) copied the field's value (`No`, or the text of the field) instead of the caption, because caption and value share one container. The caption is now matched first and its own text is copied.

---

## [1.4.0] - 2026-10-14

### Added
- **Table Copier**: Hold the Table Copier shortcut (default `Alt`, `⌥ Option` on Mac) and point at any HTML table to outline it in green; click to copy all visible rows as TSV (TAB between columns, CRLF between rows) that pastes into Excel as rows and columns. `colspan` / `rowspan` keep columns aligned, cell text is normalized (line breaks, tabs and non-breaking spaces become spaces). The shortcut is configurable alongside the others and takes part in the same conflict check.

---

## [1.3.0] - 2026-09-30

### Added
- **Configurable Shortcuts**: Both copy shortcuts can now be set in the popup to `Shift`, `Alt`, `Ctrl / Cmd ⌘` or a two-key combination, with a *Restore defaults* option. On macOS the popup shows native key symbols (`⇧`, `⌥`, `⌘`). A warning is shown when `Ctrl / Cmd ⌘` is selected, because it collides with multi-row selection in Business Central.

### Changed
- **New Default Shortcuts**: Copy cell value is now `Shift + Click` (was `Ctrl / Cmd ⌘ + Click`), copy action path is now `Alt + Shift + Click` (was `Ctrl / Cmd ⌘ + Shift + Click`).
- Popup version label is read from the manifest.
- Removed the redundant `host_permissions` entry — content script matches already grant the required access.

### Fixed
- **Page Name on Stacked Pages**: The action path used the caption of a page lying underneath the current one (e.g. `Items` instead of `Item Card`). The lookup is now scoped to the page that owns the click, or the top-most page for popup menus.
- **Boolean Fields**: Copying a Boolean cell returned `on`; it now returns `Yes` / `No`.
- **Click Leaking to BC**: Releasing the modifier key before the mouse button let the click reach Business Central (opening records or report pages). The whole gesture, including `dblclick` and `contextmenu`, is now suppressed.
- **Focus Loss**: The clipboard fallback now restores focus to the previously focused BC field.
- **Highlight Flicker**: Repeated copies of the same cell no longer cut the highlight short.

### Removed
- Unused legacy single-toast cleanup, an unreachable page-title selector and dead popup code.

---

## [1.2.0] - 2026-08-02

### Added
- **Stacked Toast Notifications**: Added support for bottom-center anchored stacked toast notifications with top-insertion, 4-second visibility duration, and a maximum cap of 5 concurrently visible toasts when rapidly copying values.

---

## [1.1.0] - 2026-08-02

### Added
- **Action Path Copying**: Added `Ctrl / Cmd ⌘ + Shift + Click` shortcut to copy full Business Central action navigation paths.
- **Nested Submenu Support**: Full support for flyout submenus formatted as `open page [Sales Orders] and go to [Related] tab -> [Documents] and click {Prepayment Invoices}`.
- **UI Popup Redesign**: Updated extension popup interface to display instructions and shortcuts for both copy modes.

### Fixed
- **Page Name Extraction**: Resolved bug where document title returned generic `Dynamics 365 Business Central` due to iframe scope; page name is now extracted directly from Business Central `form[controlname]`.
- **Active Tab Resolution**: Fixed tab matching where `Home` was incorrectly preferred over open popup tabs like `Related` or `Actions`.

---

## [1.0.0] - 2026-08-01

### Added
- Initial release of **BC Smart Copier**.
- **Cell Value Copying**: `Ctrl / Cmd ⌘ + Click` to copy cell, field, or column text.
- Text sanitization, visual green highlight feedback, and Toast notifications.
- Enable/disable toggle switch in popup settings.
