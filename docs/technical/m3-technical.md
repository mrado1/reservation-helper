# M3 Technical Design — Facility/Site Context Detection

## Scope (M3)
- Parse `facilityId` and `siteId` from ReserveAmerica URL.
- Enrich with labels from the DOM: facility name, location, site name.
- Auto-update on navigation and SPA route changes; display in sidebar.
- No network enrichment or persistence in M3.

## Architecture
- Main process
  - Drives context extraction lifecycle on navigation events.
  - Schedules fast URL parse and deferred DOM enrichment.
  - Emits deduplicated context to renderer via IPC.
- Preload
  - Exposes `ra.getContext()` and `ra.onContextChanged(cb)` to renderer.
  - No direct DOM scraping here; uses `webContents.executeJavaScript` from main.
- Renderer
  - Subscribes to context updates; renders loading/partial/complete/unknown states.
  - Provides optional “Refresh context” action.
- WebView (RA page)
  - No injection of persistent scripts in M3; run short-lived JS snippets to read URL/DOM.

## Data Model
```ts
type ContextStatus = 'loading' | 'partial' | 'complete' | 'unknown';

interface RaContext {
  // Raw identifiers (string to avoid number coercion issues)
  facilityId?: string;
  siteId?: string;

  // Human-friendly labels
  facilityName?: string;
  location?: string;   // e.g., "Yosemite, CA"
  siteName?: string;

  // Meta
  status: ContextStatus;
  url: string;         // canonicalized current RA URL
  extractedAt: number; // Date.now()
  sourceHints: string[]; // e.g., ['url:query', 'dom:h1', 'dom:breadcrumb']
}
```

## URL Parsing Strategy (Implemented)
Parse path using regex pattern matching the observed RA URL structure:
- Pattern: `/STATE/FACILITY_ID/SITE_ID/campsite-booking`
- Example: `https://www.reserveamerica.com/explore/glen-island-lake-george-is/NY/140/245719/campsite-booking?arrivalDate=2026-05-17&lengthOfStay=1`
- Extracts: `facilityId=140`, `siteId=245719`

```js
function parseIdsFromUrl(url) {
  try {
    const match = url.match(/\/([A-Z]{2})\/(\d+)\/(\d+)\/campsite-booking/i);
    if (match) {
      return { facilityId: match[2], siteId: match[3] };
    }
  } catch {}
  return { facilityId: '', siteId: '' };
}
```

This implementation is simpler and matches the actual RA URL structure observed. Future enhancements could add query parameter fallbacks if needed.

## DOM Enrichment Strategy (Implemented)
Executed in the webview context via `executeJavaScript`. Layered selectors provide resilience:

```js
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
```

**Retry schedule**: 100ms, 300ms, 800ms delays to accommodate DOM rendering timing.

## Eventing & Scheduling (Implemented)
- **Triggers**: Wired to webview's `did-navigate`, `did-navigate-in-page`, and `dom-ready` events
- **Debounce**: 150ms debounce on navigation to avoid excessive extraction during SPA transitions
- **Two-phase extraction**:
  - Phase 1 (instant): URL parse → broadcast `partial` status if IDs found, else `unknown`
  - Phase 2 (100ms, 300ms, 800ms): DOM enrichment attempts with bounded retry
- **Deduplication**: Signature-based dedup prevents redundant broadcasts
  - Signature: `facilityId|siteId|facilityName|location|siteName|status`
  - Only broadcasts when signature changes
- **Status transitions**:
  - `partial`: IDs found but no DOM labels yet
  - `complete`: IDs + at least one label extracted
  - `unknown`: No IDs found or not a campsite page
  - `loading`: Used only in UI during manual refresh

### Main Process Implementation
Implemented in `desktop-app/main.js` (lines 5-189):

```js
// Context state
let lastContext = null;
let lastContextSignature = '';

function contextSignature(ctx) {
  return `${ctx.facilityId}|${ctx.siteId}|${ctx.facilityName}|${ctx.location}|${ctx.siteName}|${ctx.status}`;
}

async function extractContext(webContents, url) {
  const { facilityId, siteId } = parseIdsFromUrl(url);
  
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
    ctx.status = 'partial';
    broadcastContext(ctx);
  } else {
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

// Wire to webview events
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

  webviewWebContents.on('did-navigate', (_e, url) => scheduleExtraction(url));
  webviewWebContents.on('did-navigate-in-page', (_e, url) => scheduleExtraction(url));
  webviewWebContents.on('dom-ready', () => {
    const url = webviewWebContents.getURL();
    scheduleExtraction(url);
  });
});
```

