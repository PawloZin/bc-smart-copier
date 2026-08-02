# BC Smart Copier - Extension for Microsoft Edge & Google Chrome

A lightweight extension designed for **Microsoft Dynamics 365 Business Central**. Enables instant copying of table cells and form fields using **Ctrl + Left Click** (or **Cmd ⌘ + Left Click** on Mac).

---

## 🚀 How it works

1. Hold the **CTRL** key (or **CMD ⌘** on Mac).
2. Left-click any cell in a table, list, card field, or header in Business Central.
3. The clean text value is automatically sanitized and copied to your clipboard.
4. The cell briefly highlights in green, and a discrete **Toast** notification displays the copied value.

> **Note**: Clicking with **CTRL / CMD** automatically prevents unintended Business Central actions — such as link navigation, entering field edit mode, or opening report request pages.

---

## ✨ Key Features

- **Smart Text Sanitization**: Automatically converts non-breaking spaces (`\u00A0`), normalizes line breaks, and trims excess whitespace.
- **Visual Feedback**: Green cell outline animation and subtle floating Toast notification (with error handling for empty cells).
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
- `content/content.js` – Captures `Ctrl / Cmd + Click`, prevents default actions, sanitizes and copies cell text.
- `content/content.css` – Styles for cell highlight animation and Toast notifications.
- `popup/` – Popup interface for quick enable/disable toggle.
- `assets/icons/` – Extension icons set (SVG sources & PNG formats).