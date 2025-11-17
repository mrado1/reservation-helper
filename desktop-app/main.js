// Load environment variables from .env file
require('dotenv').config();

const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const path = require('path');
const { setTimeout: delay } = require('timers/promises');
const fs = require('fs');

// M10: Auto-updater, analytics, and feature flags
const { autoUpdater } = require('electron-updater');
const { PostHog } = require('posthog-node');
const { machineIdSync } = require('node-machine-id');
const config = require('./config');

// Configure auto-updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

// Initialize PostHog
const posthog = new PostHog(
  config.posthog.apiKey,
  { 
    host: config.posthog.host,
    flushAt: config.posthog.flushAt,
    flushInterval: config.posthog.flushInterval
  }
);

// Get anonymous machine ID
let deviceId;
try {
  deviceId = machineIdSync({ original: true });
} catch (err) {
  console.error('Could not get machine ID:', err);
  deviceId = `unknown-${Date.now()}`;
}

// Helper function to track events
function trackEvent(eventName, properties = {}) {
  try {
    posthog.capture({
      distinctId: deviceId,
      event: eventName,
      properties: {
        ...properties,
        app_version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Analytics error:', err);
    // Fail silently - don't break app if analytics fails
  }
}

// Cache feature flags
let featureFlags = {
  app_enabled: true,
  booking_enabled: true,
  countdown_enabled: true
};

// Fetch feature flags using Personal API Key
async function fetchFeatureFlags() {
  try {
    console.log('Fetching feature flags for device:', deviceId);
    
    // Use Personal API Key for feature flag evaluation
    const response = await fetch(`${config.posthog.host}/decide/?v=3`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.posthog.personalApiKey}`
      },
      body: JSON.stringify({
        api_key: config.posthog.apiKey,
        distinct_id: deviceId
      })
    });
    
    if (!response.ok) {
      throw new Error(`PostHog API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Raw response from PostHog:', data);
    
    if (data.featureFlags) {
      featureFlags = { ...featureFlags, ...data.featureFlags };
      console.log('Feature flags loaded successfully:', featureFlags);
    } else {
      console.warn('No feature flags in response:', data);
    }
    
    return featureFlags;
  } catch (err) {
    console.error('Could not fetch feature flags:', err);
    console.error('Error details:', err.message, err.stack);
    // Fail-open: if we can't fetch flags, assume enabled
    return featureFlags;
  }
}

// Check if app is enabled
async function checkAppEnabled() {
  const flags = await fetchFeatureFlags();
  
  if (!flags.app_enabled) {
    const message = flags.message || 
      'Reservation Helper is temporarily unavailable. Please check back later or contact support.';
    
    dialog.showErrorBox('App Unavailable', message);
    return false;
  }
  
  return true;
}

// Ensure events are flushed on app quit
app.on('before-quit', async () => {
  await posthog.shutdown();
});

// ─────────────────────────────────────────────────────────────────────────────
// Window reference
// ─────────────────────────────────────────────────────────────────────────────
let mainWindow = null;

// ─────────────────────────────────────────────────────────────────────────────
// Context extraction state
// ─────────────────────────────────────────────────────────────────────────────
let lastContext = null;
let lastContextSignature = '';

// ─────────────────────────────────────────────────────────────────────────────
// Polling worker state (M5 + M7)
// ─────────────────────────────────────────────────────────────────────────────
let pollingState = 'idle'; // idle | polling | success | stopped | error
let pollingConfig = null;
let pollingStartTime = 0;
let requestCount = 0;
let inFlightCount = 0;
let stopRequested = false;
let pollingInterval = null;
let lastPollingStatusSignature = '';
let lastCartItemsCount = 0; // Track cart items for success confirmation
let pollingSuccessConfirmed = false; // Once true, ignore later polling errors

// M7: Throttle state
let throttleState = {
  consecutive000s: 0,
  consecutive429s: 0,
  isPaused: false
};

// M7: Failure state
let failureState = {
  consecutiveFailures: 0
};

// M9: In-memory log buffer for renderer Logs tab
// Increased for developer-style request/response logging
const LOG_LIMIT = 1000;
let logEntries = [];

function addLogEntry(entry) {
  try {
    const enriched = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: Date.now(),
      source: entry.source || 'system',
      kind: entry.kind || '',
      state: entry.state || '',
      httpStatus: entry.httpStatus ?? null,
      message: (entry.message || '').toString()
    };
    logEntries.push(enriched);
    if (logEntries.length > LOG_LIMIT) {
      logEntries = logEntries.slice(logEntries.length - LOG_LIMIT);
    }
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send('ra:logsUpdated', logEntries);
    });
  } catch (err) {
    console.error('[Logs] Failed to record log entry:', err.message);
  }
}

// M7: Settings (defaults - now fixed, no front-end override)
let pollingSettings = {
  cadenceMs: 10,              // 10ms between ticks
  maxConcurrent: 100,         // cap at ~100 in-flight requests
  maxDurationMs: 5 * 60 * 1000, // 5 minutes
  throttlePauseMin: 1000,     // 1s min pause
  throttlePauseMax: 2000,     // 2s max pause
  throttleThreshold: 10,      // reduce concurrency after 10 consecutive
  failureWarningThreshold: 20 // warn after 20 consecutive failures
};

function contextSignature(ctx) {
  return `${ctx.facilityId}|${ctx.siteId}|${ctx.facilityName}|${ctx.location}|${ctx.siteName}|${ctx.status}`;
}

