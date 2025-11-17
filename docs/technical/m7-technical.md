# M7 Technical Design — Safety + Resilience

## Overview
M7 adds resilience to the polling worker to handle temporary throttling (HTTP 000/429) without stopping. Based on real-world testing: HTTP 000 clears in ~1 second when you pause and retry. Strategy: brief pause (1-2s) and resume, no exponential backoff (too slow for narrow booking windows). Auto-reduce concurrency if throttling persists. Only terminal errors (inventory unavailable, auth invalid) trigger stop.

## Components
1. **Main Process (Polling Worker)**
   - Network throttle detection (HTTP 000) → pause 1-2s, resume
   - Rate limit detection (HTTP 429) → pause 1-2s, resume
   - Auto-concurrency reduction (after 10+ consecutive throttles)
   - Persistent failure warnings (after 20+ consecutive non-000/429 failures)
   - Max duration enforcement
   - Settings-based cadence/concurrency control
   
2. **Renderer (Settings UI)**
   - Settings form with validation
   - Persist settings to localStorage
   - Display elapsed time and limits during polling
   
3. **Preload (IPC Surface)**
   - `ra:updateSettings(settings)` - Save new settings
   - `ra:getSettings()` - Retrieve current settings
   - `ra:resetSettings()` - Reset to defaults

## State Management

### Polling Worker State (main.js)
```javascript
let pollingConfig = {
  cadence: 100,         // ms between requests
  maxDuration: 300000,  // 5 minutes in ms
  concurrency: 3,       // max parallel requests (base level)
  activeConcurrency: 3, // current active level (may be reduced)
};

let throttleState = {
  consecutive000s: 0,   // count of consecutive HTTP 000 (network throttle)
  consecutive429s: 0,   // count of consecutive HTTP 429 (rate limit)
  isPaused: false,      // currently paused due to throttle
};

let failureState = {
  consecutiveFailures: 0,  // count of consecutive non-200/non-417/non-000/non-429 responses
};

let pollingMetrics = {
  startTime: null,
  requestCount: 0,
  lastStatus: null,
};
```

### Settings Schema
```json
{
  "cadence": 100,                 // ms, range [50, 5000]
  "maxDuration": 300,             // seconds, range [30, 600]
  "concurrency": 3,               // count, range [1, 10]
  "throttlePauseMin": 1000,       // ms, fixed at 1s
  "throttlePauseMax": 2000,       // ms, fixed at 2s
  "throttleThreshold": 10,        // consecutive throttles before reducing concurrency
  "failureWarningThreshold": 20  // consecutive failures before showing warning
}
```

Settings stored in renderer localStorage as `pollingSettings` key.

## Network Throttle Handling (HTTP 000)

### Real-World Behavior
In practice, HTTP 000 (connection refused/failed) is typically a **temporary network-level rate limit** that clears in ~1 second when you pause and retry. It's **not a terminal error**. The strategy: pause briefly, then resume polling.

### HTTP 000 Handler
```javascript
async function sendAddToCartRequest() {
  try {
    const response = await fetch(url, options);
    
    // Success - reset throttle counters
    if (response.ok) {
      throttleState.consecutive000s = 0;
      throttleState.consecutive429s = 0;
      failureState.consecutiveFailures = 0;
    }
    
    // ... process response ...
    
  } catch (err) {
    // Network error (connection refused, timeout) - likely throttled
    throttleState.consecutive000s++;
    
    // Show warning status
    broadcastPollingStatus({
      state: 'polling',
      lastHttpStatus: 0,
      lastMessage: '⚠️ Network throttle: Pausing 1s...',
    });
    
    // Pause randomly between 1-2 seconds
    const pauseMs = Math.random() * (pollingConfig.throttlePauseMax - pollingConfig.throttlePauseMin) 
                    + pollingConfig.throttlePauseMin;
    await new Promise(resolve => setTimeout(resolve, pauseMs));
    
    // Check if persistent throttling (10+ consecutive)
    if (throttleState.consecutive000s >= pollingConfig.throttleThreshold) {
      // Reduce concurrency to ease pressure
      if (pollingConfig.activeConcurrency > 1) {
        pollingConfig.activeConcurrency--;
        broadcastPollingStatus({
          state: 'polling',
          lastMessage: `⚙️ Reduced concurrency to ${pollingConfig.activeConcurrency} due to persistent throttling.`,
        });
        throttleState.consecutive000s = 0; // Reset counter after reduction
      }
    }
    
    // Continue polling (never stop for HTTP 000)
    return;
  }
}
```

