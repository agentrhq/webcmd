/**
 * Webcmd Chrome Extension - Background Service Worker (Manifest V3)
 * Manages connection health to the local Webcmd API server (http://127.0.0.1:9777),
 * handles badge indicators, and relays commands between the UI and active tabs.
 */

const API_BASE_DEFAULT = 'http://127.0.0.1:9777';

async function getApiBase() {
  const data = await chrome.storage.local.get(['apiBase']);
  return data.apiBase || API_BASE_DEFAULT;
}

// Update extension icon badge with connection status
async function checkEngineStatus() {
  const apiBase = await getApiBase();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${apiBase}/api/status`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Vibrant emerald green
      chrome.action.setTitle({ title: `Webcmd Connected (${data.workflowsCount || 0} workflows)` });
      return { online: true, data };
    }
  } catch (err) {
    // Engine offline
  }

  chrome.action.setBadgeText({ text: 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#64748b' }); // Muted slate gray
  chrome.action.setTitle({ title: 'Webcmd Engine Offline (Run: webcmd serve)' });
  return { online: false };
}

// Check status on startup and on alarm
chrome.runtime.onInstalled.addListener(() => {
  checkEngineStatus();
  chrome.alarms.create('checkStatusAlarm', { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkStatusAlarm') {
    checkEngineStatus();
  }
});

// Relay messages from popup / content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    const apiBase = await getApiBase();

    if (request.type === 'PING_ENGINE') {
      const status = await checkEngineStatus();
      return sendResponse(status);
    }

    if (request.type === 'API_REQUEST') {
      const { endpoint, method = 'GET', body = null } = request;
      try {
        const options = {
          method,
          headers: { 'Content-Type': 'application/json' }
        };
        if (body) options.body = JSON.stringify(body);

        const res = await fetch(`${apiBase}${endpoint}`, options);
        const json = await res.json();
        sendResponse({ success: res.ok, status: res.status, data: json });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.type === 'TRIGGER_INSPECT') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'DRAW_OVERLAYS' }, (response) => {
          sendResponse(response || { success: true });
        });
      } else {
        sendResponse({ success: false, error: 'No active tab found' });
      }
      return;
    }

    if (request.type === 'CLEAR_INSPECT') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'REMOVE_OVERLAYS' }, (response) => {
          sendResponse(response || { success: true });
        });
      } else {
        sendResponse({ success: false, error: 'No active tab found' });
      }
      return;
    }
  })();

  return true; // Keep message channel open for async response
});
