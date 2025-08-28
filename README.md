# Tabs Rotator / Slideshow

## Overview

Tabs Rotator automatically loads web pages from configured URLs in the new tabs and displays them as a slideshow. It is useful for displaying dashboards, monitoring tools, presentations, advertisements, reports, marketing, or any other web pages that need to be cycled through regularly on a screen.

## Features

- Switch between tabs with web pages from the Internet or on your local PC using `file://` links.
- Set display time and reload interval for each URL.
- Manage configuration in the extension with import and export support.
- Load configuration from a remote URL with automatic updates. You can use a free online JSON storage (e.g. JSON Silo, n:point, Pantry).
- Automatically retries loading links if errors occur and skips failed pages until they are available again.
- It continues to work after the browser restarts and prevents tab spamming.
- Offline support. Keeps the previous page version if the page update fails.

## Screenshots

![Local Configuration](screenshots/local_configuration.png)
![Remote Configuration](screenshots/remote_configuration.png)

## Page Configuration Options

| Name         | Description                                                                                                   | JSON Option           | Type   |
| ------------ | ------------------------------------------------------------------------------------------------------------- | --------------------- | ------ |
| URL          | The link to the page to display. Can be remote (starting with `https://`) or local (starting with `file://`). | url                   | String |
| Display Time | The time in seconds that the page is displayed.                                                               | delaySeconds          | Number |
| Reload After | Page reload interval in seconds. If set to `0`, the page will not reload.                                     | reloadIntervalSeconds | Number |

## Remote Configuration Options

| Name              | Description                                                                                            | Type   |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| Configuration URL | URL to fetch the configuration from.                                                                   | String |
| Reload Interval   | Interval in minutes for reloading the configuration. If set to `0`, the configuration will not reload. | Number |

## Configuration Sample

[tabs-rotator-config.json](https://api.jsonsilo.com/public/e683a7af-7366-4db0-94fe-3438c9f64092)

## Support

If you find a bug, please create an issue on GitHub [chrome-tabs-rotator](https://github.com/skarpovru/chrome-tabs-rotator).

---

## Development

To develop the extension locally, follow these steps:

1. Install Dependencies (requires Node.js v18 or higher, npm, and yarn):

   ```sh
   yarn
   ```

2. Build and Zip the Extension:

   ```sh
   yarn build
   ```

   This command will clean out the `dist` directory, build the project, and package the result into a zip file for distribution.

3. Start the Development Server:

   ```sh
   yarn start
   ```

   This command will watch for changes and rebuild the project automatically.

4. Load the Extension in Chrome:

   - Open Chrome and navigate to [`chrome://extensions/`](chrome://extensions/).
   - Enable "Developer mode" using the toggle switch in the top right corner.
   - Click "Load unpacked" and select the project subfolder in the `dist` directory.