/**
 * Parse facilityId and siteId from RA URL
 * Example: https://www.reserveamerica.com/explore/glen-island-lake-george-is/NY/140/245719/campsite-booking?arrivalDate=2026-05-17&lengthOfStay=1
 * Pattern: /STATE/FACILITY_ID/SITE_ID/campsite-booking
 */
function parseIdsFromUrl(url) {
  try {
    const match = url.match(/\/([A-Z]{2})\/(\d+)\/(\d+)\/campsite-booking/i);
    if (match) {
      return { facilityId: match[2], siteId: match[3] };
    }
  } catch {}
  return { facilityId: '', siteId: '' };
}

/**
 * Extract context labels from the page DOM (executed in the webview context)
 */
const extractLabelsInPage = `
(function() {
  const trySel = (selectors) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          return el.textContent.trim().slice(0, 200);
        }
      } catch {}
    }
    return '';
  };

  const facilityName = trySel([
    'h1[data-qa="facility-title"]',
    'h1',
    '[data-qa="facility-name"]',
    '.facility-name',
    'h1.facility-title'
  ]);

  const location = trySel([
    '[data-qa="facility-location"]',
    '.facility-location',
    'nav[aria-label="breadcrumb"] li:last-child',
    '.breadcrumb li:last-child',
    '.subtitle'
  ]);

  const siteName = trySel([
    '[data-qa="site-name"]',
    'h2[data-qa="site-title"]',
    '.site-name',
    '.campsite-details h2',
    'h2'
  ]);

  return { facilityName, location, siteName };
})();
`;

/**
 * Two-phase context extraction:
 * 1. Parse IDs from URL (instant)
 * 2. Enrich with DOM labels (best-effort with retry)
 */
async function extractContext(webContents, url) {
  const { facilityId, siteId } = parseIdsFromUrl(url);
  
  // Phase 1: URL-based IDs
  let ctx = {
    url,
    facilityId,
    siteId,
    facilityName: '',
    location: '',
    siteName: '',
    status: facilityId && siteId ? 'partial' : 'unknown'
  };

  // Broadcast partial immediately if we have IDs
  if (facilityId && siteId) {
    broadcastContext(ctx);
  }

  // Phase 2: DOM enrichment with bounded retry
  if (facilityId && siteId) {
    const delays = [100, 300, 800];
    for (const delayMs of delays) {
      await new Promise(r => setTimeout(r, delayMs));
      try {
        const labels = await webContents.executeJavaScript(extractLabelsInPage, false);
        if (labels && (labels.facilityName || labels.location || labels.siteName)) {
          ctx.facilityName = labels.facilityName || '';
          ctx.location = labels.location || '';
          ctx.siteName = labels.siteName || '';
          ctx.status = 'complete';
          broadcastContext(ctx);
          return ctx;
        }
      } catch (err) {
        console.error('[extractContext] DOM enrichment error:', err.message);
      }
    }
    // After retries, still partial
    ctx.status = 'partial';
    broadcastContext(ctx);
  } else {
    // No IDs found
    ctx.status = 'unknown';
    broadcastContext(ctx);
  }

  return ctx;
}

function broadcastContext(ctx) {
  const sig = contextSignature(ctx);
  if (sig === lastContextSignature) return; // dedup
  lastContextSignature = sig;
  lastContext = ctx;
  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('ra:context', ctx);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling worker functions
// ─────────────────────────────────────────────────────────────────────────────

function pollingStatusSignature(status) {
  return `${status.state}|${status.lastHttpStatus}|${status.lastMessage}`;
}

function broadcastPollingStatus(status) {
  // Once we've reached a SUCCESS state, ignore any later non-success updates
  if (pollingState === 'success' && status.state !== 'success') {
    return;
  }
  // M7: Include maxDurationMs for status display
  const enrichedStatus = {
    ...status,
    maxDurationMs: pollingConfig?.maxDurationMs || 300000
  };
  
  const sig = pollingStatusSignature(enrichedStatus);
  if (sig === lastPollingStatusSignature) return; // dedup
  lastPollingStatusSignature = sig;
  // Record log entry for logs tab
  addLogEntry({
    source: 'polling',
    state: enrichedStatus.state,
    httpStatus: enrichedStatus.lastHttpStatus,
    message: enrichedStatus.serverMessage || enrichedStatus.lastMessage || enrichedStatus.state
  });
  
  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('ra:pollingStatus', enrichedStatus);
  });
}

// Navigate webview to cart
function navigateWebviewToCart() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  try {
    // Send IPC to renderer to navigate the webview
    mainWindow.webContents.send('ra:navigateToCart');
    console.log('[Cart] Sent navigation command to renderer');
  } catch (err) {
    console.error('[Cart] Navigation failed:', err.message);
  }
}

