# M1 Technical Design — Reserve America Helper

## Scope (M1)
- Electron shell restricted to RA domains
- Sidebar UI (renderer) with cookie grab/validation and booking form
- Auto-refresh cookies on change events
- Context detection (facility/site IDs from URL; names from DOM where available)
- No booking API calls, countdown, or packaging in M1

## Architecture
- Main process
  - Creates `BrowserWindow` for RA
  - Enforces navigation restrictions
  - Exposes IPC handlers: `getCookies`, `onCookieChanged`, `getContext`, `openExternal`
- Preload
  - Bridges limited, safe APIs to renderer
- Renderer
  - Renders sidebar; calls `getCookies`; subscribes to cookie updates; performs validation
  - Displays context extracted from current RA page (via IPC or DOM scraping signal)
- No worker in M1 (workers come with booking in later milestones)

## Navigation Restrictions
```text
Allowlist:
  https://www.reserveamerica.com/*
  https://api.reserveamerica.com/*  (no renderer requests; listed for clarity)

Main handlers:
- will-navigate: prevent default unless URL matches allowlist
- setWindowOpenHandler: block new windows or open external in OS browser
```

Pseudo-code (main):
```js
const allow = (url) => /^https:\/\/(www\.)?reserveamerica\.com\/.*/.test(url);
win.webContents.on('will-navigate', (e, url) => { if (!allow(url)) { e.preventDefault(); shell.openExternal(url); } });
win.webContents.setWindowOpenHandler(({ url }) => allow(url) ? { action: 'allow' } : (shell.openExternal(url), { action: 'deny' }));
```

## Cookies and Auto‑Refresh
- On-demand read:
```js
session.defaultSession.cookies.get({ domain: 'www.reserveamerica.com' });
// filter name === 'idToken' | 'a1Data'
```
- Subscribe to changes:
```js
session.defaultSession.cookies.on('changed', (event, cookie) => {
  if (cookie.domain.includes('reserveamerica.com') && (cookie.name === 'idToken' || cookie.name === 'a1Data')) {
    // publish via IPC to renderer
  }
});
```
- Renderer validation:
  - JWT: decode base64url segment 2; check `exp`
  - a1Data: `decodeURIComponent` then `JSON.parse`
- Security: never persist raw values; do not log them

## Context Detection
- From URL:
  - Pattern: `/explore/.../CONTRACT/FACILITY/SITE/campsite-booking?...`
  - Extract `facilityID`, `siteID`
- From DOM (best-effort, resilient to changes):
  - Query title/headers for location name (e.g., “Lake George, NY”) and per-site identifiers (e.g., “BB011”)
  - Keep selectors centralized and tolerant; fallback to IDs only if missing

## Renderer: Booking Form
- Inputs: Start date, Nights (>=1)
- Derived: End date, “range” string (nights-based)
- Validation:
  - Date must parse and be >= today
  - Nights integer >= 1
  - JWT and a1Data valid to enable future steps (display warnings if invalid)

## IPC Contract (preload-exposed)
- `getCookies(): Promise<{ idToken?: string, a1Data?: string }>`
- `onCookieChanged((c) => void): Unsubscribe`
- `getContext(): Promise<{ facilityID?: string, siteID?: string, locationName?: string, siteName?: string }>`
- `openExternal(url: string): void`

Preload pattern:
```js
contextBridge.exposeInMainWorld('ra', {
  getCookies: () => ipcRenderer.invoke('getCookies'),
  onCookieChanged: (cb) => { ipcRenderer.on('cookieChanged', (_, c) => cb(c)); return () => ipcRenderer.removeAllListeners('cookieChanged'); },
  getContext: () => ipcRenderer.invoke('getContext'),
  openExternal: (url) => ipcRenderer.send('openExternal', url),
});
```

## Security & Privacy
- No persistence of tokens in M1
- Minimal IPC surface, validated inputs only
- Strip/avoid logging sensitive values

## Logging
- Renderer: show only deduplicated status (valid/invalid, last updated times)
- Dev logs: gated behind environment flag; never print tokens

## Testing Plan
Manual (macOS + Windows):
- Navigating to RA loads correctly; external links open in system browser
- Clicking “Grab cookies” shows validity, expiry for `idToken`, parse status for `a1Data`
- Logging out/in updates cookies automatically (auto-refresh observed in UI within 1s)
- Navigating to a known campsite URL populates facility/site IDs and (if available) names
- Booking form validation: invalid values block; derived date range is correct

Automation (lightweight):
- Unit test JWT decode/expiry check
- Unit test `a1Data` URL decode/parse
- Unit test URL parsing for IDs

## Build/Run (Dev)
- Framework: Electron + Vite/React (or minimal HTML) — dev choice
- Scripts:
  - `npm run dev`: start Electron with live reload
  - `npm run lint`: lint JS/TS
- Packaging not in M1 (M2+)



