# Changelog

## [1.0] - 2024-08-28

- Initial release.

## [1.1] - 2024-10-07

- Immediately save imported configuration into the browser storage.
- Added "Allow access to file URLs" activation instruction.

## [1.2] - 2025-08-28

- Uses chrome.alarms for all scheduling (service-worker friendly)
- Persists currentIndex in storage so rotation survives worker sleep/restart
- Adds anti-spam guards to prevent runaway tab creation
- Added diagnostics UI
- Updated to Angular 20 and Tailwind CSS 4

## [1.3] - 2025-09-02

- Fixed the continuation of rotation after browser/computer restart.

## [1.4] - 2025-10-02

- Added optional "Prevent window focus" setting (avoid stealing OS focus while rotating)
- Added rotation watchdog self-heal (recovers if a rotate alarm is missed / stalled)
- Added diagnostics timestamps (last rotation time, next due time), per-attempt history, colored badge
- Added "Force rotate" button in Diagnostics panel
- Added manual focus control logic to fullscreen start
- Debug activation logging toggle + buttons to clear activation error & history

## [1.5] - 2025-10-08

- Fix: Extension could appear "started" after browser restart but no tabs/fullscreen until manual stop/start. Startup recovery now signals when a full reinitialization is required and auto-initializes.
- Fix: Rare runaway tab creation on reload alarms (continuous new tabs) caused by creating a fresh tab instead of reloading existing when only primary tab present. Reload alarm now reloads existing tab and only creates when both IDs missing.
- Diagnostics: Added debug log when auto reinitialization triggers after recovery.
- Improvement: Restart rebuild now matches surviving tabs by URL.
- Safety: Anti-spam / invariant enforcement only closes tabs explicitly created by the extension.

## [1.6] - 2025-10-20

- Improved crash/restart tab recovery robustness (grace + watchdog interplay tightened).
- Enforced the tabs order.
- Added comprehensive Playwright E2E test suite.
- Added transient storage failure resilience and large config scale scenarios.

## [1.7] - 2025-10-22

- Deferred reload: avoids reloading active tab until rotation switches away (unless only one tab).
- Real network errors (DNS, unreachable) now suspend failing tabs and skip them in rotation.
- Diagnostics UI and API expose deferred reload and network error info.
- Improved preload discard path: failed preload is removed & primary retained (unit + e2e coverage).
- Housekeeping: exposed suspension & readiness flags consistently; minor logging & stability improvements.
- Canonical URL pruning prevents duplicate failed tabs after browser restart (normalizes trailing slash / hash fragments).
- Startup recovery preserves rotation state object identity to avoid race causing false non-rotating condition.
- Dynamic preload wait with progressive timeout extensions (up to 3x) based on status progress (loading/unknown) for slow pages.
- Background-only preload promotion: avoids focus flicker by deferring activation unless old primary was active.
- Fallback activation on primary failure reverts to previous healthy tab without advancing rotation index.
- Enhanced error classification (cert, dns, timeout, generic network) stored in tab config for diagnostics.
- Exponential backoff & eventual disable for repeated preload creation failures (no-events threshold).
- Added E2E & unit tests covering duplicate pruning, deferred reload, network suspension, preload failure, retry vs suspension semantics.
