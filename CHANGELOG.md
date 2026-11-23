# Changelog

All notable changes to the **BC Smart Copier** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.13.0] - 2026-11-23

### Added
- **Error reports in Dynamics NAV 2016**: NAV shows errors in a message bar at the top of the page (e.g. *You cannot delete Item 1000 because there is at least one outstanding Sales Order that includes this item.*). The error panel with *Copy for AI agent* / *Copy for Jira* appears for it too; the actual message (`role="alert"`) is preferred over the general *The page has an error* bar. The report holds the page, record, page mode (Edit, View, New, Delete) and all fields; NAV 2016 has no technical details (call stack) to add.
- **Separate setup for Business Central and NAV 2016**: In the popup (*Error reports*) a switch selects the system; buttons on errors, environment rules and AI agent instructions are stored per system. The default NAV instructions refer to C/AL code. The screenshot option is shared.
- Reports name the system (`System: Microsoft Dynamics NAV 2016` / `… Business Central`); the panel title says *Dynamics NAV error* or *Business Central error*.
- NAV FactBoxes are skipped in the record data.
- Test fixture: NAV 2016 *Item Card* with a delete error.

---

## [1.12.0] - 2026-11-23

### Added
- **FastTab in the action path** (Business Central and NAV 2016): When the clicked element is inside a FastTab (General, Invoicing, Payments, …) or a part (Lines), the path names it — e.g. `open page [Posted Purchase Receipt] and go to [Lines] FastTab and go to [Functions] tab and click {Undo Receipt}`. For actions in a popup menu the FastTab of the menu button is used.
- **Field and column paths**: The action path shortcut on a field (caption or value) copies the path to the field, e.g. `open page [Customer Card] and go to [Invoicing] FastTab and find field {Customer Posting Group}`; on a grid cell the path to the column, e.g. `… and go to [Lines] FastTab and find column {No.}`.

### Fixed
- **Tab of part actions**: Actions in a part's own action bar (e.g. *Lines → Functions*) reported the page's tab (*Home*) instead of the part's tab.

---

## [1.11.0] - 2026-11-23

### Added
- **Microsoft Dynamics NAV 2016 (Web Client)**: Cell copy, Table Copier and action path work in NAV 2016 too.
  - Action path: the page name comes from the NAV window title (`Edit - Customer Card` → `Customer Card`, the record part of `Edit - Sales Order - 101005 ∙ …` is dropped), and the ribbon tab of the clicked button (Home, Actions, Navigate, Report, …) is detected — e.g. `open page [Customer Card] and go to [Navigate] tab and click {Dimensions}`.
  - Test fixtures: NAV 2016 *Customer Card* and *Sales Order*.

### Fixed
- **Table Copier in edit mode**: Cells holding a form control (edit-mode grids in NAV and BC) copied an empty value or, for option fields, every option at once. The control's value and the selected option are copied now; the row selection checkbox is skipped, and an empty header cell uses its column caption (`abbr`) — NAV keeps the captions in a separate header table.

---

## [1.10.0] - 2026-11-03

### Changed
- **Append mode starts with an empty clipboard**: Switching append mode on clears the clipboard and starts a new, empty list, instead of continuing from the clipboard content (1.9.0). Switching it off keeps the list in the clipboard, ready to paste.

### Removed
- The `clipboardRead` permission, no longer needed.

---

## [1.9.2] - 2026-11-03

### Fixed
- **Double-tap Shift did not switch append mode**: A mouse click or a typed character before the double-tap cancelled the first tap, so after clicking in Business Central the mode never switched on. Only a click or key pressed *while* the modifier is held cancels a tap now.

---

## [1.9.1] - 2026-11-03

### Fixed
- **Error panel missing for a repeated error**: After an error was hidden with ×, the same error never showed the panel again, because the dismissal was remembered by message text. × now hides only the current occurrence; when the error disappears and comes back, the panel shows again.
- **Reused error dialogs**: Errors were detected only when BC added new elements. If BC showed the same dialog again by changing its classes, no panel appeared. Class, style and `aria-hidden` changes are now watched too, and a dialog counts only while its view is shown.

---

## [1.9.0] - 2026-11-02

### Changed
- **Append mode starts from the clipboard**: Switching append mode on now reads the clipboard and continues that list (a previous `A|'B&C'|D` is split back into values), also after a normal `Ctrl + C`. On `https://` the async Clipboard API is used; on `http://` BC servers (no async Clipboard API outside secure contexts) a legacy paste into a hidden field is used, kept away from BC's own paste handlers. Multi-line content (e.g. a copied table) starts a new list; if the clipboard cannot be read, the value the extension copied last is used.

