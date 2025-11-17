# M10 Technical Implementation Guide

## Overview
This document provides detailed technical implementation instructions for M10 features: auto-updates, analytics, and feature flags.

## Table of Contents
1. [Auto-Updates with electron-updater](#auto-updates)
2. [Analytics with PostHog](#analytics)
3. [Feature Flags with PostHog](#feature-flags)
4. [Repository Migration](#repository-migration)
5. [Testing & Validation](#testing)

---

## 1. Auto-Updates with electron-updater {#auto-updates}

### Installation

```bash
cd desktop-app
npm install electron-updater
```

### Configuration

#### Update `package.json`

Add publish configuration:

```json
{
  "name": "reservation-helper",
  "version": "0.2.0",
  "build": {
    "appId": "com.campingthing.reservationhelper",
    "productName": "Reservation Helper",
  "publish": {
    "provider": "github",
    "owner": "mrado1",
    "repo": "reservation-helper",
    "private": true,
    "releaseType": "release"
  },
    "mac": {
      "category": "public.app-category.utilities",
      "icon": "build/icon.icns",
      "target": ["dmg", "zip"]
    },
    "win": {
      "icon": "build/icon.ico",
      "target": ["nsis"]
    }
  },
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder",
    "dist:mac": "electron-builder --mac",
    "dist:win": "electron-builder --win",
    "publish": "electron-builder --publish always"
  }
}
```

### Implementation in `main.js`

Add at the top of the file:

```javascript
const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

// Configure auto-updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Log for debugging
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';
```

Add update event handlers before `app.on('ready')`:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// Auto-Updater Events
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
      autoUpdater.quitAndInstall();
    }
  });
});
```

Add check for updates in `app.on('ready')`:

```javascript
app.on('ready', async () => {
  createWindow();
  
  // Check for updates after window is created
  // Wait 3 seconds to let app fully load
  setTimeout(() => {
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  }, 3000);
});
```

Add IPC handler for manual update check:

```javascript
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
```

### Implementation in `preload.js`

Add update APIs:

```javascript
contextBridge.exposeInMainWorld('ra', {
  // ... existing APIs ...
  
  // Update APIs
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update:available', (_, data) => callback(data)),
  onUpdateProgress: (callback) => ipcRenderer.on('update:progress', (_, data) => callback(data)),
});
```

### Implementation in `renderer.js`

Add update UI handlers:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// Auto-Update UI
// ─────────────────────────────────────────────────────────────────────────────

let updateBannerEl = null;

// Listen for update available
window.ra.onUpdateAvailable((data) => {
  showUpdateBanner(`Version ${data.version} is available`, 'download');
});

// Listen for download progress
window.ra.onUpdateProgress((data) => {
  if (updateBannerEl) {
    updateBannerEl.querySelector('.update-message').textContent = 
      `Downloading update... ${Math.round(data.percent)}%`;
  }
});

function showUpdateBanner(message, type = 'info') {
  // Remove existing banner
  if (updateBannerEl) {
    updateBannerEl.remove();
  }
  
  // Create banner
  updateBannerEl = document.createElement('div');
  updateBannerEl.className = 'fixed top-0 left-0 right-0 bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between z-50';
  updateBannerEl.innerHTML = `
    <div class="flex items-center gap-2">
      <svg class="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span class="update-message text-xs text-blue-900">${message}</span>
    </div>
    <button class="update-dismiss text-xs text-blue-600 hover:text-blue-800 font-medium">Dismiss</button>
  `;
  
  document.body.prepend(updateBannerEl);
  
  // Add dismiss handler
  updateBannerEl.querySelector('.update-dismiss').addEventListener('click', () => {
    updateBannerEl.remove();
    updateBannerEl = null;
  });
}
```

### Publishing Updates

#### Setup GitHub Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate new token (classic) with `repo` scope
3. Copy the token

Set environment variable:

```bash
# macOS/Linux
export GH_TOKEN="your_github_token_here"

# Windows
set GH_TOKEN=your_github_token_here
```

Or add to `~/.zshrc` / `~/.bash_profile`:

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
```

#### Publish Release

```bash
# Bump version in package.json first
npm version patch  # or minor, or major

