const { app, BrowserWindow, ipcMain, session, shell, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const { createRaClient } = require('./lib/ra-client');
const { BookingWorker } = require('./lib/booking-worker');
const fs = require('fs');

// M10: Auto-updater, analytics, and feature flags
const { autoUpdater } = require('electron-updater');
const { PostHog } = require('posthog-node');
const { machineIdSync } = require('node-machine-id');
const { publicConfig } = require('./lib/public-config');
const configPath = path.join(__dirname, app.isPackaged ? 'config.public.json' : 'config.js');
const config = publicConfig(fs.existsSync(configPath) ? require(configPath) : {});

// Configure auto-updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

// Initialize PostHog (analytics + server-side feature flags)
const posthog = new PostHog(config.posthog.apiKey, {
  host: config.posthog.host,
  flushAt: config.posthog.flushAt,
  flushInterval: config.posthog.flushInterval,

  // Remote evaluation uses the public project key; never ship a personal key.
});

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

// Cache feature flags – start with safe defaults from config
let featureFlags = { ...config.defaultFlags };

// Fetch feature flags using PostHog SDK (server-side evaluation)
async function fetchFeatureFlags() {
  try {
    console.log('Fetching feature flags via PostHog SDK for device:', deviceId);

    // Fetch evaluated flags using the public project key.
    const flagsFromPosthog = await posthog.getAllFlags(deviceId);
    console.log('Raw flags from PostHog SDK:', flagsFromPosthog);

    if (flagsFromPosthog && typeof flagsFromPosthog === 'object') {
      // Merge server-side flags over our defaults
      featureFlags = { ...config.defaultFlags, ...flagsFromPosthog };
      console.log('Effective feature flags:', featureFlags);
    } else {
      console.warn('PostHog returned no flags, using defaultFlags from config:', config.defaultFlags);
      featureFlags = { ...config.defaultFlags };
    }

    return featureFlags;
  } catch (err) {
    console.error('Could not fetch feature flags:', err);
    console.error('Error details:', err.message, err.stack);
    // Fail-open: if we can't fetch flags, use configured defaults
    featureFlags = { ...config.defaultFlags };
    console.log('Using default flags due to error:', featureFlags);
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

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
let raWebContents = null;
const LOG_LIMIT = 300;
let logEntries = [];
let logTimer = null;
function addLogEntry(entry) {
  logEntries.push({ ts: Date.now(), ...entry });
  if (logEntries.length > LOG_LIMIT) logEntries.splice(0, logEntries.length - LOG_LIMIT);
  if (!logTimer) logTimer = setTimeout(() => {
    logTimer = null;
    sendToRenderer('ra:logsUpdated', logEntries);
  }, 150);
}
const client = createRaClient(() => raWebContents);
const worker = new BookingWorker({
  client,
  onStatus(status) {
    sendToRenderer('ra:pollingStatus', status);
    addLogEntry({ source: 'booking', state: status.state, httpStatus: status.lastHttpStatus, requestCount: status.requestCount, inFlight: status.inFlight, firstRequestAtMs: status.firstRequestAtMs, burstStartAtMs: status.burstStartAtMs, message: status.lastMessage });
  },
  onSuccess() { sendToRenderer('ra:navigateToCart'); },
  keepAwake() {
    const id = powerSaveBlocker.start('prevent-app-suspension');
    return () => { if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id); };
  }
});
app.on('before-quit', () => worker.stop());

function contextSignature(ctx) {
  return `${ctx.url}|${ctx.facilityId}|${ctx.siteId}|${ctx.facilityName}|${ctx.location}|${ctx.siteName}|${ctx.status}`;
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
  if (webContents.isDestroyed() || webContents.getURL() !== url || !url.startsWith('https://www.reserveamerica.com/')) return null;
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
      if (webContents.isDestroyed() || webContents.getURL() !== url) return null;
      try {
        const labels = await webContents.mainFrame.executeJavaScript(extractLabelsInPage, false);
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false
    },
    title: 'Reservation Helper'
  });
  
  const win = mainWindow;
  win.on('closed', () => { mainWindow = null; worker.stop(); raWebContents = null; });

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
    raWebContents = webviewWebContents;
    webviewWebContents.setBackgroundThrottling(false);
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

    webviewWebContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) scheduleExtraction(url);
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

// The renderer receives status only, never credentials or raw cart/customer data.
ipcMain.handle('auth:probe', async () => {
  const result = await client.cart();
  const validCart = result.ok && Array.isArray(result.body?.contractViewList);
  return { ok: !!validCart, status: result.status, reason: result.reason || (result.status === 401 || result.status === 403 ? 'signed_out' : validCart ? 'connected' : 'connection_error'), error: result.error };
});
ipcMain.handle('ra:getContext', async () => {
  if (raWebContents && !raWebContents.isDestroyed()) await extractContext(raWebContents, raWebContents.getURL());
  return lastContext;
});
ipcMain.handle('ra:getPollingStatus', () => worker.status);
ipcMain.handle('ra:startPolling', (_event, formData) => {
  if (!featureFlags.booking_enabled) return { ok: false, error: 'Booking is temporarily disabled.' };
  const context = lastContext;
  if (!context?.facilityId || !context?.siteId) return { ok: false, error: 'Choose a campsite first.' };
  return worker.start({
    facilityId: context.facilityId, siteId: context.siteId,
    facilityName: context.facilityName, siteName: context.siteName,
    contractCode: context.url.match(/\/([A-Z]{2})\/\d+\//)?.[1],
    startDate: formData?.startDate, nights: formData?.nights,
    mode: formData?.mode, unlockAtMs: formData?.unlockAtMs || null, openingTimezone: formData?.openingTimezone
  });
});
ipcMain.handle('ra:resetPolling', () => worker.reset());
ipcMain.handle('ra:stopPolling', () => { worker.stop(); return { ok: true }; });
ipcMain.handle('ra:getLogs', () => logEntries);
ipcMain.handle('ra:clearLogs', () => { logEntries = []; sendToRenderer('ra:logsUpdated', []); return { ok: true }; });
ipcMain.handle('update:check', async () => {
  try { const result = await autoUpdater.checkForUpdates(); return { success: true, updateInfo: result?.updateInfo }; }
  catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
ipcMain.handle('flags:get', () => featureFlags);
function setupCookieWatcher() {
  let timer;
  session.defaultSession.cookies.on('changed', (_event, cookie) => {
    if (!/(^|\.)reserveamerica\.com$/.test(cookie.domain || '') || !['idToken', 'a1Data', 'ra2Refresh'].includes(cookie.name)) return;
    clearTimeout(timer);
    timer = setTimeout(() => sendToRenderer('cookieChanged', { name: cookie.name }), 500);
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
    if (app.isPackaged) {
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