**Key Points:**
- HTTP 000 does **not** stop polling
- Brief pause (1-2s random) before continuing
- After 10+ consecutive, reduce concurrency
- Only user can stop manually

## Rate Limit Handling (HTTP 429)

### Brief Pause Strategy (No Exponential Backoff)
```javascript
async function handleRateLimit(status) {
  if (status === 429) {
    throttleState.consecutive429s++;
    
    // Show warning status
    broadcastPollingStatus({
      state: 'polling',
      lastHttpStatus: 429,
      lastMessage: '⚠️ Rate limited: Pausing 1s...',
    });
    
    // Pause randomly between 1-2 seconds (same as HTTP 000)
    const pauseMs = Math.random() * (pollingConfig.throttlePauseMax - pollingConfig.throttlePauseMin) 
                    + pollingConfig.throttlePauseMin;
    await new Promise(resolve => setTimeout(resolve, pauseMs));
    
    // Check if persistent (10+ consecutive)
    if (throttleState.consecutive429s >= pollingConfig.throttleThreshold) {
      // Reduce concurrency to ease pressure
      if (pollingConfig.activeConcurrency > 1) {
        pollingConfig.activeConcurrency--;
        broadcastPollingStatus({
          state: 'polling',
          lastMessage: `⚙️ Reduced concurrency to ${pollingConfig.activeConcurrency} due to persistent rate limiting.`,
        });
        throttleState.consecutive429s = 0; // Reset counter after reduction
      }
    }
    
    // Continue polling (never stop for HTTP 429)
    return;
  }
}

// Reset on success or expected error
function onSuccessOrExpectedError() {
  throttleState.consecutive000s = 0;
  throttleState.consecutive429s = 0;
  failureState.consecutiveFailures = 0;
}
```

**Key Points:**
- HTTP 429 does **not** stop polling
- Brief pause (1-2s random), no exponential backoff (too slow for booking windows)
- After 10+ consecutive, reduce concurrency
- Only user can stop manually

## Persistent Failure Warning

### Consecutive Failure Counter (Non-Throttle Errors)
```javascript
function handleResponse(status, body) {
  // Expected responses (reset counters)
  if (status === 200 || 
      (status === 417 && body?.faults?.[0]?.msgKey === 'R1-V-100017.error')) {
    onSuccessOrExpectedError();
    return;
  }
  
  // Throttles (separate handling, don't count as failures)
  if (status === 0 || status === 429) {
    await handleThrottle(status);
    return;
  }
  
  // Terminal errors (already reserved, cart full, auth invalid) - stop immediately
  if (status === 417) {
    const fault = body?.faults?.[0];
    if (fault?.msgKey === 'inventory.exception') {
      stopPollingWorker();
      broadcastPollingStatus({
        state: 'error',
        lastHttpStatus: status,
        lastMessage: '❌ Already reserved: Dates not available. Select different dates.',
      });
      return;
    }
    if (fault?.msgKey === 'R12-V-100007.error' || /overlapping/i.test(fault?.defaultMessage || '')) {
      stopPollingWorker();
      broadcastPollingStatus({
        state: 'error',
        lastHttpStatus: status,
        lastMessage: '🛒 Cart full: Clear existing reservations from your cart.',
      });
      return;
    }
  }
  
  // Other failures (increment counter, but don't stop)
  failureState.consecutiveFailures++;
  
  if (failureState.consecutiveFailures >= pollingConfig.failureWarningThreshold) {
    // Show warning, but keep polling
    broadcastPollingStatus({
      state: 'polling',
      lastHttpStatus: status,
      lastMessage: `⚠️ ${failureState.consecutiveFailures}+ failures: Consider checking cookies/site.`,
    });
  } else {
    // Continue polling with count
    broadcastPollingStatus({
      state: 'polling',
      lastHttpStatus: status,
      lastMessage: `⚠️ Failure (${failureState.consecutiveFailures}/${pollingConfig.failureWarningThreshold}): ${body?.message || 'Unknown error'}`,
    });
  }
}
```