# Build and publish
npm run publish
```

This will:
1. Build for all platforms
2. Create a GitHub Release with the version tag
3. Upload DMG, ZIP, EXE files
4. Generate `latest.yml` and `latest-mac.yml` for auto-updater

---

## 2. Analytics with PostHog {#analytics}

### Installation

```bash
cd desktop-app
npm install posthog-node node-machine-id
```

### Setup PostHog Account

1. Go to https://posthog.com and sign up (free)
2. Create a new project
3. Copy your Project API Key
4. Copy your Host URL (usually `https://app.posthog.com`)

### Configuration

Create `desktop-app/config.js` (or use the provided `config.example.js`):

```javascript
module.exports = {
  posthog: {
    apiKey: process.env.POSTHOG_API_KEY,
    host: process.env.POSTHOG_HOST || 'https://app.posthog.com'
  }
};
```

**Important**: Do **not** hardcode real API keys in `config.js`. Use environment variables (`POSTHOG_API_KEY`, `POSTHOG_PERSONAL_API_KEY`) loaded from `.env` instead.

### Implementation in `main.js`

Add at the top:

```javascript
const { PostHog } = require('posthog-node');
const { machineIdSync } = require('node-machine-id');
const config = require('./config');

// Initialize PostHog
const posthog = new PostHog(
  config.posthog.apiKey,
  { 
    host: config.posthog.host,
    flushAt: 10,        // Send events in batches of 10
    flushInterval: 10000 // Or every 10 seconds
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

// Ensure events are flushed on app quit
app.on('before-quit', async () => {
  await posthog.shutdown();
});
```

Add event tracking:

```javascript
// Track app launch
app.on('ready', async () => {
  trackEvent('app_launched');
  
  createWindow();
  // ... rest of ready handler
});

// Track booking started
ipcMain.handle('ra:startPolling', async (event, payload) => {
  trackEvent('booking_started', {
    facility_id: payload.facilityID,
    site_id: payload.siteID,
    nights: payload.units,
    booking_mode: payload.mode || 'add'
  });
  
  // ... existing polling logic
});

// Track booking success (add to polling success handler)
function onBookingSuccess(payload) {
  trackEvent('booking_success', {
    facility_id: payload.facilityID,
    site_id: payload.siteID,
    nights: payload.units,
    request_count: requestCount,
    elapsed_ms: Date.now() - pollingStartTime
  });
  
  // ... existing success logic
}

// Track booking error (add to polling error handler)
function onBookingError(error, payload) {
  trackEvent('booking_error', {
    facility_id: payload.facilityID,
    site_id: payload.siteID,
    error_type: error.type || 'unknown',
    http_status: error.status,
    error_message: error.message
  });
  
  // ... existing error logic
}

// Track countdown armed
ipcMain.handle('ra:armCountdown', async (event, targetTimestamp) => {
  trackEvent('countdown_armed', {
    target_timestamp: targetTimestamp,
    minutes_until_start: Math.round((targetTimestamp - Date.now()) / 60000)
  });
  
  // ... existing countdown logic
});

// Track context refresh
ipcMain.handle('ra:refreshContext', async () => {
  trackEvent('context_refreshed');
  
  // ... existing refresh logic
});
```

### Event Catalog

Document all tracked events:

| Event Name | When Fired | Properties |
|------------|------------|------------|
| `app_launched` | Every app start | `app_version`, `platform`, `arch` |
| `booking_started` | User clicks "Add to Cart" | `facility_id`, `site_id`, `nights`, `booking_mode` |
| `booking_success` | Item added to cart | `facility_id`, `site_id`, `nights`, `request_count`, `elapsed_ms` |
| `booking_error` | Booking fails | `facility_id`, `site_id`, `error_type`, `http_status`, `error_message` |
| `countdown_armed` | Countdown timer set | `target_timestamp`, `minutes_until_start` |
| `context_refreshed` | User clicks refresh | none |

---

## 3. Feature Flags with PostHog {#feature-flags}

### Setup Feature Flags in PostHog

1. Go to PostHog dashboard → Feature Flags
2. Create flags:
   - `app_enabled` (boolean) - Global kill switch
   - `booking_enabled` (boolean) - Enable/disable booking
3. Set all to `true` by default
4. Target "All users"

### Implementation in `main.js`

Add feature flag checking:

