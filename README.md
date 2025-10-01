# Tabs Rotator / Slideshow

A lightweight Chrome/Chromium extension that cycles through a list of URLs in separate tabs like a slideshow — perfect for dashboards, monitoring screens, TVs, info-kiosks, digital signage, reports, presentations, and more.

---

## Table of Contents

- [Tabs Rotator / Slideshow](#tabs-rotator--slideshow)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Quick Start](#quick-start)
  - [Usage](#usage)
    - [Local Configuration](#local-configuration)
    - [Remote Configuration (Auto-Update)](#remote-configuration-auto-update)
    - [Page Options](#page-options)
    - [OS Autostart (Windows)](#os-autostart-windows)
  - [Configuration Examples](#configuration-examples)
    - [Local / Inline](#local--inline)
    - [Remote (host this JSON and point the extension to it)](#remote-host-this-json-and-point-the-extension-to-it)
  - [Advanced Settings](#advanced-settings)
  - [Tips \& Troubleshooting](#tips--troubleshooting)
  - [Privacy \& Permissions](#privacy--permissions)
  - [Development](#development)
  - [Changelog](#changelog)
  - [Support](#support)

---

## Features

- Rotate through web pages from the Internet **or local files** (`file://` links).
- Per-page **display time** and **auto-reload** interval.
- Manage configuration directly in the extension UI or use **import/export**.
- **Remote configuration URL** with automatic periodic updates (host JSON anywhere).
- Built-in **retry** and **temporary skip** for failing pages.
- **Persistence across browser restarts** without tab spam.
- **Offline-friendly:** keeps the last good version if a page update fails.
- Optional **Prevent window focus** mode (keeps Chrome in background while rotating)
- **Rotation watchdog self-heal** (recovers if a rotate alarm is missed)
- **Diagnostics panel** with live state, timestamps & force actions
- One-click **Force rotate now** button for manual advancement

Screenshots:

![Local Configuration](screenshots/local_configuration.png)
![Remote Configuration](screenshots/remote_configuration.png)

---

## Quick Start

1. Install the extension (Chrome/Edge/Brave supported).
2. Open the extension by clicking on it’s icon, then set **Local Configuration** or choose **Remote Config** (sample <https://api.jsonsilo.com/public/e683a7af-7366-4db0-94fe-3438c9f64092>).
3. Add your pages (URLs) with a display time and optional reload interval.
4. **Start rotating** (open the rotator and press Start). Press F11 to go fullscreen or set **Start in Fullscreen Mode** in configuration.
5. To stop rotation, first exit from the full screen mode by pressing **F11**, then click on the extension icon and click Stop.

> **Local files?** In `chrome://extensions/` → _Tabs Rotator_ → enable **Allow access to file URLs** to use `file://` links.

---

## Usage

### Local Configuration

Configure pages directly inside the extension UI. You can **export** to JSON and **import** later or on another device.

### Remote Configuration (Auto-Update)

Host a JSON file (JSON Silo, n:point, Pantry, S3, GitHub Pages, Gist, etc.) and paste its URL in the options. The extension fetches it on a schedule and applies updates without reinstalling.

- **Configuration URL**: HTTPS or `file://` is supported.
- **Reload Interval (minutes)**: Set to `0` to disable periodic refresh of the remote file.

A small public example is here:  
[tabs-rotator-config.json](https://api.jsonsilo.com/public/e683a7af-7366-4db0-94fe-3438c9f64092)

### Page Options

| Name             | Description                                                        | JSON Key                | Type   |
| ---------------- | ------------------------------------------------------------------ | ----------------------- | ------ |
| **URL**          | The page to display. `https://…` or `file://…`.                    | `url`                   | String |
| **Display Time** | Time **in seconds** the page stays visible before switching.       | `delaySeconds`          | Number |
| **Reload After** | Page reload interval **in seconds**. Use `0` to disable reloading. | `reloadIntervalSeconds` | Number |

### OS Autostart (Windows)

For automatic startup of Chrome on sign-in, follow the short guide:
[Windows Autostart (Chrome) — Windows 10/11](windows-autostart.md).

---

## Configuration Examples

### Local / Inline

```json
{
  "pages": [
    {
      "url": "https://status.example.com",
      "delaySeconds": 20,
      "reloadIntervalSeconds": 60
    },
    {
      "url": "file:///C:/dashboards/report.html",
      "delaySeconds": 15,
      "reloadIntervalSeconds": 0
    },
    {
      "url": "https://grafana.example.com/d/sales",
      "delaySeconds": 30,
      "reloadIntervalSeconds": 3600
    }
  ],
  "isFullscreen": true,
  "preventWindowFocus": true
}
```

### Remote (host this JSON and point the extension to it)

```json
{
  "pages": [
    { "url": "https://example.com/one", "delaySeconds": 15, "reloadIntervalSeconds": 0 },
    { "url": "https://example.com/two", "delaySeconds": 20, "reloadIntervalSeconds": 120 }
  ],
  "isFullscreen": true,
  "preventWindowFocus": false
}
```

---

## Advanced Settings

These optional controls help tune behavior for signage / unattended scenarios:

- **Prevent window focus** (`preventWindowFocus`): When enabled, tab rotation won’t bring the Chrome window to the foreground. Useful if you’re using the machine for something else while a dashboard rotates in the background (e.g. on a secondary display).
- **Start in Fullscreen Mode** (`isFullscreen`): Automatically requests fullscreen (F11 equivalent) after tabs are created.
- **Remote Reload Interval**: Defines how often (in minutes) the remote JSON config is re-fetched. Set to `0` to disable automatic refresh but still perform an initial load.
- **Force rotate (Diagnostics)**: Manually advances to the next page immediately; handy for testing or if you just updated a page.
- **Watchdog Self-Heal**: Internal mechanism that restarts rotation if the scheduled alarm was missed (no UI toggle; always on).

Minimal example with advanced keys:

```jsonc
{
  "pages": [
    { "url": "https://example.com/dashboard", "delaySeconds": 20, "reloadIntervalSeconds": 300 }
  ],
  "isFullscreen": false,
  "preventWindowFocus": true
}
```

---

## Tips & Troubleshooting

- **Local files don’t load (`file://`)**  
  Enable **Allow access to file URLs** for the extension under `chrome://extensions/`.

- **Some sites log out after a while**  
  Use the site’s "keep alive"/auto-refresh, increase per-page `reloadIntervalSeconds`, or keep a logged-in session.

- **A page fails to load**  
  The rotator will retry and temporarily skip failing pages. Check DevTools (_F12_) → _Console_ for errors.

- **Fullscreen / Kiosk**  
  Set "Start in Fullscreen Mode" in configuration. For signage, consider Chrome’s kiosk mode or an OS auto-start to open the browser and extension on boot.

- **Tabs keep multiplying**  
  The extension persists state across restarts and prevents tab spam and removes all opened tabs on stop. If something seems off, stop rotation, close tabs, and start again.
  
- **Need to advance immediately**  
  Open Diagnostics → click **Force rotate** to move to the next page instantly.

- **Rotation stalled / stopped at last tab**  
  The watchdog typically restarts it automatically. Open Diagnostics to confirm timestamps. Use **Force rotate** if needed.

---

## Privacy & Permissions

- Uses only the minimal permissions necessary to open/rotate tabs and store your settings locally.
- No analytics, tracking, or external calls **unless you opt-in** by configuring a **Remote Configuration URL**.
- Remote configs are fetched read-only; the extension never writes data back to remote services.

---

## Development

Requirements: **Node.js ≥ 18**, **npm** and **yarn**.

1. Install dependencies

   ```sh
   yarn
   ```

2. Build the extension (produces a clean `dist/` and a zip bundle)

   ```sh
   yarn build
   ```

3. Run in watch mode for local development

   ```sh
   yarn start
   ```

4. Load the unpacked extension

   - Open `chrome://extensions/`
   - Enable **Developer mode** (top-right)
   - Click **Load unpacked** and choose the **subfolder inside `dist/`** created by the build

> Tip: If you change background or options code, the service worker may need a manual reload in `chrome://extensions/` during development.

---

## Changelog

For the full change log, open this file: [Changelog](CHANGELOG.md).

---

## Support

- Found a bug or have a feature request? Open an issue: <https://github.com/skarpovru/chrome-tabs-rotator/issues>

If you enjoy the project, a ⭐ on GitHub helps others find it!
