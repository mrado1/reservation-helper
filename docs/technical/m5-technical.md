# M5 Technical Design — In-App Poller (Manual Start)

## Scope (M5)
- Polling worker in main process that executes add-to-cart API calls
- Manual start/stop controls in renderer
- Bounded concurrency and configurable cadence
- Real-time, deduplicated status updates in UI
- Success/error detection with auto-stop logic

## Architecture

### Main Process (Polling Worker)
- **Worker state machine**:
  - `idle`: Not polling
  - `polling`: Active, sending requests
  - `success`: Stopped due to success (200 OK)
  - `stopped`: Stopped by user or max duration
  - `error`: Stopped due to terminal error

- **Concurrency control**:
  - Track in-flight requests (max 3)
  - Queue requests when at capacity
  - Release slots on response/error

- **Cadence control**:
  - 100ms delay between request batches
  - Use `setInterval` or async loop with `setTimeout`

- **Request lifecycle**:
  1. User clicks "Start Polling"
  2. Main process validates context + form data
  3. Worker enters `polling` state
  4. Loop: send request batch (up to 3 concurrent)
  5. Wait for responses or timeout
  6. Check stop conditions (success, error, user stop, max duration)
  7. Broadcast status update to renderer
  8. Repeat or exit

### Preload
- Expose APIs:
  - `window.ra.startPolling()` → IPC invoke to main
  - `window.ra.stopPolling()` → IPC invoke to main
  - `window.ra.onPollingStatus(cb)` → Subscribe to status updates

### Renderer
- UI controls for start/stop
- Status display section
- Subscribe to polling status updates
- Lock form inputs during polling
- Display success/error messages

## Data Model

```typescript
type PollingState = 'idle' | 'polling' | 'success' | 'stopped' | 'error';

interface PollingStatus {
  state: PollingState;
  requestCount: number;
  elapsedMs: number;
  lastHttpStatus?: number;
  lastMessage?: string;
  lastUpdated: number; // Date.now()
}

interface PollingConfig {
  facilityId: string;
  siteId: string;
  arrivalDate: string; // ISO format "2026-05-17"
  nights: number;
  idToken: string;
  a1Data: string;
  cadenceMs: number; // 100
  maxConcurrent: number; // 3
  maxDurationMs: number; // 300000 (5 minutes)
}

interface AddToCartPayload {
  facilityId: string;
  siteId: string;
  arrivalDate: string;
  lengthOfStay: number;
  cartType: 'camping';
}
```

## Polling Worker Implementation (Main Process)

### State Management

```javascript
// Worker state
let pollingState = 'idle';
let pollingConfig = null;
let pollingStartTime = 0;
let requestCount = 0;
let inFlightCount = 0;
let stopRequested = false;
let pollingInterval = null;

// Deduplication
let lastStatusSignature = '';

function statusSignature(status) {
  return `${status.state}|${status.lastHttpStatus}|${status.lastMessage}`;
}

function broadcastPollingStatus(status) {
  const sig = statusSignature(status);
  if (sig === lastStatusSignature) return; // Skip duplicate
  lastStatusSignature = sig;
  
  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('ra:pollingStatus', status);
  });
}
```

### Start/Stop Handlers

```javascript
ipcMain.handle('ra:startPolling', async (event) => {
  if (pollingState === 'polling') {
    return { ok: false, error: 'Already polling' };
  }
  
  // Validate we have required data
  const { idToken, a1Data } = await getCookiesForWebview();
  if (!idToken || !a1Data) {
    return { ok: false, error: 'Missing auth cookies' };
  }
  
  if (!lastContext || !lastContext.facilityId || !lastContext.siteId) {
    return { ok: false, error: 'Missing context (facilityId/siteId)' };
  }
  
  // Get form data from renderer (pass as args or fetch via separate IPC)
  // For now, assume we have it somehow
  const { startDate, nights } = formData; // TODO: Get from renderer
  
  pollingConfig = {
    facilityId: lastContext.facilityId,
    siteId: lastContext.siteId,
    arrivalDate: startDate.toISOString().split('T')[0],
    nights,
    idToken,
    a1Data,
    cadenceMs: 100,
    maxConcurrent: 3,
    maxDurationMs: 5 * 60 * 1000 // 5 minutes
  };
  
  startPollingWorker();
  return { ok: true };
});

ipcMain.handle('ra:stopPolling', async (event) => {
  stopPollingWorker();
  return { ok: true };
});
```

### Polling Worker Loop