**Key Points:**
- HTTP 000 and 429 are **not** counted as failures (separate throttle handling)
- Terminal errors (already reserved, cart full) **do** stop polling
- Other failures (400, 500, etc.) show warning after 20+ consecutive, but **do not stop**
- User controls when to stop manually

## Max Duration Enforcement

### Duration Timer
```javascript
function startPollingWorker(formData) {
  // ... existing setup ...
  
  pollingMetrics.startTime = Date.now();
  
  // Check duration on each request
  function checkMaxDuration() {
    const elapsed = Date.now() - pollingMetrics.startTime;
    const maxMs = pollingConfig.maxDuration * 1000;
    
    if (elapsed >= maxMs) {
      stopPollingWorker();
      const elapsedMin = Math.floor(elapsed / 60000);
      const elapsedSec = Math.floor((elapsed % 60000) / 1000);
      broadcastPollingStatus({
        state: 'stopped',
        lastMessage: `⏱️ Max duration reached (${elapsedMin}m ${elapsedSec}s). Adjust settings to run longer.`,
      });
      return true;
    }
    return false;
  }
  
  // Call checkMaxDuration() before each request batch
}
```

### Elapsed Time Display
Broadcast elapsed time in every status update:
```javascript
broadcastPollingStatus({
  state: 'polling',
  requestCount,
  elapsedMs: Date.now() - pollingMetrics.startTime,
  maxDurationMs: pollingConfig.maxDuration * 1000,
  // ... other fields ...
});
```

Renderer displays: "Elapsed: 2m 34s / 5m 0s"

## Settings Management

### IPC Handlers (main.js)
```javascript
ipcMain.handle('ra:getSettings', () => {
  return pollingConfig;
});

ipcMain.handle('ra:updateSettings', (event, newSettings) => {
  // Validate ranges
  const validated = {
    cadence: Math.max(50, Math.min(5000, newSettings.cadence || 100)),
    maxDuration: Math.max(30, Math.min(600, newSettings.maxDuration || 300)),
    concurrency: Math.max(1, Math.min(10, newSettings.concurrency || 3)),
    // Fixed values (not user-configurable)
    backoffStart: 1000,
    backoffCap: 30000,
    max429s: 5,
    maxFailures: 10,
  };
  
  pollingConfig = validated;
  return { ok: true, settings: validated };
});

ipcMain.handle('ra:resetSettings', () => {
  pollingConfig = {
    cadence: 100,
    maxDuration: 300,
    concurrency: 3,
    activeConcurrency: 3,
    throttlePauseMin: 1000,
    throttlePauseMax: 2000,
    throttleThreshold: 10,
    failureWarningThreshold: 20,
  };
  return { ok: true, settings: pollingConfig };
});
```

### Settings UI (renderer)
```html
<div id="settingsSection" class="mb-3">
  <button id="toggleSettings" class="text-sm text-slate-600">⚙️ Settings</button>
  <div id="settingsForm" class="hidden mt-2 p-3 bg-slate-50 rounded-md border">
    <div class="mb-2">
      <label class="text-xs text-slate-600">Cadence (ms)</label>
      <input id="cadenceSetting" type="number" min="50" max="5000" value="100" />
      <span class="text-xs text-slate-500">Delay between requests (50-5000ms)</span>
    </div>
    
    <div class="mb-2">
      <label class="text-xs text-slate-600">Max Duration (seconds)</label>
      <input id="maxDurationSetting" type="number" min="30" max="600" value="300" />
      <span class="text-xs text-slate-500">Auto-stop after (30-600s)</span>
    </div>
    
    <div class="mb-2">
      <label class="text-xs text-slate-600">Concurrency</label>
      <input id="concurrencySetting" type="number" min="1" max="10" value="3" />
      <span class="text-xs text-slate-500">Parallel requests (1-10)</span>
    </div>
    
    <button id="saveSettings">Save</button>
    <button id="resetSettings">Reset to Defaults</button>
  </div>
</div>
```