```javascript
// Cache feature flags
let featureFlags = {
  app_enabled: true,
  booking_enabled: true
};

// Fetch feature flags
async function fetchFeatureFlags() {
  try {
    const flags = await posthog.getAllFlags(deviceId);
    featureFlags = { ...featureFlags, ...flags };
    console.log('Feature flags loaded:', featureFlags);
    return featureFlags;
  } catch (err) {
    console.error('Could not fetch feature flags:', err);
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

// Modify app.on('ready')
app.on('ready', async () => {
  trackEvent('app_launched');
  
  // Check if app is enabled
  const enabled = await checkAppEnabled();
  if (!enabled) {
    app.quit();
    return;
  }
  
  createWindow();
  
  // Check for updates
  setTimeout(() => {
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  }, 3000);
});
```

Add feature flag checks for specific features:

```javascript
// Check booking enabled
ipcMain.handle('ra:startPolling', async (event, payload) => {
  // Refresh flags before critical operations
  await fetchFeatureFlags();
  
  if (!featureFlags.booking_enabled) {
    return {
      success: false,
      error: 'Booking is temporarily disabled. Please try again later.'
    };
  }
  
  trackEvent('booking_started', {
    facility_id: payload.facilityID,
    site_id: payload.siteID,
    nights: payload.units,
    booking_mode: payload.mode || 'add'
  });
  
  // ... existing polling logic
});

// Check countdown enabled
ipcMain.handle('ra:armCountdown', async (event, targetTimestamp) => {
  await fetchFeatureFlags();
  
  if (!featureFlags.countdown_enabled) {
    return {
      success: false,
      error: 'Countdown feature is temporarily disabled.'
    };
  }
  
  trackEvent('countdown_armed', {
    target_timestamp: targetTimestamp,
    minutes_until_start: Math.round((targetTimestamp - Date.now()) / 60000)
  });
  
  // ... existing countdown logic
});
```

Add IPC handler to expose flags to renderer:

```javascript
ipcMain.handle('flags:get', async () => {
  await fetchFeatureFlags();
  return featureFlags;
});
```

### Implementation in `preload.js`

```javascript
contextBridge.exposeInMainWorld('ra', {
  // ... existing APIs ...
  
  // Feature flags
  getFeatureFlags: () => ipcRenderer.invoke('flags:get'),
});
```

### Implementation in `renderer.js`

Add UI handling for disabled features:

```javascript
// Check feature flags on load
async function checkFeatureFlags() {
  const flags = await window.ra.getFeatureFlags();
  
  if (!flags.booking_enabled) {
    actionBtn.disabled = true;
    actionBtn.textContent = 'Booking Temporarily Disabled';
    actionBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }
  
  if (!flags.countdown_enabled) {
    // Hide countdown UI
    countdownSectionEl?.classList.add('hidden');
  }
}

// Call on page load
document.addEventListener('DOMContentLoaded', () => {
  checkFeatureFlags();
  // ... rest of initialization
});
```

---

## 4. Repository Migration {#repository-migration}

### Steps to Migrate

#### 1. Create New Repository

1. Go to GitHub → New Repository
2. Name: `reservation-helper`
3. Visibility: Private
4. Don't initialize (we'll push existing code)

#### 2. Update Remote URL

```bash
cd /Users/michaelrado/Documents/Development/camping-thing

# Add new remote
git remote add new-origin https://github.com/mrado1/reservation-helper.git

# Push all branches
git push new-origin --all

# Push all tags
git push new-origin --tags

# Update origin
git remote remove origin
git remote rename new-origin origin
```

#### 3. Update All References

Files to update:
- `desktop-app/package.json` - Update `publish.repo`
- `README.md` - Update repo URLs
- `docs/technical/BUILD.md` - Update repo references
- `docs/technical/DISTRIBUTION.md` - Update repo references

Search and replace:
```bash
# Find all references to old repo
grep -r "camping-thing" .

# Replace with new name
# (Do this manually or with sed)
```

#### 4. Rename Local Directory (Optional)

```bash
cd /Users/michaelrado/Documents/Development
mv camping-thing reservation-helper
```

---

## 5. Testing & Validation {#testing}

### Auto-Update Testing

#### Test Update Detection

1. Publish version 0.2.0
2. Install version 0.1.0
3. Launch app
4. Verify update notification appears
5. Click "Later" - verify app continues working
6. Restart app - verify notification appears again

#### Test Update Installation

