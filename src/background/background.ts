import { RotationService } from './rotation.service';
import { safeRuntimeLastError } from '../shared';
import { ControlMessage } from '../shared/messages';
import { StorageKeys } from '../app/models';
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

// DEVELOPMENT DIAGNOSTIC INSTRUMENTATION
// Wrap chrome.runtime.sendMessage to capture stack traces when a lastError occurs.
// This helps trace lingering 'Could not establish connection' warnings.
// Remove or guard with build flag for production if desired.
try {
  const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  let uiActive = false; // toggled by handshake action
  (chrome.runtime as any).__uiActiveFlag = () => uiActive;
  (chrome.runtime as any).sendMessage = function wrappedDiagnosticSend(
    ...args: any[]
  ) {
    const stack = new Error().stack;
    const cbIndex = args.findIndex((a) => typeof a === 'function');
    const userCb = cbIndex >= 0 ? args[cbIndex] : undefined;
    const benignPatterns = [
      'Could not establish connection',
      'Receiving end does not exist',
      'The message port closed before a response was received'
    ];
    const now = Date.now();
    if (!(chrome.runtime as any).__diagLastWarn) (chrome.runtime as any).__diagLastWarn = 0;
    const wrappedCb = function (...cbArgs: any[]) {
      const err = (chrome as any)?.runtime?.lastError;
      if (err) {
        const msg = err.message || '';
        const benign = benignPatterns.some(p => msg.includes(p));
        if (!benign) {
          // Rate-limit non-benign warnings to avoid log flood
          if (now - (chrome.runtime as any).__diagLastWarn > 2000) {
            console.warn('[diag] runtime.sendMessage lastError (non-benign):', msg, '\nstack:', stack);
            (chrome.runtime as any).__diagLastWarn = now;
          }
        }
      }
      if (userCb) {
        try { userCb(...cbArgs); } catch (e) { console.error('[diag] user callback error', e); }
      }
    };
    if (cbIndex >= 0) {
      args[cbIndex] = wrappedCb;
    } else {
      args.push(wrappedCb);
    }
    try {
      return (originalSend as any).apply(chrome.runtime, args);
    } catch (e) {
      console.error('[diag] sendMessage threw synchronously:', e, '\nstack:', stack);
      throw e;
    }
  };
} catch {}

// Re-arm on install/start. If prior state says we were rotating, re-initialize in preservation mode
// so existing tabs (still open in the browser) are not closed.
async function attemptPreservedResume(context: 'onInstalled' | 'onStartup') {
  try {
    const stored = await (rotationService as any).storage.get(StorageKeys.RotationState);
    const wasRotating = !!stored?.rotationState?.isRotating || !!stored?.isRotating;
    if (wasRotating) {
      console.log(`[bg] ${context}: detected prior active rotation; preserving existing tabs.`);
      await (rotationService as any).initialize({ preserveExisting: true });
    } else {
      // Just reschedule any alarms without destructive reset.
      await rotationService.rescheduleIfNeeded();
    }
  } catch (e) {
    console.warn('[bg] preserved resume failed; falling back to reschedule', e);
    try { await rotationService.rescheduleIfNeeded(); } catch {}
  }
}

chrome.runtime.onInstalled.addListener(() => { attemptPreservedResume('onInstalled'); });
chrome.runtime.onStartup.addListener(() => { attemptPreservedResume('onStartup'); });

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
      console.error('[bg] Alarm handler error:', e, safeRuntimeLastError());
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
chrome.runtime.onMessage.addListener(
  (
    message: ControlMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): boolean => {
    console.log('[bg] Message:', message);

  // uiHello handshake: popup / diagnostics announces presence
  if ((message as any).action === 'uiHello') {
    (chrome.runtime as any).__uiActiveFlagInternal = true;
    (chrome.runtime as any).__uiActiveHandshakeAt = Date.now();
    sendResponse?.({ ok: true });
    return false; // synchronous
  }

  if (message.action === 'rotateTabs') {
    sendResponse({ ok: true, status: 'starting' });
    (async () => {
      try {
        if (!rotationService.isRotating) {
          await rotationService.initialize();
        } else {
          // Instead of ignoring, allow a preservation re-init request if client wants a refresh without tab closure.
          console.log('[bg] Already rotating; refreshing state with preservation');
          await (rotationService as any).initialize({ preserveExisting: true });
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
    return false; // synchronous
  }

  if (message.action === 'getDiagnostics') {
    (async () => {
      try {
        const diags = await rotationService.getDiagnostics();
        // Append debug flag value for UI convenience
        let debugFlag: boolean | undefined = undefined;
  try { debugFlag = await (rotationService as any).storage.get(StorageKeys.DebugActivationLogging); } catch {}
        sendResponse({ ok: true, diagnostics: { ...diags, debugActivationLogging: debugFlag } });
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

  if ((message as any).action === 'setDebugActivationLogging') {
    (async () => {
      try {
        const val = !!(message as any).value;
        await (rotationService as any).storage.set({ [StorageKeys.DebugActivationLogging]: val });
        sendResponse({ ok: true, value: val });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if ((message as any).action === 'clearActivationError') {
    (async () => {
      try {
        rotationService.clearActivationError();
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }

  if ((message as any).action === 'clearActivationHistory') {
    (async () => {
      try {
        await rotationService.clearActivationHistory();
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }

    sendResponse({ ok: false, error: `unknown action: ${(message as any)?.action}` });
    return false;
  }
);

export {};