### Settings Persistence (renderer.js)
```javascript
function loadSettings() {
  const stored = localStorage.getItem('pollingSettings');
  if (stored) {
    const settings = JSON.parse(stored);
    // Populate form fields
    document.getElementById('cadenceSetting').value = settings.cadence;
    document.getElementById('maxDurationSetting').value = settings.maxDuration;
    document.getElementById('concurrencySetting').value = settings.concurrency;
    // Apply to main process
    window.ra.updateSettings(settings);
  }
}

async function saveSettings() {
  const settings = {
    cadence: parseInt(document.getElementById('cadenceSetting').value),
    maxDuration: parseInt(document.getElementById('maxDurationSetting').value),
    concurrency: parseInt(document.getElementById('concurrencySetting').value),
  };
  
  localStorage.setItem('pollingSettings', JSON.stringify(settings));
  await window.ra.updateSettings(settings);
  alert('Settings saved! Will apply to next polling session.');
}

async function resetSettings() {
  const result = await window.ra.resetSettings();
  localStorage.removeItem('pollingSettings');
  // Update form with defaults
  document.getElementById('cadenceSetting').value = result.settings.cadence;
  document.getElementById('maxDurationSetting').value = result.settings.maxDuration;
  document.getElementById('concurrencySetting').value = result.settings.concurrency;
  alert('Settings reset to defaults!');
}
```

## Clean Stop Behavior

### Unified Stop Function
```javascript
function stopPollingWorker(reason = 'manual') {
  // Clear interval
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  
  // Reset all state
  pollingState = 'idle';
  backoffState = { current: 0, consecutive429s: 0 };
  failureState = { consecutiveFailures: 0, networkErrors: 0 };
  pollingMetrics = { startTime: null, requestCount: 0, lastStatus: null };
  
  // Cancel in-flight requests (if tracked)
  abortController?.abort();
  
  console.log(`[Polling] Stopped (reason: ${reason})`);
}
```

All stop conditions call `stopPollingWorker()` with appropriate reason.

## Testing Strategy

### Unit Tests
- Settings validation (min/max ranges).
- Backoff calculation (1s → 2s → 4s → ... → 30s cap).
- Failure counter logic (increment, reset conditions).
- Max duration check (elapsed vs. limit).

### Integration Tests
- Network error (HTTP 000) → stop after 3 consecutive.
- Rate limit (HTTP 429) → backoff applied, stop after 5.
- Repeated failures → stop after 10.
- Max duration → stop at configured limit.
- Settings persist and apply correctly.

### Manual Tests
- Disconnect network during polling → clean stop.
- Simulate 429 responses → observe backoff and eventual stop.
- Run polling for full duration → verify auto-stop.
- Change settings → verify next session uses new values.

## Edge Cases

### Throttle During Countdown
- If hit with 000/429 before 8:59 AM target, pause and resume as normal.
- Don't carry over any pause into the countdown start time.
- Reset all throttle counters when countdown target is reached and polling starts.

### Settings Change During Polling
- Current session continues with old settings (avoid mid-session config changes).
- Show message: "Settings will apply to next session."

### Concurrency Reduction
- Once `activeConcurrency` is reduced, it stays reduced for entire session.
- Resets to configured `concurrency` on next session start.
- If user manually changes `concurrency` setting mid-session, next session uses new value.

### Multiple Concurrent Throttles
- All in-flight requests pause together when throttle detected.
- Counter tracks session-level throttles, not per-request.

## Limitations (M7)
- Fixed pause duration (1-2s random), no adaptive throttle detection.
- Cannot distinguish true network failure from infrastructure-level throttle (both HTTP 000).
- Concurrency reduction is simple (decrement by 1), not intelligent/adaptive.
- Settings apply to all polling sessions (no per-site overrides).
- No detailed analytics dashboard (basic metrics only).



