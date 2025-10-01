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

## [1.4] - 2025-09-30

- Added optional "Prevent window focus" setting (avoid stealing OS focus while rotating)
- Added rotation watchdog self-heal (recovers if a rotate alarm is missed / stalled)
- Added diagnostics timestamps (last rotation time, next due time)
- Added "Force rotate" button in Diagnostics panel
- Added manual focus control logic to fullscreen start
