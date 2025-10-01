import { RotationService } from './rotation.service';
import { CustomHttpClient } from './custom-http-client.service';
import { ConfigValidatorService, ToolbarManagerService } from '../app/services';

const http = new CustomHttpClient();
const configValidator = new ConfigValidatorService();
const toolbarManagerService = new ToolbarManagerService();
const rotationService = new RotationService(
  http,
  configValidator,
  toolbarManagerService
);

// Re-arm on install/start
chrome.runtime.onInstalled.addListener(() =>
  rotationService.rescheduleIfNeeded()
);
chrome.runtime.onStartup.addListener(() =>
  rotationService.rescheduleIfNeeded()
);

// Alarms dispatcher
chrome.alarms.onAlarm.addListener((alarm) => {
  (async () => {
    try {
      if (alarm.name === 'rotate') {
        await rotationService.onRotateAlarm();
      } else if (alarm.name === 'configReload') {
        await rotationService.onConfigReloadAlarm();
      } else if (alarm.name === 'rotationWatchdog') {
        await rotationService.onWatchdogAlarm();
      } else if (alarm.name.startsWith('reload:')) {
        const id = Number(alarm.name.split(':')[1]);
        await rotationService.onReloadAlarm(id);
      } else {
        console.warn('[bg] Unknown alarm name received:', alarm.name);
      }
    } catch (e) {
      console.error('[bg] Alarm handler error:', e, chrome.runtime.lastError);
    }
  })();
});

if (chrome.webNavigation && chrome.webNavigation.onErrorOccurred) {
  chrome.webNavigation.onErrorOccurred.addListener((details) => {
    (async () => {
      try {
        await rotationService.onHandleError(details.tabId, details.url);
      } catch (e) {
        console.error('[bg] onErrorOccurred failed:', e);
      }
    })();
  });
}

if (chrome.webNavigation && chrome.webNavigation.onCompleted) {
  chrome.webNavigation.onCompleted.addListener((details) => {
    (async () => {
      try {
        await rotationService.onPageLoaded(details.tabId, details.url);
      } catch (e) {
        console.error('[bg] onCompleted failed:', e);
      }
    })();
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    (async () => {
      try {
        await rotationService.tryRemoveTabFromRotationOnClose(tabId);
      } catch (e) {
        console.error('[bg] onRemoved failed:', e);
      }
    })();
  });
}

// Messaging — early ack to avoid port timeout.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[bg] Message:', message);

  if (message.action === 'rotateTabs') {
    sendResponse({ ok: true, status: 'starting' });
    (async () => {
      try {
        if (!rotationService.isRotating) {
          await rotationService.initialize();
        } else {
          console.log('[bg] Already rotating');
        }
      } catch (e) {
        console.error('[bg] Failed to start rotation:', e);
      }
    })();
    return true;
  }

  if (message.action === 'stopRotation') {
    sendResponse({ ok: true, status: 'stopping' });
    (async () => {
      try {
        await rotationService.stopRotation();
      } catch (e) {
        console.error('[bg] Failed to stop rotation:', e);
      }
    })();
    return true;
  }

  if (message.action === 'getRotationState') {
    sendResponse({ ok: true, isRotating: rotationService.isRotating });
    return true;
  }

  if (message.action === 'getDiagnostics') {
    (async () => {
      try {
        const diags = await rotationService.getDiagnostics();
        sendResponse({ ok: true, diagnostics: diags });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (message.action === 'enforceInvariant') {
    (async () => {
      try {
        const diags = await rotationService.enforceNow();
        sendResponse({ ok: true, diagnostics: diags });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (message.action === 'forceRotateNow') {
    (async () => {
      try {
        const result = await rotationService.forceRotateNow();
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  sendResponse({ ok: false, error: `unknown action: ${message?.action}` });
  return true;
});

export {};
