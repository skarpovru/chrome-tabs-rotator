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