async function sendAddToCartRequest() {
  inFlightCount++;
  requestCount++;
  const currentRequestId = requestCount;

  // Match exact payload structure from working bash script
  const payload = {
    contractCode: pollingConfig.contractCode || 'NY',
    facilityID: pollingConfig.facilityId,
    siteID: pollingConfig.siteId,
    arrivalDate: pollingConfig.arrivalDate,
    units: pollingConfig.nights,
    quantity: 1,
    primaryItemID: null,
    primaryResNum: null
  };

  console.log(`[Polling] Request ${currentRequestId}:`, payload);
  // M9+: Log every polling request for power users
  addLogEntry({
    source: 'polling',
    kind: 'request',
    message: `Request #${currentRequestId} additem ${payload.arrivalDate} · nights=${payload.units} · facility=${payload.facilityID} · site=${payload.siteID}`
  });

  let status = 0;
  let body = null;
  let bodyText = '';
  let errorForLog = null;

  try {
    // Use exact RA API endpoint from working bash script
    // Headers MUST match bash script exactly - RA API is very picky
    const response = await fetch('https://api.reserveamerica.com/jaxrs-json/shoppingcart/0/additem', {
      method: 'POST',
      headers: {
        'a1data': pollingConfig.a1Data,
        'accept': 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'authorization': pollingConfig.idToken,
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        'origin': 'https://www.reserveamerica.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://www.reserveamerica.com/',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload)
    });
    
    status = response.status;
    body = {};
    try {
      bodyText = await response.text();
      if (bodyText) {
        body = JSON.parse(bodyText);
      }
    } catch (err) {
      console.log(`[Polling] Response ${requestCount}: Failed to parse body:`, bodyText);
    }
    
    console.log(`[Polling] Response ${currentRequestId}: HTTP ${status}`, body);
    if (status === 400) {
      console.log(`[Polling] 400 Error Details - Raw body:`, bodyText);
      console.log(`[Polling] 400 Error Details - Payload sent:`, JSON.stringify(payload));
      console.log(`[Polling] 400 Error Details - Auth token length:`, pollingConfig.idToken.length);
      console.log(`[Polling] 400 Error Details - a1Data length:`, pollingConfig.a1Data.length);
    }

    // Normal flow continues below; status/body are used for response logging and state transitions.
    // M7: Reset throttle/failure counters on success
    if (status === 200) {
      throttleState.consecutive000s = 0;
      throttleState.consecutive429s = 0;
      failureState.consecutiveFailures = 0;
    }
    
    // Success detection (HTTP 200 + cart confirmation)
    if (status === 200 && body.success !== false) {
      console.log('[Polling] Got 200 response, confirming via cart...');
      
      // Fetch cart to confirm item was actually added
      try {
        const cookies = await session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
        const idToken = cookies.find(c => c.name === 'idToken')?.value || '';
        let a1Data = cookies.find(c => c.name === 'a1Data')?.value || '';
        
        if (a1Data.startsWith('%7B')) {
          a1Data = decodeURIComponent(a1Data);
        }
        
        const cartResponse = await fetch('https://api.reserveamerica.com/jaxrs-json/shoppingcart/0', {
          method: 'GET',
          headers: {
            'authorization': idToken,
            'a1data': a1Data,
            'accept': 'application/json',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/json',
            'origin': 'https://www.reserveamerica.com',
            'referer': 'https://www.reserveamerica.com/',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
          }
        });
        
        const cartBody = await cartResponse.json();
        console.log('[Polling] Cart confirmation:', {
          itemsCount: cartBody.itemsCount,
          lastChanges: cartBody.lastChanges
        });
        
        // Confirm item was added via itemsCount increase or lastChanges.addedItems
        const itemAdded = (cartBody.itemsCount > lastCartItemsCount) || 
                         (cartBody.lastChanges?.addedItems?.length > 0);
        
        if (itemAdded) {
          pollingSuccessConfirmed = true;
          console.log('[Polling] SUCCESS CONFIRMED via cart!');
          stopPollingWorker();
          pollingState = 'success';
          
          // M10: Track booking success
          trackEvent('booking_success', {
            facility_id: pollingConfig.facilityID,
            site_id: pollingConfig.siteID,
            nights: pollingConfig.units,
            request_count: requestCount,
            elapsed_ms: Date.now() - pollingStartTime
          });
          
          broadcastPollingStatus({
            state: 'success',
            requestCount,
            elapsedMs: Date.now() - pollingStartTime,
            lastHttpStatus: status,
            lastMessage: 'Success! Item added to cart.',
            lastUpdated: Date.now()
          });
          
          // Navigate to cart
          navigateWebviewToCart();
          return;
        } else {
          console.warn('[Polling] Got 200 but cart did not update - continuing polling');
        }
      } catch (cartErr) {
        console.error('[Polling] Cart confirmation failed:', cartErr.message);
        // Continue polling if cart check fails
      }
    }

    // If we've already confirmed a success in another request, ignore any later results
    if (pollingSuccessConfirmed) {
      return;
    }
    
    // M7: HTTP 429 (Rate Limited) - pause and resume, don't stop
    if (status === 429) {
      throttleState.consecutive429s++;
      
      const pauseMs = Math.random() * (pollingSettings.throttlePauseMax - pollingSettings.throttlePauseMin) + pollingSettings.throttlePauseMin;
      console.log(`[Polling] HTTP 429 - pausing ${Math.round(pauseMs)}ms (${throttleState.consecutive429s}/${pollingSettings.throttleThreshold})`);
      
      broadcastPollingStatus({
        state: 'polling',
        requestCount,
        elapsedMs: Date.now() - pollingStartTime,
        lastHttpStatus: status,
        lastMessage: `Rate limited: pausing ${Math.round(pauseMs / 1000)}s seconds...`,
        lastUpdated: Date.now()
      });
      
      // Pause, then check if we need to reduce concurrency
      await new Promise(resolve => setTimeout(resolve, pauseMs));
      
      if (throttleState.consecutive429s >= pollingSettings.throttleThreshold) {
        if (pollingConfig.maxConcurrent > 1) {
          pollingConfig.maxConcurrent--;
          console.log(`[Polling] Reducing concurrency to ${pollingConfig.maxConcurrent} due to persistent rate limiting`);
          broadcastPollingStatus({
            state: 'polling',
            requestCount,
            elapsedMs: Date.now() - pollingStartTime,
            lastMessage: `Reduced concurrency to ${pollingConfig.maxConcurrent} due to persistent rate limiting.`,
            lastUpdated: Date.now()
          });
          throttleState.consecutive429s = 0; // Reset after reduction
        }
      }
      
      return; // Continue polling
    }
    
    // Terminal errors (auth)
    if (status === 401 || status === 403) {
      stopPollingWorker();
      pollingState = 'error';
      
      // M10: Track booking error
      trackEvent('booking_error', {
        facility_id: pollingConfig.facilityID,
        site_id: pollingConfig.siteID,
        error_type: 'auth_error',
        http_status: status,
        error_message: `Authentication failed (HTTP ${status})`
      });
      
      broadcastPollingStatus({
        state: 'error',
        requestCount,
        elapsedMs: Date.now() - pollingStartTime,
        lastHttpStatus: status,
        lastMessage: 'Auth error: invalid or expired session',
        lastUpdated: Date.now()
      });
      return;
    }
    
    // Check specific error codes in faults array (417 responses)
    if (status === 417 && body.faults && body.faults.length > 0) {
      const fault = body.faults[0];
      const serverMessage = fault.defaultMessage || fault.messageTemplate || body.message || `Unknown error from Reserve America (HTTP ${status})`;
      
      // Time-gated error (9-month rule or "try again at X time") - should use Queue mode instead
      const isTooEarly = fault.msgKey === 'R1-V-100017.error' || 
                         fault.msgKey === 'R6-V-100013.error' ||
                         /within 9 Month/i.test(fault.defaultMessage || '') ||
                         /cannot be reserved at this time/i.test(fault.defaultMessage || '') ||
                         /try again later at/i.test(fault.defaultMessage || '');
      
      if (isTooEarly) {
        stopPollingWorker();
        pollingState = 'error';
        broadcastPollingStatus({
          state: 'error',
          requestCount,
          elapsedMs: Date.now() - pollingStartTime,
          lastHttpStatus: status,
          lastMessage: 'Too early: use "Queue Cart" to schedule auto-start at 08:59:55.',
          serverMessage,
          lastUpdated: Date.now()
        });
        return;
      }
      
      // Inventory not available (already reserved) - STOP IMMEDIATELY
      if (fault.msgKey === 'inventory.exception') {
        stopPollingWorker();
        pollingState = 'error';
        broadcastPollingStatus({
          state: 'error',
          requestCount,
          elapsedMs: Date.now() - pollingStartTime,
          lastHttpStatus: status,
          lastMessage: 'Already reserved: One or more of the Dates not available.',
          serverMessage,
          lastUpdated: Date.now()
        });
        return;
      }
      
      // Overlapping reservations (user already has a reservation for these dates)
      if (fault.msgKey === 'R12-V-100007.error' || /Maximum number of overlapping/i.test(fault.defaultMessage || '')) {
        console.log('[Polling] Overlapping reservation fault detected - verifying via cart...');

        try {
          const cookies = await session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
          const idToken = cookies.find(c => c.name === 'idToken')?.value || '';
          let a1Data = cookies.find(c => c.name === 'a1Data')?.value || '';

          if (a1Data.startsWith('%7B')) {
            a1Data = decodeURIComponent(a1Data);
          }

          const cartResponse = await fetch('https://api.reserveamerica.com/jaxrs-json/shoppingcart/0', {
            method: 'GET',
            headers: {
              'authorization': idToken,
              'a1data': a1Data,
              'accept': 'application/json',
              'accept-language': 'en-US,en;q=0.9',
              'content-type': 'application/json',
              'origin': 'https://www.reserveamerica.com',
              'referer': 'https://www.reserveamerica.com/',
              'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
            }
          });

          const cartBody = await cartResponse.json();
          console.log('[Polling] Cart verification after overlapping fault:', {
            itemsCount: cartBody.itemsCount,
            lastChanges: cartBody.lastChanges
          });

          const itemAdded = (cartBody.itemsCount > lastCartItemsCount) ||
                           (cartBody.lastChanges?.addedItems?.length > 0);

          if (itemAdded) {
            pollingSuccessConfirmed = true;
            console.log('[Polling] OVERLAP VERIFIED AS SUCCESS via cart');
            stopPollingWorker();
            pollingState = 'success';
            
            // M10: Track booking success
            trackEvent('booking_success', {
              facility_id: pollingConfig.facilityID,
              site_id: pollingConfig.siteID,
              nights: pollingConfig.units,
              request_count: requestCount,
              elapsed_ms: Date.now() - pollingStartTime
            });
            
            broadcastPollingStatus({
              state: 'success',
              requestCount,
              elapsedMs: Date.now() - pollingStartTime,
              lastHttpStatus: status,
              lastMessage: 'Success! Reservation already present in cart.',
              serverMessage,
              lastUpdated: Date.now()
            });

            navigateWebviewToCart();
            return;
          }
        } catch (verifyErr) {
          console.error('[Polling] Cart verification after overlap failed:', verifyErr.message);
          // Fall through to error handling below if verification fails
        }

        // If cart verification did not show the item, treat as a real overlapping error
        stopPollingWorker();
        pollingState = 'error';
        broadcastPollingStatus({
          state: 'error',
          requestCount,
          elapsedMs: Date.now() - pollingStartTime,
          lastHttpStatus: status,
          lastMessage: 'Overlapping reservation: You already have a reservation for these dates.',
          serverMessage,
          lastUpdated: Date.now()
        });
        return;
      }
      
      // Other 417 errors - catch-all with server message
      stopPollingWorker();
      pollingState = 'error';
      broadcastPollingStatus({
        state: 'error',
        requestCount,
        elapsedMs: Date.now() - pollingStartTime,
        lastHttpStatus: status,
        lastMessage: 'Validation error from Reserve America.',
        serverMessage,
        lastUpdated: Date.now()
      });
      return;
    }
    
    // Terminal errors (inventory unavailable - fallback check)
    if (status === 409 || (body.message && /unavailable|sold out|not available/i.test(body.message))) {
      const serverMessage = body.message || `Inventory not available (HTTP ${status})`;
      stopPollingWorker();
      pollingState = 'error';
      broadcastPollingStatus({
        state: 'error',
        requestCount,
        elapsedMs: Date.now() - pollingStartTime,
        lastHttpStatus: status,
        lastMessage: 'Already reserved: Inventory not available.',
        serverMessage,
        lastUpdated: Date.now()
      });
      return;
    }
    
    // M7: Other failures (exclude 000/429, count separately)
    // Only increment for non-throttle errors
    if (status !== 429 && status !== 0) {
      failureState.consecutiveFailures++;
      
      if (failureState.consecutiveFailures >= pollingSettings.failureWarningThreshold) {
        broadcastPollingStatus({
          state: 'polling',
          requestCount,
          elapsedMs: Date.now() - pollingStartTime,
          lastHttpStatus: status,
          lastMessage: `${failureState.consecutiveFailures}+ failures: consider checking cookies/site.`,
          lastUpdated: Date.now()
        });
      } else {
        broadcastPollingStatus({
          state: 'polling',
          requestCount,
          elapsedMs: Date.now() - pollingStartTime,
          lastHttpStatus: status,
          lastMessage: body.message || `HTTP ${status}`,
          lastUpdated: Date.now()
        });
      }
    }
    
  } catch (err) {
    console.error('[Polling] Request error:', err.message);
    errorForLog = err;
    
    // M7: HTTP 000 (Network throttle) - pause and resume, don't stop
    if (err.cause?.code === 'ECONNREFUSED' || err.message.includes('fetch failed')) {
      throttleState.consecutive000s++;
      
      const pauseMs = Math.random() * (pollingSettings.throttlePauseMax - pollingSettings.throttlePauseMin) + pollingSettings.throttlePauseMin;
      console.log(`[Polling] HTTP 000 - pausing ${Math.round(pauseMs)}ms (${throttleState.consecutive000s}/${pollingSettings.throttleThreshold})`);
      
      broadcastPollingStatus({
        state: 'polling',
        requestCount,
        elapsedMs: Date.now() - pollingStartTime,
        lastHttpStatus: 0,
        lastMessage: `Network throttle: pausing ${Math.round(pauseMs / 1000)}s seconds...`,
        lastUpdated: Date.now()
      });
      
      // Pause, then check if we need to reduce concurrency
      await new Promise(resolve => setTimeout(resolve, pauseMs));
      
      if (throttleState.consecutive000s >= pollingSettings.throttleThreshold) {
        if (pollingConfig.maxConcurrent > 1) {
          pollingConfig.maxConcurrent--;
          console.log(`[Polling] Reducing concurrency to ${pollingConfig.maxConcurrent} due to persistent network throttling`);
          broadcastPollingStatus({
            state: 'polling',
            requestCount,
            elapsedMs: Date.now() - pollingStartTime,
            lastMessage: `Reduced concurrency to ${pollingConfig.maxConcurrent} due to persistent throttling.`,
            lastUpdated: Date.now()
          });
          throttleState.consecutive000s = 0; // Reset after reduction
        }
      }
      
      return; // Continue polling
    }
    
    // Other errors, continue polling
    broadcastPollingStatus({
      state: 'polling',
      requestCount,
      elapsedMs: Date.now() - pollingStartTime,
      lastMessage: `Error: ${err.message}`,
      lastUpdated: Date.now()
    });
  } finally {
    // M9+: Log every polling response (or error) from a single place
    try {
      if (errorForLog) {
        addLogEntry({
          source: 'polling',
          kind: 'response',
          httpStatus: 0,
          message: `Response #${currentRequestId} ERROR — ${errorForLog.message || String(errorForLog)}`
        });
      } else {
        let serverMessage = '';
        const fault = body?.faults?.[0];
        if (fault) {
          serverMessage =
            fault.defaultMessage ||
            fault.messageTemplate ||
            (body && body.message) ||
            '';
        } else if (body) {
          serverMessage = body.message || '';
        } else if (bodyText) {
          serverMessage = bodyText.slice(0, 200);
        }
        const baseMessage = serverMessage || `HTTP ${status}`;
        addLogEntry({
          source: 'polling',
          kind: 'response',
          httpStatus: status,
          message: `Response #${currentRequestId} HTTP ${status}${baseMessage ? ` — ${baseMessage}` : ''}`
        });
      }
    } catch (logErr) {
      console.error('[Polling] Failed to log response:', logErr.message);
    }

    inFlightCount--;
  }
}

