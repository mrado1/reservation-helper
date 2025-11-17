# M2 Progress — Sidebar + Cookie Capture/Validation

Date: 2025-11-11

## Summary
Milestone 2 implements the sidebar “Auth” flow from the roadmap: cookies are auto‑checked on load, the app routes to the correct sign‑in page when needed, cookies auto‑refresh, and we added a live authentication probe (used for routing/logic). Post‑login, the app redirects to the RA home page automatically. The “live auth” text indicator was removed from the UI to reduce noise.

## Delivered
- Auto‑check cookies on load and on cookie change
  - Reads `idToken` and `a1Data`, validates JWT expiry, URL‑decodes and parses `a1Data` (metadata only).
- Sign‑in routing
  - If not authenticated, immediately navigates webview to `https://www.reserveamerica.com/signin` (no flicker to other pages).
  - Deterministic initial load: webview starts at `about:blank` and is driven by auth state.
  - Robustness: if `src` is set before attach, we retry on `dom-ready`.
- Live auth probe (authoritative, no UI text)
  - Main process calls `GET https://api.reserveamerica.com/jaxrs-json/shoppingcart/0` with browser‑like headers and current cookies; used to drive routing/state (no explicit “live auth” label shown).
- Post‑login redirect
  - If RA redirects to dashboard (`/explore/my-account/dashboard`), we treat as authenticated and send user to home `/` automatically.
- Sidebar UX
  - Status chips (JWT / a1Data) reflect local validity.
  - Login banner and “Go to login” CTA hidden automatically once authenticated.

## Key Files/Entrypoints
- `desktop-app/main.js`
  - `ipcMain.handle('getCookies')`: returns current `idToken` and `a1Data`.
  - `ipcMain.handle('auth:probe')`: server‑side check; mirrors headers (authorization, a1data, accept, origin, referer, UA).
- `desktop-app/preload.js`
  - Exposes `ra.getCookies()`, `ra.onCookieChanged(cb)`, and `ra.authProbe()` to renderer.
- `desktop-app/renderer/index.html`
  - Webview starts at `about:blank`; streamlined Auth UI (no “live auth” text).
- `desktop-app/renderer/renderer.js`
  - Auto‑grab/validate cookies on load; listen for cookie changes.
  - Route to `/signin` if not authenticated; ensure nav sticks (retry on `dom-ready`).
  - Use `authProbe()` to inform routing; if on dashboard, auto‑redirect to home.
  - Hide login banner/button when authenticated.

## How to Test (Manual)
1) Start app: `cd desktop-app && npm install && npm start`.
2) Not logged in:
   - Right pane should immediately navigate to `https://www.reserveamerica.com/signin`.
   - Left shows red chips; login banner visible.
3) Log in:
   - Should briefly hit dashboard and then auto‑navigate to home `/`.
   - Left shows green chips; banner/button hidden.
4) Log out (in RA):
   - Within ~1s, chips go invalid and app routes to `/signin` again.

## Notes / Rationale
- We avoided showing raw tokens; only expiry/length are displayed.
- Probe headers are essential; RA often 400s on minimal headers.
- Starting the webview at `about:blank` removes home‑page flicker before auth routing.

## Follow‑ups / Handoff to M3
- Add countdown + prewarm + open‑polling worker (see `docs/product/m3*.md` once created).
- Tune probe endpoint if RA changes; optionally probe another harmless authed endpoint.
- Consider an explicit “You’re logged in as <email>” UI from JWT payload (without storing it). 