```javascript
function startPollingWorker() {
  pollingState = 'polling';
  pollingStartTime = Date.now();
  requestCount = 0;
  inFlightCount = 0;
  stopRequested = false;
  
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
  pollingState = 'stopped';
  
  broadcastPollingStatus({
    state: 'stopped',
    requestCount,
    elapsedMs: Date.now() - pollingStartTime,
    lastMessage: 'Polling stopped by user',
    lastUpdated: Date.now()
  });
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
      lastMessage: 'Polling stopped: max duration reached',
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

async function sendAddToCartRequest() {
  inFlightCount++;
  requestCount++;
  
  const payload = {
    facilityId: pollingConfig.facilityId,
    siteId: pollingConfig.siteId,
    arrivalDate: pollingConfig.arrivalDate,
    lengthOfStay: pollingConfig.nights,
    cartType: 'camping'
  };
  
  try {
    const response = await fetch('https://www.reserveamerica.com/api/cart/add', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pollingConfig.idToken}`,
        'Cookie': `a1Data=${pollingConfig.a1Data}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      body: JSON.stringify(payload)
    });
    
    const status = response.status;
    let body = {};
    try {
      body = await response.json();
    } catch {}
    
    console.log(`[Polling] Request ${requestCount}: HTTP ${status}`, body);
    
    // Handle response
    if (status === 200) {
      // Success!
      stopPollingWorker();
      pollingState = 'success';
      broadcastPollingStatus({
        state: 'success',
        requestCount,
        elapsedMs: Date.now() - pollingStartTime,
        lastHttpStatus: status,
        lastMessage: 'Success! Inventory added to cart.',
        lastUpdated: Date.now()
      });
      return;
    }
    
    // Terminal errors
    if (status === 401 || status === 403) {
      stopPollingWorker();
      pollingState = 'error';
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
    
    if (status === 409 || (body.message && /unavailable|sold out/i.test(body.message))) {
      stopPollingWorker();
      pollingState = 'error';
      broadcastPollingStatus({
        state: 'error',
        requestCount,
        elapsedMs: Date.now() - pollingStartTime,
        lastHttpStatus: status,
        lastMessage: 'Inventory unavailable',
        lastUpdated: Date.now()
      });
      return;
    }
    
    // Transient errors, keep polling
    broadcastPollingStatus({
      state: 'polling',
      requestCount,
      elapsedMs: Date.now() - pollingStartTime,
      lastHttpStatus: status,
      lastMessage: body.message || `HTTP ${status}`,
      lastUpdated: Date.now()
    });
    
  } catch (err) {
    console.error('[Polling] Request error:', err.message);
    
    // HTTP 000 or network error
    if (err.code === 'ECONNREFUSED' || err.message.includes('fetch failed')) {
      stopPollingWorker();
      pollingState = 'error';
      broadcastPollingStatus({
        state: 'error',
        requestCount,
        elapsedMs: Date.now() - pollingStartTime,
        lastHttpStatus: 0,
        lastMessage: 'Network error or blocked (HTTP 000)',
        lastUpdated: Date.now()
      });
      return;
    }
    
    // Other errors, continue
    broadcastPollingStatus({
      state: 'polling',
      requestCount,
      elapsedMs: Date.now() - pollingStartTime,
      lastMessage: `Error: ${err.message}`,
      lastUpdated: Date.now()
    });
    
  } finally {
    inFlightCount--;
  }
}
```

## Preload API

```javascript
contextBridge.exposeInMainWorld('ra', {
  // ... existing APIs from M2-M4 ...
  
  startPolling: () => ipcRenderer.invoke('ra:startPolling'),
  stopPolling: () => ipcRenderer.invoke('ra:stopPolling'),
  onPollingStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on('ra:pollingStatus', handler);
    return () => ipcRenderer.removeListener('ra:pollingStatus', handler);
  }
});
```

## Renderer Implementation

### HTML Structure

```html
<section class="mt-5 pt-4 border-t border-dashed border-[#dacdb9]">
  <h2 class="text-sm font-serif text-[#2f6b4f] mb-2">Booking Form</h2>
  <!-- ... existing date/nights inputs ... -->
  
  <div id="pollingControls" class="mt-3">
    <button id="startPollingBtn" class="w-full inline-flex items-center justify-center rounded-md bg-[#2f6b4f] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#25533e] disabled:opacity-40 disabled:cursor-not-allowed">
      Start Polling
    </button>
    <button id="stopPollingBtn" class="hidden w-full inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700">
      Stop Polling
    </button>
  </div>
</section>

<section class="mt-5 pt-4 border-t border-dashed border-[#dacdb9]">
  <h2 class="text-sm font-serif text-[#2f6b4f] mb-2">Polling Status</h2>
  <div id="pollingStatus" class="text-sm space-y-1">
    <div><span class="text-slate-500">State:</span> <span id="pollingState">Idle</span></div>
    <div><span class="text-slate-500">Requests:</span> <span id="pollingRequests">0</span></div>
    <div><span class="text-slate-500">Elapsed:</span> <span id="pollingElapsed">0s</span></div>
    <div><span class="text-slate-500">Last status:</span> <span id="pollingLastStatus">—</span></div>
    <div id="pollingMessage" class="text-xs mt-1 text-slate-600"></div>
  </div>
</section>
```

### JavaScript Logic