async function runPollingTick() {
  // Check stop conditions
  if (stopRequested) {
    stopPollingWorker();
    return;
  }
  
  const elapsed = Date.now() - pollingStartTime;
  if (elapsed > pollingConfig.maxDurationMs) {
    stopPollingWorker();
    broadcastPollingStatus({
      state: 'stopped',
      requestCount,
      elapsedMs: elapsed,
      lastMessage: 'Polling stopped: max duration (5 min) reached',
      lastUpdated: Date.now()
    });
    return;
  }
  
  // Respect concurrency limit
  if (inFlightCount >= pollingConfig.maxConcurrent) {
    return; // Wait for slots to free up
  }
  
  // Send request(s) up to concurrency limit
  const slotsAvailable = pollingConfig.maxConcurrent - inFlightCount;
  for (let i = 0; i < slotsAvailable; i++) {
    sendAddToCartRequest();
  }
}

async function startPollingWorker() {
  pollingState = 'polling';
  pollingStartTime = Date.now();
  requestCount = 0;
  inFlightCount = 0;
  stopRequested = false;
  pollingSuccessConfirmed = false;
  
  // M7: Reset throttle/failure state for new session
  throttleState = {
    consecutive000s: 0,
    consecutive429s: 0,
    isPaused: false
  };
  failureState = {
    consecutiveFailures: 0
  };
  
  console.log('[Polling] Starting worker with config:', pollingConfig);
  
  // Snapshot current cart before starting (for success detection)
  try {
    const cookies = await session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
    const idToken = cookies.find(c => c.name === 'idToken')?.value || '';
    let a1Data = cookies.find(c => c.name === 'a1Data')?.value || '';
    
    if (a1Data.startsWith('%7B')) {
      a1Data = decodeURIComponent(a1Data);
    }
    
    const cartResponse = await fetch('https://api.reserveamerica.com/jaxrs-json/shoppingcart/0', {
      method: 'GET',
      headers: {
        'authorization': idToken,
        'a1data': a1Data,
        'accept': 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/json',
        'origin': 'https://www.reserveamerica.com',
        'referer': 'https://www.reserveamerica.com/',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
      }
    });
    
    const cartBody = await cartResponse.json();
    lastCartItemsCount = cartBody.itemsCount || 0;
    console.log('[Polling] Initial cart itemsCount:', lastCartItemsCount);
  } catch (err) {
    console.warn('[Polling] Could not snapshot cart, assuming 0 items:', err.message);
    lastCartItemsCount = 0;
  }
  
  broadcastPollingStatus({
    state: 'polling',
    requestCount: 0,
    elapsedMs: 0,
    lastMessage: 'Starting polling...',
    lastUpdated: Date.now()
  });
  
  // Start polling loop
  pollingInterval = setInterval(() => {
    runPollingTick();
  }, pollingConfig.cadenceMs);
}