### Security
- New permission **`clipboardRead`** (Chrome asks to accept it after the update). The clipboard is read only when append mode is switched on, and the text is not stored or sent anywhere.

---

## [1.8.0] - 2026-11-02

### Added
- **Append mode for BC filters**: Double-tap the cell shortcut keys (default `Shift`) to switch the copy mode — each copied value is then added to the previous ones with `|` (e.g. `10000|20000|30000`), ready to paste into a BC filter. Double-tap again, press `Esc` or click × on the badge to switch back.
  - The list starts with the value copied last by the extension (reading the clipboard would need an extra permission and does not work on `http://` BC servers).
  - Values already in the list are skipped; values with filter characters are quoted (`'A&B Partners'`).
  - A yellow toast announces every mode change and a yellow badge at the top shows the current list.
  - Can be switched off in the popup (*Double-tap to append with |*).

---

## [1.7.1] - 2026-10-28

### Fixed
- **Duplicated buttons on error dialogs**: Error dialogs showed *Copy for AI agent* / *Copy for Jira* twice — inside the dialog and in the error panel. The buttons are now only in the panel at the bottom; BC's dialog is left untouched.

---

## [1.7.0] - 2026-10-28

### Changed
- **Jira bug template**: *Copy for Jira* now follows the team's bug layout — *Short BUG description*, *Environment*, *Role/actor*, *Pre conditions*, *Steps to reproduce the BUG*, *Actual result*, *Expected results*, *Additional data*. Known data is filled in (page and error, environment, company / page / record, first step "Open …", the error as the actual result, time, URL, record tables and technical details); *Role/actor*, *Expected results* and further steps stay empty for the reporter.

---

## [1.6.0] - 2026-10-28

### Added
- **Editable AI agent instructions**: The task at the end of *Copy for AI agent* can be edited in the popup (*Error reports → Instructions for the AI agent*), with *Restore default instructions*. An empty field uses the default.
- The default instructions have a new step: check the knowledge base thoroughly, including the application code it contains, and trace where the error is raised.

---

## [1.5.3] - 2026-10-28

### Fixed
- **Error panel on required fields**: Empty mandatory fields (e.g. *Name*, *Customer Posting Group* on a new Customer Card) use the same marker as validation errors, so the error panel appeared with "The value for this field is required." Only fields with BC's error icon count as validation errors now.
- Test fixture: *Customer Card* with empty required fields.

---

## [1.5.2] - 2026-10-28

### Changed
- **Bigger error panel at the bottom center**: The error panel moved from the bottom-right corner to the bottom center and is about 50% larger (wider, bigger text and buttons). Toasts are shown above it instead of covering it.

---

## [1.5.1] - 2026-10-28

### Fixed
- **Error panel missing for error dialogs**: The floating error panel with *Copy for AI agent* / *Copy for Jira* appeared only for field validation errors, so error dialogs (e.g. *Undo Receipt* on a Posted Purchase Receipt) showed the buttons only inside the dialog. The panel now appears for error dialogs too.
- Test fixture: *Posted Purchase Receipt* with an error dialog.

---

## [1.5.0] - 2026-10-24

### Added
- **Error reports**: When Business Central shows an error dialog or a field validation error, the extension adds **Copy for AI agent** and **Copy for Jira** buttons (in the dialog, or in a small panel for validation errors). The copy contains:
  - the environment, detected from the page address with editable `fragment = name` rules (default `STG = STG`, `QA = QA`, `client = PROD`; first match wins), plus company, page, record, field, time and URL;
  - the error message and BC's technical details (AL call stack etc.), taken from BC's own *Copy error details* menu item in any UI language;
  - the record: all fields of the page and the current (focused) row of every grid, with column names. Hidden fields and columns and FactBoxes are skipped.
- *Copy for AI agent* produces Markdown with a short task for the agent (explain the cause, search the knowledge base and Jira issues for similar cases, propose a fix). *Copy for Jira* produces Jira wiki markup plus HTML, with `Summary:`, `Environment:` lines and a *Steps to reproduce* placeholder.
- **Optional screenshot**: With *Screenshot (second click)* switched on, the visible tab is captured (without the extension's own buttons) and the clicked button turns into **Copy screenshot**. The screenshot is kept in session storage (memory only); the second click opens a short-lived extension tab that copies it and closes itself — on `http://` BC servers pages cannot put images into the clipboard. Enabling it asks for the optional `<all_urls>` host permission; switching it off releases the permission.
- *Copy for Jira* sets text and HTML through a `copy` event when the async Clipboard API is unavailable (`http://` BC servers), so the rich version is kept there too.
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