```javascript
const startPollingBtn = document.getElementById('startPollingBtn');
const stopPollingBtn = document.getElementById('stopPollingBtn');
const pollingStateEl = document.getElementById('pollingState');
const pollingRequestsEl = document.getElementById('pollingRequests');
const pollingElapsedEl = document.getElementById('pollingElapsed');
const pollingLastStatusEl = document.getElementById('pollingLastStatus');
const pollingMessageEl = document.getElementById('pollingMessage');

// Start polling
startPollingBtn.addEventListener('click', async () => {
  const result = await window.ra.startPolling();
  if (!result.ok) {
    alert(`Cannot start polling: ${result.error}`);
    return;
  }
  
  // Update UI
  startPollingBtn.classList.add('hidden');
  stopPollingBtn.classList.remove('hidden');
  
  // Disable form inputs
  startDateEl.disabled = true;
  nightsEl.disabled = true;
});

// Stop polling
stopPollingBtn.addEventListener('click', async () => {
  await window.ra.stopPolling();
  
  // Update UI
  startPollingBtn.classList.remove('hidden');
  stopPollingBtn.classList.add('hidden');
  
  // Re-enable form inputs
  startDateEl.disabled = false;
  nightsEl.disabled = false;
});

// Subscribe to polling status updates
window.ra.onPollingStatus((status) => {
  pollingStateEl.textContent = status.state;
  pollingRequestsEl.textContent = status.requestCount;
  pollingElapsedEl.textContent = `${(status.elapsedMs / 1000).toFixed(1)}s`;
  pollingLastStatusEl.textContent = status.lastHttpStatus ? `HTTP ${status.lastHttpStatus}` : '—';
  pollingMessageEl.textContent = status.lastMessage || '';
  
  // Color-code state
  if (status.state === 'success') {
    pollingStateEl.className = 'text-green-700 font-semibold';
  } else if (status.state === 'error') {
    pollingStateEl.className = 'text-red-700 font-semibold';
  } else if (status.state === 'polling') {
    pollingStateEl.className = 'text-yellow-700 font-semibold';
  } else {
    pollingStateEl.className = 'text-slate-600';
  }
  
  // If stopped/success/error, show start button again
  if (['stopped', 'success', 'error'].includes(status.state)) {
    startPollingBtn.classList.remove('hidden');
    stopPollingBtn.classList.add('hidden');
    startDateEl.disabled = false;
    nightsEl.disabled = false;
  }
});
```

## Acceptance Tests

### Manual Testing
1. **Start with valid form + context**
   - Click "Start Polling"
   - Status shows "Polling"
   - Request count increments
   - Console shows HTTP requests/responses
   - Form inputs disabled

2. **Stop polling**
   - Click "Stop Polling" while active
   - Status shows "Stopped"
   - Request count stops incrementing
   - Form inputs re-enabled

3. **Success scenario** (if RA API accessible)
   - Poll with valid, available inventory
   - Worker detects HTTP 200
   - Status shows "Success"
   - Polling stops automatically

4. **Error scenarios**
   - Poll with expired cookies → "Auth error"
   - Poll with unavailable inventory → "Inventory unavailable"
   - Network disconnect → "Network error or blocked"

5. **Edge cases**
   - Start with invalid form → Error shown, no polling
   - Start without context → Error shown, no polling
   - Navigate away during polling → Auto-stop (future)
   - Max duration reached → Auto-stop with message

## Security & Privacy
- No cookies persisted beyond session
- Requests logged to console only (not disk in M5)
- Token/cookie values redacted in UI messages
- Worker runs in main process (secure)

## Performance Considerations
- Bounded concurrency prevents overwhelming RA servers
- Configurable cadence allows tuning (100ms = 10 req/s per slot)
- Deduplication reduces IPC chatter
- Status updates throttled to prevent UI jank

## Risks & Mitigations
- **Risk**: RA API endpoint/payload structure unknown
  - **Mitigation**: Reverse-engineer from browser DevTools; adjust implementation
- **Risk**: RA rate limits not known
  - **Mitigation**: Start conservative (100ms, 3 concurrent); tune based on testing
- **Risk**: Worker crashes or hangs
  - **Mitigation**: Timeout on requests; max duration auto-stop; user can force-stop
- **Risk**: Success detection fails (unclear 200 response)
  - **Mitigation**: Log full responses; refine detection logic iteratively

## Open Implementation Questions
- Exact RA add-to-cart API endpoint?
- Required headers beyond Authorization/Cookie?
- Response body structure for success vs error?
- What status codes indicate "try again" vs "stop"?
- Should we use `fetch` (Node 18+) or `https` module?

## Handoff to M6
M6 will add countdown/prewarm/auto-start:
- Replace "Start Polling" with "Arm Countdown"
- Input for target timestamp
- Display countdown (mm:ss.ms)
- Auto-start worker at target time
- Prewarm logic (start at T-60s)