function stopPollingWorker() {
  stopRequested = true;
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  
  // M7: Reset throttle/failure state
  throttleState = {
    consecutive000s: 0,
    consecutive429s: 0,
    isPaused: false
  };
  failureState = {
    consecutiveFailures: 0
  };
  
  if (pollingState === 'polling') {
    pollingState = 'stopped';
    broadcastPollingStatus({
      state: 'stopped',
      requestCount,
      elapsedMs: Date.now() - pollingStartTime,
      lastMessage: 'Polling stopped by user',
      lastUpdated: Date.now()
    });
  }
  
  console.log('[Polling] Worker stopped');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      webviewTag: true
    },
    title: 'Reservation Helper'
  });
  
  const win = mainWindow;

  // Open our renderer UI
  win.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Block external new windows; open in system browser instead
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?reserveamerica\.com\//i.test(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Listen for webview attach and wire context extraction
  win.webContents.on('did-attach-webview', (_event, webviewWebContents) => {
    let debounceTimer = null;
    const scheduleExtraction = (url) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        extractContext(webviewWebContents, url).catch(err => {
          console.error('[scheduleExtraction] error:', err.message);
        });
      }, 150);
    };

    webviewWebContents.on('did-navigate', (_e, url) => {
      scheduleExtraction(url);
    });

    webviewWebContents.on('did-navigate-in-page', (_e, url) => {
      scheduleExtraction(url);
    });

    webviewWebContents.on('dom-ready', () => {
      const url = webviewWebContents.getURL();
      scheduleExtraction(url);
    });

    // Handle new-window events from webview - keep RA links in same window
    webviewWebContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/(www\.)?reserveamerica\.com\//i.test(url)) {
        // Navigate in same webview instead of opening new window
        webviewWebContents.loadURL(url);
        return { action: 'deny' };
      }
      // Open external URLs in system browser
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  // Optional: remove menu for cleanliness
  win.setMenuBarVisibility(false);

  // Hot reload for development (watches renderer files)
  if (process.env.NODE_ENV !== 'production') {
    const rendererDir = path.join(__dirname, 'renderer');
    let reloadTimeout = null;
    
    const scheduleReload = () => {
      clearTimeout(reloadTimeout);
      reloadTimeout = setTimeout(() => {
        console.log('[Hot Reload] Reloading renderer...');
        win.webContents.reload();
      }, 100);
    };

    try {
      // Watch renderer files for hot reload
      fs.watch(rendererDir, { recursive: true }, (eventType, filename) => {
        if (filename && (filename.endsWith('.html') || filename.endsWith('.js') || filename.endsWith('.css'))) {
          console.log(`[Hot Reload] Detected change in ${filename}`);
          scheduleReload();
        }
      });
      console.log('[Hot Reload] Watching renderer directory for changes...');

      // Watch main process files (main.js, preload.js) - notify to restart
      const mainFiles = ['main.js', 'preload.js'];
      const lastAlerts = {};
      mainFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        try {
          fs.watch(filePath, () => {
            // Debounce alerts (only show once per 5 seconds to avoid spam)
            const now = Date.now();
            if (!lastAlerts[file] || now - lastAlerts[file] > 5000) {
              lastAlerts[file] = now;
              console.log(`\n[Hot Reload] ${file} changed - please restart the app (Ctrl+C and npm start)\n`);
            }
          });
        } catch {}
      });
    } catch (err) {
      console.warn('[Hot Reload] Could not set up file watcher:', err.message);
    }
  }
}