1. Click "Restart Now" when update is ready
2. Verify app restarts
3. Verify new version is running (check About dialog or logs)
4. Verify context/state persisted through update

#### Test Failed Update

1. Disconnect internet
2. Launch app
3. Verify app launches normally (doesn't crash)
4. Reconnect internet
5. Verify update check happens on next launch

### Analytics Testing

#### Test Event Tracking

1. Open PostHog dashboard → Live Events
2. Launch app → verify `app_launched` event
3. Start booking → verify `booking_started` event
4. Complete booking → verify `booking_success` event
5. Cause error → verify `booking_error` event

#### Test Event Properties

1. In PostHog, click on an event
2. Verify properties are present:
   - `app_version`
   - `platform`
   - `facility_id` (for booking events)
   - etc.

#### Test Anonymous ID

1. Check multiple events in PostHog
2. Verify they all have the same `distinct_id`
3. Uninstall and reinstall app
4. Verify `distinct_id` stays the same (machine ID)

### Feature Flag Testing

#### Test Global Kill Switch

1. In PostHog, set `app_enabled` to `false`
2. Launch app
3. Verify error dialog appears
4. Verify app quits
5. Set `app_enabled` back to `true`
6. Launch app
7. Verify app works normally

#### Test Feature Flags

1. Set `booking_enabled` to `false`
2. Launch app
3. Try to start booking
4. Verify error message appears
5. Set `booking_enabled` back to `true`
6. Verify booking works

#### Test Flag Propagation Time

1. Change a flag in PostHog
2. Note the time
3. Launch app (or wait if already running)
4. Verify flag change takes effect within 60 seconds

### Integration Testing

1. **Full Update Cycle**
   - Publish new version
   - Install old version
   - Launch and verify update
   - Install update
   - Verify analytics still works
   - Verify feature flags still work

2. **Offline Mode**
   - Disconnect internet
   - Launch app
   - Verify app works (fails gracefully)
   - Verify no crashes

3. **Performance**
   - Launch app
   - Measure startup time
   - Verify < 5 second delay for update check
   - Verify no UI lag from analytics

---

## Environment Variables

For production builds, set these environment variables:

```bash
# GitHub token for publishing
export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"

# PostHog credentials (optional, can hardcode in config.js)
export POSTHOG_API_KEY="phc_xxxxxxxxxxxxxxxxxxxx"
export POSTHOG_HOST="https://app.posthog.com"
```

---

## Troubleshooting

### Auto-Updater Issues

**Problem**: "Cannot find updates"
- **Solution**: Verify GitHub token has `repo` scope
- **Solution**: Verify `publish` config in package.json is correct
- **Solution**: Check that GitHub Release exists with correct version tag

**Problem**: Update downloads but doesn't install
- **Solution**: Check file permissions on macOS (may need to re-sign)
- **Solution**: Verify app is not running from DMG (must be in Applications)

### Analytics Issues

**Problem**: Events not appearing in PostHog
- **Solution**: Verify API key is correct
- **Solution**: Check network requests in dev tools
- **Solution**: Verify `posthog.shutdown()` is called on app quit

**Problem**: Wrong distinct_id
- **Solution**: Verify `node-machine-id` is installed
- **Solution**: Check that machine ID is generated correctly

### Feature Flag Issues

**Problem**: Flags always return default values
- **Solution**: Verify PostHog API key is correct
- **Solution**: Check that flags are created in PostHog dashboard
- **Solution**: Verify flags are set to "Release to all users"

**Problem**: Flag changes don't take effect
- **Solution**: Restart app (flags are cached)
- **Solution**: Verify `fetchFeatureFlags()` is being called
- **Solution**: Check PostHog dashboard for flag status

---

## Security Considerations

1. **Never commit API keys** - Use environment variables or config files in .gitignore
2. **Use private GitHub repo** - Prevents unauthorized downloads
3. **Validate feature flags** - Always fail-open (assume enabled if fetch fails)
4. **Don't track PII** - Only track anonymous usage patterns
5. **Use HTTPS** - All API calls should use HTTPS (PostHog and GitHub do by default)

---

## Next Steps After M10

- **M11**: User authentication with Supabase
- **M12**: Crash reporting with Sentry
- **M13**: In-app feedback system
- **M14**: Custom update channels (beta/stable)

