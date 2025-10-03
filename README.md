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
    - [TypeScript Project Layout (Multi-Config)](#typescript-project-layout-multi-config)
  - [Changelog](#changelog)
  - [Support](#support)
  - [Architecture](#architecture)
    - [Core Services (all under `src/background/` unless noted)](#core-services-all-under-srcbackground-unless-noted)
    - [Health \& Badge System](#health--badge-system)
    - [Restart \& Recovery Improvements](#restart--recovery-improvements)
    - [Diagnostics Extensions](#diagnostics-extensions)
    - [Rationale / Guiding Principles](#rationale--guiding-principles)
    - [Rotation Flow](#rotation-flow)
    - [Tab Invariant Enforcement](#tab-invariant-enforcement)
    - [Focus Behavior](#focus-behavior)
    - [Extending Further](#extending-further)
    - [Metrics \& Streaming Diagnostics](#metrics--streaming-diagnostics)
    - [Storage Caching Layer](#storage-caching-layer)

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
- **Activation diagnostics & health badge** (history, last success age, color-coded badge)
- **Debug activation logging toggle** (enable deep rotation logging only when you need it)

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
  "pages": [{ "url": "https://example.com/dashboard", "delaySeconds": 20, "reloadIntervalSeconds": 300 }],
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
  The watchdog typically restarts it automatically. Open Diagnostics to confirm timestamps. Use **Force rotate** if needed. Supports activation history + badge color to help spot issues.

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

### TypeScript Project Layout (Multi-Config)

The repository uses a _multi-tsconfig_ layout to isolate concerns and remove accidental Chrome ambient types from Node / test contexts:

- `tsconfig.base.json` – Shared compiler defaults (no implicit chrome types).
- `tsconfig.app.json` – Angular UI build (extends base). Does **not** include chrome types unless UI code needs them.
- `tsconfig.background.json` – Service worker / background scripts; adds `types: ["chrome-types"]` so the global namespace is available only here.
- `tsconfig.harness.json` – Node harness for logic testing; only `node` types by default (can add a stub or `chrome` if needed).
- Root `tsconfig.json` – Project references orchestrator so VS Code understands all sub-projects.

Benefits:

- Faster, clearer editor IntelliSense (each file maps to an appropriate project).
- Prevents leaking global `chrome` namespace into harness/tests accidentally.
- Easier future migration or update when Chrome APIs change (using `chrome-types`).

If you add a new background file under `src/background/`, it is automatically picked up by `tsconfig.background.json`. For UI-only shared models, keep them in `src/app/models/` so both app and background can import without pulling in Angular-specific code.

> If you later need Chrome APIs in the UI (rare), add `"types": ["chrome-types"]` (or a minimal stub) to `tsconfig.app.json`.

---

## Changelog

For the full change log, open this file: [Changelog](CHANGELOG.md).

---

## Support

- Found a bug or have a feature request? Open an issue: <https://github.com/skarpovru/chrome-tabs-rotator/issues>

If you enjoy the project, a ⭐ on GitHub helps others find it!

---

## Architecture

The extension is built as a Manifest V3 (service worker) + Angular UI hybrid. Modularized rotation logic into focused services to improve maintainability, testability, and observability.

### Core Services (all under `src/background/` unless noted)

- `rotation.service.ts` – Thin coordinator (start/stop, delegations, high-level flow).
- `config.service.ts` – Local + remote configuration loading & periodic refresh.
- `rotation-scheduler.service.ts` – Computes/schedules next rotation alarm; starts countdown; updates health timing.
- `activation.service.ts` – Resilient tab activation + diagnostics + focus orchestration hooks.
- `rotation-watchdog.service.ts` – Missed-alarm / stall watchdog; triggers enforced rebuild + forced rotation.
- `startup-recovery.service.ts` – Rehydrates state & alarms after MV3 service worker restart.
- `rotation-state.facade.ts` – Canonical rotation state mutation (index advance, normalization, persistence, toolbar sync).
- `rotation-state.repository.ts` – Persistence adapter for rotation state.
- `tab-manager.service.ts` – Tab creation/tracking (primary + preloaded), allowed ID set, metrics logging.
- `tab-lifecycle.service.ts` – Preload strategy + reload alarm handling + initial load wait.
- `invariant-rebuilder.service.ts` – Idempotent rebuild & pruning of orphan/duplicate tabs.
- `stall-guard.service.ts` – Stall heuristics (overdue rotation, cyclic last-page) and recovery signaling.
- `health-monitor.service.ts` – Tracks timing & stall inputs → severity + badge color.
- `countdown.service.ts` – Badge countdown timer overlay.
- `activation-diagnostics.service.ts` – Activation attempt ring buffer & last success/error.
- `focus-orchestrator.service.ts` – Fullscreen + optional focus suppression.
- `focus.service.ts` – Low-level window focus attempt wrapper.
- `scheduler.service.ts` – Low-level Chrome alarm helpers.
- `diagnostics.service.ts` – Aggregates snapshot (tabs, timing, health, stalls, activation).
- `metrics.service.ts` – Counter tracking + runtime broadcast.
- `storage.service.ts` – Promise API + small TTL cache over `chrome.storage.local`.

`rotation.service.ts` deliberately stays thin; logic with its own state or heuristics lives in a dedicated service for clarity and testability.

### Health & Badge System

Badge color summarizes overall rotation health, not just the last activation:

- Inputs: timing (next due vs now), stalls, activation failure density, any recent success.
- Severity: normal → warn (overdue or stall) → error (persistent failures / multiple stalls / no success yet).
- Colors: green / amber / red; countdown time remains but is overridden by degraded severity.

### Restart & Recovery Improvements

- Rebuild is idempotent: only runs if `tabsConfig` absent (typical after MV3 worker restart) – avoids unnecessary tab enumeration.
- Placeholder handling: missing tab IDs are lazily recreated on demand during rotation, preventing deadlocks at a single index.
- Watchdog self‑heal: detects overdue rotations, triggers fast rebuild + invariant enforcement, and forces a near‑term rotate alarm.
- Invariant enforcement centralized so stale / orphaned tabs are pruned without duplicating logic in rotation flow & watchdog.

### Diagnostics Extensions

Diagnostics payload now includes:

- `severity` & `badgeColor` (composite health view)
- Activation history (recent attempts) & last activation success age
- Stall metadata (count, reason, timestamps)
- Normalized tracked vs. allowed tab IDs for spotting leaks

This richer snapshot enables a UI to present immediate actionable state without recomputing heuristics.

### Rationale / Guiding Principles

1. **Single Responsibility** – Each new service does one thing (preload/reload, focus, health, rebuild) → easier isolated tests.
2. **Crash/Restart Resilience** – Service worker wakeups should not require reinitializing or duplicating logic; rebuild + invariant layers guarantee a safe baseline.
3. **Observability First** – All critical transitions (activation attempt, stall, rotation schedule) feed diagnostics or metrics quickly, supporting live panels.
4. **Minimal Global State** – Persistent state limited to `RotationState` + derived indexes; everything else is recomputable or ephemeral.

Supporting models live in `src/app/models/` and remain framework-agnostic so they can be safely imported from the background service worker context.

### Rotation Flow

1. User clicks Start → `RotationService.initialize()` loads config, clears stale alarms, resets state.
2. Tabs are created through `TabManagerService` (first tab active, others preloaded as needed).
3. Each rotation cycle schedules the next alarm (`rotate`) based on the current page’s `delaySeconds`.
4. On each alarm, `RotationService.rotateTabs()` activates the next tab (or swaps in a preloaded nextTab) and records timing.
5. `StallGuardService` evaluates post-rotation and watchdog ticks; if a stall is detected, it triggers a controlled reset.
6. `DiagnosticsService` composes real‑time status for the UI (Force Rotate, Enforce Now, etc.).

### Tab Invariant Enforcement

To avoid “tab spam,” only up to 2 tabs per configured page (active + preloaded) are allowed. Extras (e.g. from restarts or failed preloads) are pruned during rotation and watchdog ticks. Ordering of tracked IDs is normalized so rebuilds correctly map page indices.

### Focus Behavior

When `preventWindowFocus` is enabled, focus attempts are intentionally suppressed but still logged for diagnostics transparency. Fullscreen entry respects the setting (fullscreen without re‑focusing).

### Extending Further

Potential next modular slices:

- Persistence layer abstraction for storage calls
- Metrics/event bus for streaming diagnostics updates
- Optional in-memory cache layer atop StorageService for high-frequency reads

This architecture aims to keep `RotationService` as a thin coordinator while enabling isolated unit tests around logic-heavy concerns (tab lifecycle, stall detection, diagnostics shaping).

### Metrics & Streaming Diagnostics

A lightweight `MetricsService` tracks counters:

- `rotations`
- `stalls`
- `focusAttempts`
- `tabCreations`
- `reloadsScheduled`

Each mutation emits a runtime message `{ kind: 'metrics', event: { type, counters, at } }` consumed by the diagnostics panel via a `chrome.runtime.onMessage` listener. This removes the need for high‑frequency polling; the panel still supports manual/interval refresh for full snapshots while the top bar of live counters updates instantly.

### Storage Caching Layer

`StorageService` now includes an optional, very small TTL (default 5s) in‑memory cache to reduce repetitive `chrome.storage.local.get` calls for hot keys (`rotationState`, configs, flags). The cache auto‑invalidates on `set` / `remove`. TTL is intentionally conservative to avoid stale UI while still smoothing bursty access patterns from rotation + diagnostics requests.

If stricter consistency is required, the TTL can be set to `0` when constructing `StorageService` to disable caching.
