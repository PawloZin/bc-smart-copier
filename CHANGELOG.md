# Changelog

All notable changes to the **BC Smart Copier** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