### Preload API (Implemented)
Implemented in `desktop-app/preload.js` (lines 13-19):

```js
contextBridge.exposeInMainWorld('ra', {
  // ... existing auth APIs ...
  
  getContext: () => ipcRenderer.invoke('ra:getContext'),
  onContextChanged: (cb) => {
    const handler = (_e, ctx) => cb(ctx);
    ipcRenderer.on('ra:context', handler);
    return () => ipcRenderer.removeListener('ra:context', handler);
  }
});
```

### Renderer Implementation
Implemented in `desktop-app/renderer/renderer.js` (lines 164-202):

```js
function renderContextStatus(status) {
  const statusConfig = {
    complete: { label: 'Complete', color: 'text-[#2f6b4f] bg-[#f1f7f4] border-[#d7e3db]' },
    partial: { label: 'Partial', color: 'text-[#7a4b11] bg-[#fff4d6] border-[#f0d69a]' },
    loading: { label: 'Loading', color: 'text-slate-600 bg-slate-100 border-slate-300' },
    unknown: { label: 'Unknown', color: 'text-slate-500 bg-slate-50 border-slate-200' }
  };
  const cfg = statusConfig[status] || statusConfig.unknown;
  contextStatusEl.innerHTML = `<span class="inline-flex items-center rounded-full border ${cfg.color} px-2 py-0.5 text-xs font-medium">${cfg.label}</span>`;
}

function renderContext(ctx) {
  if (!ctx) return;
  renderContextStatus(ctx.status);
  facilityIdEl.textContent = ctx.facilityId ? `(#${ctx.facilityId})` : '';
  siteIdEl.textContent = ctx.siteId ? `(#${ctx.siteId})` : '';
  facilityNameEl.textContent = ctx.facilityName || (ctx.facilityId ? '—' : '');
  locationNameEl.textContent = ctx.location || (ctx.facilityId ? '—' : '');
  siteNameEl.textContent = ctx.siteName || (ctx.siteId ? '—' : '');
}

// Subscribe to updates
window.ra.onContextChanged((ctx) => {
  renderContext(ctx);
});

// Manual refresh
refreshContextBtn?.addEventListener('click', async () => {
  renderContextStatus('loading');
  const ctx = await window.ra.getContext();
  renderContext(ctx);
});
```

## UX Notes
- Show stable hierarchy: Facility (name/id), Location, Site (name/id).
- Indicate state clearly: Loading (spinner), Partial (ids only), Complete, Unknown.
- Avoid flicker: dedupe identical updates; debounce text changes.

## Security & Privacy
- No token usage in M3; no persistence to disk.
- Sanitize text extracted from DOM; strip excessive whitespace; length cap.
- Avoid executing arbitrary strings; only run our embedded extraction function.

## Acceptance Tests (Implemented)
### Automated Tests
- `desktop-app/test-context.js`: 5 URL parsing tests (all passing ✓)
  - Valid campsite URLs with different states
  - Non-campsite URLs (home, sign-in, explore)
  - Run with: `node test-context.js`

### Manual Test Scenarios
- Landing on a campsite page yields IDs immediately and labels within ~1s
- Navigating between different campsites updates context automatically
- Navigating to non-campsite pages shows "Unknown" status and clears fields
- Manual refresh button triggers re-extraction
- No UI flicker or duplicate updates (dedup working)
- Console shows safe error handling for DOM extraction failures

## Risks & Mitigations
- RA DOM/URL drift: Maintain layered selectors and regex fallbacks; ship quick updates.
- SPA timing: Multi‑attempt enrichment with short delays; cap at 1s to avoid churn.
- Incomplete pages: Accept partial results; allow manual refresh action.
- Internationalization/experiments: Keep selectors semantic where possible; track failures via local logs (no PII).


