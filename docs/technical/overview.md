# Technical Overview

## Architecture
- Electron app with:
  - Main process: creates `BrowserWindow`, enforces domain restrictions, manages cookies, spawns poller worker, IPC bridge.
  - Renderer (sidebar UI + RA view): user interactions, validation, live status, countdown.
  - Preload: exposes a minimal, safe API to renderer (`getCookies`, `onCookieChanged`, `startPoll`, `stopPoll`, `navigateToCart`, `onStatusUpdate`).
  - Poller worker (Node child process or worker threads): executes add-to-cart loop with bounded concurrency; reports status via IPC.

## Domain Restrictions
- Allowlist origins:
  - `https://www.reserveamerica.com/*`
  - `https://api.reserveamerica.com/*` (requests done from worker via Node, not renderer).
- Block external domains via `will-navigate` and `setWindowOpenHandler`; open external links in system browser when needed.

## Cookies and Auth
- Read `idToken` (JWT) and `a1Data` via `session.cookies.get({ domain: "www.reserveamerica.com" })` after explicit user action/consent.
- Validate:
  - JWT: decode payload, check `exp`.
  - `a1Data`: URL-decode if needed; ensure valid JSON.
- Auto-refresh:
  - Subscribe to `session.cookies.on("changed", ...)` for `idToken`/`a1Data`; push updates to renderer and worker.
  - If JWT expired and site refreshes cookie (silent reauth), new value will be picked up automatically.
  - If not refreshed, instruct user to re-login in the embedded RA window.

## Poller Worker
- Endpoint: `POST https://api.reserveamerica.com/jaxrs-json/shoppingcart/0/additem`.
- Headers (mirror browser):
  - `authorization: <idToken>`
  - `a1data: <a1Data>`
  - `accept`, `content-type`, `referer`, `origin`, `user-agent`, and typical browser sec headers.
- Body built from sidebar inputs: `contractCode`, `facilityID`, `siteID`, `arrivalDate`, `units`, `quantity`, etc.
- Strategy:
  - Aggressive cadence (default 10–50ms) with bounded concurrency (e.g., max 10–20 in-flight).
  - Stop conditions: success (200 OK), HTTP `000` (auto-kill), manual stop, max duration, or escalating rate limits.
  - Deduplicated status events only (code + meaningful message changes).

## Sidebar UX
- Current page info:
  - Parse facilityID/siteID from URL; enrich location/site name from DOM where available.
- Booking form:
  - Start date, nights (≥1), derived end date (nights-based range).
  - Validation: JWT expiry, `a1Data` parse, required fields present.
- Actions:
  - Grab cookies, Reserve (countdown + start), Stop, Go to cart.
- Status:
  - Countdown (mm:ss.ms)
  - Current state + last meaningful message
  - Success banner with “go to cart”

## User Flow Engine (Countdown, Prewarm, Polling)
- States:
  - IDLE → WINDOW_WAIT (countdown) → PREWARM (T−60s) → OPEN_POLLING (T≥0) → SUCCESS | FAIL | BLOCKED
- Timing:
  - On “Reserve” arm: send one probe.
  - If “too early”, extract target time/date, show countdown, no hammering yet.
  - At T−60s (e.g., 8:59:00 local for 9:00:00 open), start aggressive polling with bounded concurrency (e.g., 10–20 in-flight; cadence 10–50ms).
  - Continue at and after T=0 until terminal condition or max runtime.
- Deduplicated status:
  - Compute a status key as `${httpCode}:${fault.msgKey || fault.code || body.code || messageTemplate}`.
  - Only emit to UI when key changes; maintain “last updated” timestamp.

## Response Classification (Parsing RA Faults)
- Too early (window not open):
  - Examples: `R6-V-100013.error` (“try again at 9:00 AM ...”), `R1-V-100017.error` (“within 9 Month(s) ...”).
  - Extract target time from `msgParams` or `messageTemplate/defaultMessage` text; set state WINDOW_WAIT.
- Inventory unavailable (terminal fail):
  - `faults[0].msgKey === "inventory.exception"` → FAIL.
- Overlapping reservations:
  - Body includes “Maximum number of overlapping reservations” → optional cart-clearing flow; otherwise treat as blocked until resolved.
- Network blocked:
  - HTTP `000` from transport → BLOCKED; stop immediately.
- Success:
  - HTTP 200 with expected payload → SUCCESS; instruct UI to navigate to cart.

Pseudo-code:
```js
function classify(body, http) {
  if (http === 200) return { state: 'SUCCESS', key: '200' };
  if (http === 0 || http === 000) return { state: 'BLOCKED', key: '000' };
  const fault = body?.faults?.[0];
  const msg = body?.messageTemplate || body?.defaultMessage || body?.message || '';
  const key = `${http}:${fault?.msgKey || fault?.code || body?.code || 'unknown'}`;
  if (/try again.*9:00\s*AM/i.test(msg)) return { state: 'WINDOW_WAIT', key, target: extractTime(body) };
  if (/within 9 Month/i.test(msg)) return { state: 'WINDOW_WAIT', key, target: deriveFromRule(body) };
  if ((fault?.msgKey || '').includes('inventory.exception')) return { state: 'FAIL', key, reason: 'Inventory not available' };
  if (/Maximum number of overlapping reservations/i.test(JSON.stringify(body))) return { state: 'OVERLAP', key };
  return { state: 'FAIL', key, reason: body?.message || 'Request invalid' };
}
```

## Logging
- UI shows deduplicated state/messages to avoid spam.
- Full logs written to timestamped files; redact tokens; “Download logs” action in UI.

## Security & Privacy
- Keep tokens in memory by default; if persistence is offered, encrypt at rest.
- Never send tokens to external servers.
- Code-sign the app; document behavior and disclaimers; respect RA ToS.

## Packaging & Distribution
- Use `electron-builder`:
  - macOS: signed + notarized DMG/ZIP.
  - Windows: signed MSI/EXE.
- Smoke tests on macOS/Windows for first-run and key flows.

## Future Improvements
- Cart conflict helper (fetch cart, prompt to clear items, remove via API).
- Config export/import, onboarding guide, time zone helpers, alerts/sounds.
- Regional deployments or VPS proximity options (lower latency) with user consent.
- Optional crash reporting (local by default). 