// IPC: get cookies
ipcMain.handle('getCookies', async () => {
  const cookies = await session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
  const idToken = cookies.find(c => c.name === 'idToken')?.value || '';
  const a1Data = cookies.find(c => c.name === 'a1Data')?.value || '';
  return { idToken, a1Data };
});

// IPC: get current context
ipcMain.handle('ra:getContext', async () => {
  return lastContext || {
    url: '',
    facilityId: '',
    siteId: '',
    facilityName: '',
    location: '',
    siteName: '',
    status: 'unknown'
  };
});

// IPC: live auth probe (checks if current cookies are accepted by RA API)
ipcMain.handle('auth:probe', async () => {
  try {
    const cookies = await session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
    const idToken = cookies.find(c => c.name === 'idToken')?.value || '';
    let a1Data = cookies.find(c => c.name === 'a1Data')?.value || '';
    if (!idToken || !a1Data) {
      return { ok: false, status: 0, reason: 'missing_cookies' };
    }
    // Normalize a1Data: RA often stores this URL-encoded; decode for API calls
    try {
      const looksEncoded = /%7B/i.test(a1Data) || /%7D/i.test(a1Data);
      if (looksEncoded) {
        a1Data = decodeURIComponent(a1Data);
      }
    } catch {}
    // Use AbortController to bound the probe time
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      // Mirror key browser headers; RA is sensitive to missing origin/referer/UA
      res = await fetch('https://api.reserveamerica.com/jaxrs-json/shoppingcart/0', {
        method: 'GET',
        headers: {
          authorization: idToken,
          a1data: a1Data,
          accept: 'application/json',
          'accept-language': 'en-US,en;q=0.9',
          'content-type': 'application/json',
          origin: 'https://www.reserveamerica.com',
          referer: 'https://www.reserveamerica.com/',
          // A reasonable desktop Chrome UA
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(t);
    }
    const status = res?.status ?? 0;
    const ok = status === 200;
    return { ok, status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) };
  }
});

// IPC: start polling
ipcMain.handle('ra:startPolling', async (event, formData) => {
  // M10: Check if booking is enabled
  await fetchFeatureFlags();
  if (!featureFlags.booking_enabled) {
    return { ok: false, error: 'Booking is temporarily disabled. Please try again later.' };
  }
  
  if (pollingState === 'polling') {
    return { ok: false, error: 'Already polling' };
  }
  
  // Validate we have required data
  const cookies = await session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
  const idToken = cookies.find(c => c.name === 'idToken')?.value || '';
  let a1Data = cookies.find(c => c.name === 'a1Data')?.value || '';
  
  if (!idToken || !a1Data) {
    return { ok: false, error: 'Missing auth cookies' };
  }
  
  if (!lastContext || !lastContext.facilityId || !lastContext.siteId) {
    return { ok: false, error: 'Missing context (facilityId/siteId)' };
  }
  
  if (!formData || !formData.startDate || !formData.nights) {
    return { ok: false, error: 'Missing form data (startDate/nights)' };
  }
  
  // M10: Track booking started
  trackEvent('booking_started', {
    facility_id: lastContext.facilityId,
    site_id: lastContext.siteId,
    nights: formData.nights,
    booking_mode: formData.mode || 'add'
  });
  
  // Normalize a1Data: decode if URL-encoded (starts with %7B...%7D)
  try {
    const looksEncoded = /%7B/i.test(a1Data) || /%7D/i.test(a1Data);
    if (looksEncoded) {
      a1Data = decodeURIComponent(a1Data);
    }
  } catch {}
  
  // Derive contractCode from current URL if possible (e.g., .../NY/140/...)
  let contractCode = 'NY';
  try {
    const url = lastContext?.url || '';
    const m = url.match(/\/([A-Z]{2})\/\d+\//);
    if (m && m[1]) {
      contractCode = m[1];
    }
  } catch {}
  
  // M7: Set up polling config using pollingSettings
  pollingConfig = {
    facilityId: lastContext.facilityId,
    siteId: lastContext.siteId,
    arrivalDate: formData.startDate, // Should be ISO format "2026-05-17"
    nights: formData.nights,
    idToken,
    a1Data,
    contractCode,
    cadenceMs: pollingSettings.cadenceMs,
    maxConcurrent: pollingSettings.maxConcurrent,
    maxDurationMs: pollingSettings.maxDurationMs
  };
  
  await startPollingWorker();
  return { ok: true };
});

// IPC: stop polling
ipcMain.handle('ra:stopPolling', async (event) => {
  stopPollingWorker();
  return { ok: true };
});

// IPC: probe additem (preflight check for queue mode)
ipcMain.handle('ra:probeAddItem', async (event, formData) => {
  try {
    const cookies = await session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
    const idToken = cookies.find(c => c.name === 'idToken')?.value || '';
    let a1Data = cookies.find(c => c.name === 'a1Data')?.value || '';
    
    if (!idToken || !a1Data) {
      return { ok: false, status: 0, error: 'Missing auth cookies' };
    }
    
    if (!lastContext || !lastContext.facilityId || !lastContext.siteId) {
      return { ok: false, status: 0, error: 'Missing context' };
    }
    
    // URL-decode a1Data if needed
    if (a1Data.startsWith('%7B')) {
      a1Data = decodeURIComponent(a1Data);
    }
    
    // Extract contractCode from URL if available
    const urlMatch = lastContext.url?.match(/\/([A-Z]{2})\/\d+\//);
    const contractCode = urlMatch ? urlMatch[1] : 'NY';
    
    const payload = {
      contractCode,
      facilityID: lastContext.facilityId,
      siteID: lastContext.siteId,
      arrivalDate: formData.startDate,
      units: formData.nights,
      quantity: 1,
      primaryItemID: null,
      primaryResNum: null
    };
    
    console.log('[Probe] Sending probe request:', payload);
    
    const response = await fetch('https://api.reserveamerica.com/jaxrs-json/shoppingcart/0/additem', {
      method: 'POST',
      headers: {
        'a1data': a1Data,
        'accept': 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'authorization': idToken,
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        'origin': 'https://www.reserveamerica.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://www.reserveamerica.com/',
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload)
    });
    
    const status = response.status;
    let body = {};
    try {
      const text = await response.text();
      if (text) body = JSON.parse(text);
    } catch {}
    
    console.log('[Probe] Response:', status, body);
    // Log probe response
    let serverMessage = '';
    const fault = body?.faults?.[0];
    if (fault) {
      serverMessage = fault.defaultMessage || fault.messageTemplate || body.message || '';
    } else {
      serverMessage = body.message || '';
    }
    addLogEntry({
      source: 'probe',
      kind: 'response',
      httpStatus: status,
      message: serverMessage || `HTTP ${status}`
    });
    
    return { ok: true, status, body };
  } catch (err) {
    console.error('[Probe] Error:', err.message);
    addLogEntry({
      source: 'probe',
      kind: 'error',
      message: `Probe error: ${err.message}`
    });
    return { ok: false, status: 0, error: err.message };
  }
});

// IPC: expose logs to renderer
ipcMain.handle('ra:getLogs', async () => {
  return logEntries;
});

// IPC: clear logs buffer
ipcMain.handle('ra:clearLogs', async () => {
  logEntries = [];
  BrowserWindow.getAllWindows().forEach((w) => {
    try {
      w.webContents.send('ra:logsUpdated', logEntries);
    } catch {}
  });
  return { ok: true };
});

// M10: IPC handlers for auto-updates and feature flags
ipcMain.handle('update:check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result.updateInfo };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('flags:get', async () => {
  await fetchFeatureFlags();
  return featureFlags;
});

// IPC: get shopping cart
ipcMain.handle('ra:getCart', async (event) => {
  try {
    const cookies = await session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
    const idToken = cookies.find(c => c.name === 'idToken')?.value || '';
    let a1Data = cookies.find(c => c.name === 'a1Data')?.value || '';
    
    if (!idToken || !a1Data) {
      return { ok: false, status: 0, error: 'Missing auth cookies' };
    }
    
    // URL-decode a1Data if needed
    if (a1Data.startsWith('%7B')) {
      a1Data = decodeURIComponent(a1Data);
    }
    
    const response = await fetch('https://api.reserveamerica.com/jaxrs-json/shoppingcart/0', {
      method: 'GET',
      headers: {
        'authorization': idToken,
        'a1data': a1Data,
        'accept': 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/json',
        'origin': 'https://www.reserveamerica.com',
        'referer': 'https://www.reserveamerica.com/',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
      }
    });
    
    const status = response.status;
    let body = {};
    try {
      const text = await response.text();
      if (text) body = JSON.parse(text);
    } catch {}
    
    return { ok: true, status, body };
  } catch (err) {
    console.error('[Cart] Error:', err.message);
    return { ok: false, status: 0, error: err.message };
  }
});

// Broadcast cookie changes
function setupCookieWatcher() {
  session.defaultSession.cookies.on('changed', (_event, cookie) => {
    try {
      const isRA = (cookie.domain || '').includes('reserveamerica.com');
      if (!isRA) return;
      if (cookie.name !== 'idToken' && cookie.name !== 'a1Data') return;
      const payload = { name: cookie.name, value: cookie.value || '' };
      BrowserWindow.getAllWindows().forEach(w => {
        w.webContents.send('cookieChanged', payload);
      });
    } catch {}
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// M10: Auto-Updater Events
// ─────────────────────────────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  
  // Notify renderer process
  if (mainWindow) {
    mainWindow.webContents.send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate
    });
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('App is up to date:', info.version);
});

autoUpdater.on('error', (err) => {
  console.error('Update error:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`Download progress: ${progressObj.percent}%`);
  
  // Notify renderer process
  if (mainWindow) {
    mainWindow.webContents.send('update:progress', {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
  
  // Show dialog to user
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: 'A new version has been downloaded.',
    detail: 'The app will restart to install the update.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1
  }).then((result) => {
    if (result.response === 0) {
      // User clicked "Restart Now"
      autoUpdater.quitAndInstall(false, true);
    }
  });
});

app.whenReady().then(async () => {
  // Set app name for menu (overrides package.json name)
  app.setName('Reservation Helper');
  
  // M10: Track app launch
  trackEvent('app_launched');
  
  // M10: Check if app is enabled via feature flags
  const enabled = await checkAppEnabled();
  if (!enabled) {
    app.quit();
    return;
  }
  
  setupCookieWatcher();
  createWindow();
  
  // M10: Check for updates after window is created (wait 3 seconds)
  setTimeout(() => {
    if (!config.isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  }, 3000);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});



