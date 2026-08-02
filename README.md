<p align="center">
  <img src="assets/icons/icon_large.svg" alt="BC Smart Copier Logo" width="160" height="160">
</p>

<h1 align="center">BC Smart Copier</h1>

<p align="center">
  A lightweight browser extension for <b>Microsoft Dynamics 365 Business Central</b>.
</p>

---

## 🎬 Demo

![BC Smart Copier Demo](assets/docs/demo.gif)

---

## 🚀 Shortcuts & Actions

| Shortcut | Action | Example output |
|---|---|---|
| `Ctrl / Cmd ⌘` + **Click** | Copy cell value | `10000` or `[No.]` |
| `Ctrl / Cmd ⌘` + `Shift` + **Click** | Copy action path | `open page [Sales Orders] and go to [Related] tab -> [Documents] and click {Prepayment Invoices}` |

---

## 💡 How it works

### Copy Cell Value — `Ctrl / Cmd ⌘` + Left Click
1. Hold **CTRL** (or **CMD ⌘** on Mac).
2. Left-click any cell, field, or column header in Business Central.
3. The clean text value is automatically sanitized and copied to your clipboard.
4. The cell briefly highlights in green, and a Toast notification displays the copied value.

### Copy Action Path — `Ctrl / Cmd ⌘` + `Shift` + Left Click
1. Hold **CTRL + SHIFT** (or **CMD ⌘ + SHIFT** on Mac).
2. Left-click any action button in the BC toolbar or action bar.
3. The extension extracts the **Page Name**, **Active Tab**, **Submenu hierarchy**, and **Action Button label** and copies a structured path to your clipboard.
4. Examples:
   - **Direct action**: `open page [Sales Order] and go to [Home] tab and click {Post}`
   - **Nested submenu**: `open page [Sales Orders] and go to [Related] tab -> [Documents] and click {Prepayment Invoices}`

> **Note**: Both shortcuts call `e.preventDefault()` and `e.stopPropagation()` to prevent unintended BC actions — such as link navigation, entering edit mode, or opening report request pages.

---

## ✨ Key Features

- **Smart Text Sanitization**: Automatically converts non-breaking spaces (`\u00A0`), normalizes line breaks, and trims excess whitespace.
- **Stacked Toast Feedback**: Green cell outline animation and stacked floating Toast notifications (anchored bottom-center, top-inserted, 4-second duration, capped at 5 visible toasts).
- **Toggle Control**: Easily enable or disable the extension anytime via the toolbar popup icon.
- **100% Private & Local**: Runs entirely inside your browser with zero external network tracking or data collection.

---

## 🛠️ Installation Guide (Microsoft Edge / Google Chrome)

Load directly from source files (Developer Mode):

### For Microsoft Edge:
1. Open Microsoft Edge and go to: `edge://extensions`
2. Turn on the **Developer mode** toggle in the bottom left corner.
3. Click **Load unpacked**.
4. Select the project directory.
5. Done! The extension icon will appear in the toolbar.

### For Google Chrome:
1. Open Google Chrome and go to: `chrome://extensions`
2. Turn on the **Developer mode** toggle in the top right corner.
3. Click **Load unpacked**.
4. Select the project directory.
5. Done!

---

## 📂 Project Structure

- `manifest.json` – Extension configuration (Manifest V3).
- `content/content.js` – Two shortcuts: `Ctrl/Cmd + Click` copies cell value; `Ctrl/Cmd + Shift + Click` copies the full action path including submenus (Page › Tab › Submenu › Action).
- `content/content.css` – Styles for cell highlight animation and Toast notifications.
- `popup/` – Popup interface for quick enable/disable toggle.
- `assets/icons/` – Extension icons set (SVG sources & PNG formats).
- `assets/docs/` – Documentation assets and demo recordings.

---

## 📜 Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history and release notes.